# Session Handoff — AI Topic Explorer

**Last Updated:** September 16, 2026

## Where we are
Live in production (beta) on Railway. This session triaged one production error
report — `stream_error` / `Invalid state: Controller is already closed`, seen once
on 2026-09-15 — and fixed the root cause. The change is confined to the SSE stream
plumbing in `app/api/analyze/route.ts`; no provider, analysis, or UI code was
touched.

The three commits from the previous session (streaming + provider-failure fixes)
are already on `origin/main` and deployed.

## What was built this session
Both bugs trace to the same asymmetry: `controller.enqueue()` was wrapped in a
try/catch inside `emit()`, but `controller.close()` was called bare in five places.
Node throws the *identical* `TypeError: Invalid state: Controller is already
closed` from both.

- **Bug 1 — every early return double-closed the stream.** The handler's shape is
  `try { … } catch { … } finally { controller.close() }`, and four paths inside the
  `try` did `controller.close(); return;`: the `signal.aborted` checks before the
  provider fan-out and before the DB save, the all-providers-failed branch, and the
  DB-save-failed branch. A `return` inside `try` still runs `finally`, so each of
  those closed twice.
  - Because a throw from `finally` bypasses the sibling `catch`, this one escaped as
    an unhandled rejection out of `start()` — it was never the thing being reported.
- **Bug 2 — the one that actually got reported.** `stream_error` is only ever raised
  from the stream's `catch`, so the reported throw had to originate *inside* the
  `try`. When a client navigates away, Next.js cancels the ReadableStream and the
  controller stops being closeable. The handler then notices `signal.aborted`, calls
  `controller.close()` to be tidy, and *that* throws — caught, and filed as an
  application fault. So the 2026-09-15 report was a user closing the tab mid-run,
  not a defect anyone experienced. A 150s worst case makes that very plausible.
  - **Fix:** a `streamClosed` flag plus an idempotent `closeStream()` that swallows
    the invalid-state error; the four in-`try` `close()` calls removed so `finally`
    is the sole owner of closing; a `cancel()` handler on the stream source so a
    disconnect marks it closed and the in-flight handler unwinds quietly; and
    `reportError` gated on `!signal.aborted`, which also suppresses the broader
    class of disconnect noise (an abort makes in-flight provider work reject too).
- `CHANGELOG.md` / `PROJECT-STATUS.md` — entries for 2026-09-16.

## Verification status
- `npx tsc --noEmit` passes (requires `npx prisma generate` first in a fresh
  worktree — `lib/db.ts` imports the generated client).
- `npx eslint app/api/analyze/route.ts` clean.
- Reproduced both failure paths standalone against the real `ReadableStream`, before
  and after: the early-return shape threw `Invalid state: Controller is already
  closed` and now does not; the close-after-client-cancel shape reported
  `stream_error: Invalid state: Controller is already closed` and now reports
  nothing. Script was temporary and lives only in the session scratchpad.
- **Not** exercised against a live analysis run — no `.env` in this worktree, and a
  golden-path run needs live keys for all five providers plus Postgres. Shipped on
  the strength of the static checks and the repro, with the user's okay.

## Next steps
- Confirm on Railway after deploy that `stream_error` reports with this message stop
  appearing. Since the trigger is a user disconnecting, absence is the only signal —
  there's nothing to actively reproduce in production.
- Still open from the previous session: watch `provider_failure` reports for
  `grok`/`perplexity` to confirm those fixes hold under real traffic.
- Still open: trimming Perplexity's fan-out below the full 5 expanded queries (it
  only contributes citations + related questions).
- Still open: applying Claude's streaming + partial-recovery pattern to the OpenAI,
  Gemini, Perplexity, and Grok clients.

## Known gotchas
- `emit()` deliberately swallows enqueue failures, and `closeStream()` now swallows
  close failures. That is correct for a stream whose client may vanish at any moment,
  but it does mean a genuine bug in the write path would be silent. If SSE events
  ever appear to go missing, this is the first place to instrument.
- `reportError` is now skipped whenever `signal.aborted`. A real fault that happens
  to coincide with a client disconnect will therefore go unreported. That trade was
  made deliberately — disconnects are common and the noise was drowning real
  reports — but it is worth remembering when a user reports a failure with no
  corresponding error record.
- The other four provider clients still use non-streaming calls with no
  partial-recovery path — a timeout on them discards the full response.
- The JSON block (entities/citations/keyThemes) is emitted *after* the prose, so any
  truncated response loses structured data even though the prose survives.
- The permissive JSON sanitizers in `shared.ts` coerce rather than surface errors —
  systematic provider drift would be silently absorbed.
