# Session Handoff — AI Topic Explorer

**Last Updated:** November 6, 2026

## Where we are
Live in production (beta) on Railway with four providers: Claude, ChatGPT, Gemini
and Grok. Phase 1 tasks 1.2 (platform upgrade) and 1.3 (Perplexity removed, models
replaced) have shipped. The app is becoming an internal topic-tracking tool.

**Plan and tracker.** The roadmap is in `PROJECT-PLAN.md`. Work runs from the project
tracker (https://claude.ai/artifact/Hm5BrTX5Tb8hTxaZBw6FCS) and the "AI Topic
Explorer — master" chat. Done: 1.1, 1.2, 1.3, and 3.1 (Grok research; its branch is
no longer on the remote).

## What was built this session (task 1.3)
- **Perplexity removed:** client, `components/Perplexity.tsx`, the related-questions
  section, progress/badge entries, metadata and home-page copy. `Provider` is now the
  four live providers; `StoredProvider` adds `"perplexity"` for saved data, and
  `lib/providers.ts` holds the one label/color map (Perplexity kept there only so old
  results' badges render).
- **Models, one `MODEL` constant per client (also the stored label):** OpenAI
  `gpt-6-luna` + `reasoning_effort: "none"` + `max_completion_tokens` (Free Chat
  default since Oct 8, 2026, Instant); Grok `grok-4.3` + `reasoning_effort: "low"`;
  Gemini `gemini-3.6-flash`; expansion `claude-haiku-5-5` + `effort: "low"` +
  1,024 `max_tokens`. Claude stays `claude-sonnet-5-5`.
- **Build cleanup:** `railway.json` deleted (pre-deploy is in service settings; see
  `LESSONS.md`); OG image off the Edge runtime; `allowScripts` in `package.json`.

## Verification status
- `tsc`, lint and a keyless `next build` pass.
- Live check before shipping (prod keys via `railway run`): expansion gave 5 queries;
  Claude, OpenAI, Gemini and Grok each returned text, entities, citations and themes
  in 29–40s.

## Next steps
- 1.4 (cost and abuse guards) rebases onto this.
- Remove the unused `PERPLEXITY_API_KEY` variable from the Railway service.
- Confirm the free grok.com model if xAI ever names it; revisit in 3.3.
- Map a 402 to "Quota exhausted — check billing" in `categorizeError`.
- `FloatingKeywords` uses `Math.random()` during render (hydration mismatch on `/`).
- `components/MethodologySection.tsx` isn't imported anywhere; delete or use it.

## Known gotchas
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
