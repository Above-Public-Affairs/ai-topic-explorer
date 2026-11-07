# Session Handoff — AI Topic Explorer

**Last Updated:** November 6, 2026

## Where we are
Live in production (beta) on Railway with four providers: Claude, ChatGPT, Gemini
and Grok. Phase 1 (1.2, 1.3, 1.4) has shipped. Task 2.1, the provider interface for
the tracker, is built on `claude/provider-interface-ab8e35` and waits for Josh's
merge approval. The app is becoming an internal topic-tracking tool.

**Plan and tracker.** The roadmap is in `PROJECT-PLAN.md`. Work runs from the project
tracker (https://claude.ai/artifact/Hm5BrTX5Tb8hTxaZBw6FCS) and the "AI Topic
Explorer — master" chat. Done: 1.1, 1.2, 1.3, 1.4, 3.1 and 3.2 (no X Search).

## What was built this session (task 2.1, covers 3.3)
- `lib/answers/types.ts`: `AnswerProvider`, `AskResult` (answer, sources with
  cited true/false/null, search queries, answering model, usage, location mode, cost).
- `lib/answers/{claude,openai,gemini,grok}.ts`: one plain question each, web search
  on, approximate location. Grok now uses xAI's Responses API, web search only.
- `lib/answers/prices.ts`: one price table, source and date per row.
- `scripts/ask-providers.ts`: `railway run npx tsx scripts/ask-providers.ts "question"`
  (`--json`, `--only=claude,grok`). `tsx` added as a dev dependency.
- The analyze flow is untouched apart from `export const MODEL` in each client.

## Verification status
- `tsc`, lint and a keyless `next build` pass.
- Live run with Railway keys: Claude, OpenAI and Grok answered with search, Texas
  location, sources, queries, tokens and cost. Gemini failed: search grounding
  returns 429 "exceeded your current quota" on the production key (plain calls work).

## Next steps
- **Gemini grounding quota:** check the Google AI Studio project's billing/plan, then
  re-run `scripts/ask-providers.ts --only=gemini`.
- Task 2.2 (tables) and 2.3 (extraction) build on `AskResult`.
- Compare `DailySpend` with real provider bills after a few days and tune the
  rates or the $50 default.
- Remove the unused `PERPLEXITY_API_KEY` variable from the Railway service.
- Map a 402 to "Quota exhausted — check billing" in `categorizeError`.
- `FloatingKeywords` uses `Math.random()` during render (hydration mismatch on `/`).
- `components/MethodologySection.tsx` isn't imported anywhere; delete or use it.

## Known gotchas
- **`lib/providers.ts` is display labels;** the provider interface is `lib/answers/`.
- **Claude: keep `web_search_20250305`.** The 20260209 tool answers without citations.
- **Gemini grounding has its own quota,** separate from plain generation.
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
