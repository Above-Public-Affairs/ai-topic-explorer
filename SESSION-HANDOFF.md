# Session Handoff — AI Topic Explorer

**Last Updated:** November 6, 2026

## Where we are
Live in production (beta) on Railway with four providers: Claude, ChatGPT, Gemini
and Grok. Phase 1 tasks 1.2, 1.3 and 1.4 (cost and abuse guards) have shipped, and task 5.1
(email sending) is in place for the later alert and report phases. The
app is becoming an internal topic-tracking tool.

**Plan and tracker.** The roadmap is in `PROJECT-PLAN.md`. Work runs from the project
tracker (https://claude.ai/artifact/Hm5BrTX5Tb8hTxaZBw6FCS) and the "AI Topic
Explorer — master" chat. Done: 1.1, 1.2, 1.3, 1.4, 3.1, 3.2 (no X Search) and 5.1.

## Email (task 5.1)
- `lib/email/send.ts`: `sendEmail({ to, subject, text, html? })` over SendGrid v3,
  30s timeout, `email_error` reports (counts only, no addresses). Throws
  `SendRejectedError` when SendGrid refuses; a plain Error means the outcome is unknown.
- Sender AI Topic Explorer `<topic-explorer@abovepublicaffairs.com>`, replies to Josh.
- Test: `railway run npm run email:test` (`TEST_EMAIL_TO` overrides the recipient).

## What was built earlier (task 1.4)
- `lib/guards/`: `limits.ts` (300-char topic, 4 queries, 200 chars each),
  `client-ip.ts` (Railway `X-Real-IP`, right-most XFF fallback, hashed keys),
  `spend.ts` (daily cap, `DAILY_SPEND_CAP_USD`, default $50), `analyze-request.ts`
  (kill switch → body validation → spend cap → rate limit).
- `lib/rate-limit.ts` is now a Postgres fixed-window counter. New migration
  `20261106120000_cost_abuse_guards` adds `RateLimitCounter` and `DailySpend`.
- Expansion prompt puts the topic in `<topic>` as a JSON string; `capQueries()` trims
  whatever the model returns.
- Bug-report route: rate limit, field caps, 8s timeout, 502/503 on failure.
- `proxy.ts`: POST + `Next-Action` header → 404.
- PROJECT-PLAN Phase 3 rewritten for the task 3.2 decision (web search only).

## Verification status
- `tsc`, lint and a keyless `next build` pass after rebasing onto 1.3.
- Locally (Postgres + `next start`): every guard checked with real requests,
  including a rate limit surviving a server restart and a fake expansion model
  returning 52 injected queries.

## Next steps
- Compare `DailySpend` with real provider bills after a few days and tune the
  rates or the $50 default.
- A spend-cap 503 shows the client's generic "temporarily unavailable" text.
- Remove the unused `PERPLEXITY_API_KEY` variable from the Railway service.
- Map a 402 to "Quota exhausted — check billing" in `categorizeError`.
- `FloatingKeywords` uses `Math.random()` during render (hydration mismatch on `/`).
- `components/MethodologySection.tsx` isn't imported anywhere; delete or use it.

## Known gotchas
- **Scripts run under Node's type stripping** (`node scripts/x.ts`). Anything they
  import can't use `@/` paths, enums or constructor parameter properties.
- **Google model access depends on the project's age.** A newly created Gemini key
  may not get older models that existing projects still have. Test the exact model
  with a new key before deploying it.
- **`next build` loads route modules** to collect config, so anything constructed
  at module load runs at build time. Keep SDK clients lazy.
- **`next dev` (16.4) writes `AGENTS.md`** and restores it if removed. It's
  deliberately not committed; don't `git add -A` blindly.
- **Gemini errors are JSON in `ApiError.message`.** Use `geminiErrorBody()`,
  not message matching.
- **Pick each provider's free-tier default, never the flagship.** OpenAI's is in the
  ChatGPT release notes (help.openai.com blocks plain fetches; use the browser).
- **iCloud makes "… 2" duplicates** (`node_modules/@types/node 2`, `.next/... 2.ts`,
  generated Prisma files) that break `tsc`. They're ignored files; delete them.
- **`between_tools` works only on Claude Sonnet 5.5.** Any retry or router that
  re-sends the Claude request to another model must drop it.
- **Sonnet 5.5's tokenizer spends ~30% more tokens than Sonnet 4.5** on the same
  text. Token counts in old logs aren't comparable.
- `emit()` and `closeStream()` swallow write/close failures on purpose. A real bug
  in the SSE write path would therefore be silent.
- `reportError` is skipped whenever `signal.aborted`, so a fault coinciding with a
  disconnect goes unreported.
- The JSON block is still emitted *after* the prose. The new length target and
  higher cap make truncation rarer, but a 150s timeout under load can still cut
  it off.
- The four non-Claude clients still have no partial-recovery path on timeout.
- **Guards need the database.** If Postgres is down, `/api/analyze` returns 503
  rather than running without rate limits or the spend cap.
- **Railway's `X-Real-IP` is the client IP.** Never key anything on the left-most
  `X-Forwarded-For` value; clients control it.
