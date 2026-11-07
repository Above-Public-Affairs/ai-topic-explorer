# Session Handoff — AI Topic Explorer

**Last Updated:** November 7, 2026

## Where we are
Live in production (beta) on Railway with four providers: Claude, ChatGPT, Gemini
and Grok. Phase 1 tasks 1.2, 1.3, 1.4 (cost and abuse guards) and 1.5 (stop losing results) have shipped, and task 5.1
(email sending) is in place for the later alert and report phases. Task 2.1, the provider
interface for the tracker, is proven live for all four providers and waits for Josh's
merge approval. Task 1.7 (Gemini on a paid Google tier) is done. Task 2.2 (tracking tables) is built and
proven on a copy of production. The app is becoming an internal topic-tracking tool.

**Plan and tracker.** The roadmap is in `PROJECT-PLAN.md`. Work runs from the project
tracker (https://claude.ai/artifact/Hm5BrTX5Tb8hTxaZBw6FCS) and the "AI Topic
Explorer — master" chat. Done: 1.1, 1.2, 1.3, 1.4, 1.5, 3.1, 3.2 (no X Search) and 5.1.

## Tracking tables (task 2.2)
- Migration `20261107120000_tracking_tables`: 13 new tables, nothing changed on
  `Analysis`, `RateLimitCounter` or `DailySpend`. Railway's pre-deploy applies it.
- `Run` → `Answer` (every `AskResult` field as columns; failed calls keep `errorKind`)
  → `Citation` (`origin` provider/extracted) and one `Extraction` (model,
  `promptVersion`, tone, own cost) → `Entity`, `Theme` (optional `SubTopic`), `Argument`.
- `WatchItem` (topic, geography, ask city) → `SubTopic`, `QuestionSet`
  (anchor/promoted/fresh; a fresh set links to its run) → `Question` (retire, never edit).
- `ModelRegistry`: add a row and set `retiredAt` on the old one; answers point at the row.
- `Event`: category, status, source, `triggerAt`, linked `runId`.
- Copying prod: its Postgres has no public proxy. Dump over `railway ssh --service Postgres`
  (pg_dump | gzip | base64), restore into a local Postgres 17. Prod has an
  `add_error_log` migration row not in the repo; `migrate deploy` ignores it.

## Tests and CI (task 1.6)
- `npm test` runs Vitest (`vitest.config.mts`, `@/` alias, provider keys blanked).
  Tests in `tests/*.test.ts`; recorded answers in `tests/fixtures/answers/*.md`, Gemini
  error bodies in `tests/fixtures/errors/`, a v1 saved result in `tests/fixtures/stored/`.
- Analyze-flow clients are tested with their SDK mocked (`vi.mock`), Gemini keeping the
  real `ApiError`. Error helpers in `tests/helpers/errors.ts` build real SDK errors.
- `categorizeError`/`providerErrorDetail` now live in `lib/analysis/provider-errors.ts`,
  `mergeProviderResponses`/`clampFrequency` in `lib/analysis/merge-provider-responses.ts`.
- CI is `.github/workflows/ci.yml` (lint, typecheck, test). Add new checks there.

## Provider interface (task 2.1, covers 3.3)
- `lib/answers/types.ts`: `AnswerProvider`, `AskResult` (answer, sources with
  cited true/false/null, search queries, answering model, usage, location mode, cost).
- `lib/answers/{claude,openai,gemini,grok}.ts`: one plain question each, web search
  on, approximate location. Grok now uses xAI's Responses API, web search only.
- `lib/answers/prices.ts`: one price table, source and checked date per row; optional
  `from`/`until` dates pick the price in force (Gemini's 2027-01-01 doubling has rows).
- Gemini grounding sources come as expiring `vertexaisearch` redirect links; `gemini.ts`
  resolves each with a HEAD request (3s timeout, keeps the redirect on failure).
- `lib/answers/errors.ts`: every failure becomes a typed `ProviderError` (`kind`, `status`).
  Gemini's quota 429 (no RetryInfo, "exceeded your current quota") is `quota_exhausted`
  and isn't retried.
- `scripts/ask-providers.ts`: `railway run npm run ask:providers -- "question"`
  (`--json`, `--only=claude,grok`). `tsx` added as a dev dependency.
- The analyze flow is untouched apart from `export const MODEL` in each client.

## Stop losing results (task 1.5)
- `app/api/analyze/route.ts`: saves even after the visitor leaves (only a leave during
  expansion skips the provider calls); one 170s run deadline (`RUN_DEADLINE_MS`, provider
  calls stop `SAVE_RESERVE_MS` = 10s before it); `: keepalive` SSE comment every 15s;
  empty answers fail the provider; mixed-model `model` labels; Grok frequency clamped;
  `categorizeError` covers 402 / depleted credits and safety blocks.
- `lib/ai-clients/shared.ts`: `json_parse_failure` reports (warning) per provider, kinds
  `missing_block` / `unclosed_block` / `invalid_json`; brace-matching fallback parser.
- `lib/results/stored-result.ts`: zod read of saved results with defaults;
  `RESULT_SCHEMA_VERSION` = 2. Unreadable results render `UnreadableResult.tsx` and
  report `stored_result_unreadable`.
- `lib/analysis/query-expansion.ts` takes the abort signal; SDK `timeout` 12s, `maxRetries` 1.
- Gemini's Flash-Lite fallback retries once (the only provider-file change).
- Local testing without keys: point `OPENAI_BASE_URL` at a mock OpenAI-compatible server.

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
- `tsc`, lint and a keyless `next build` pass.
- Live run with Railway keys (2026-11-07): all four answered with search, Texas
  location, sources, queries, tokens and cost. Gemini's figures were checked against
  its raw response (no `toolUsePromptTokenCount`: search results aren't billed as
  tokens; every chunk was cited).

## Next steps
- Task 2.2 (tables) and 2.3 (extraction) build on `AskResult`.
- Compare `DailySpend` with real provider bills after a few days and tune the
  rates or the $50 default.
- Remove the unused `PERPLEXITY_API_KEY` variable from the Railway service.

## Known gotchas
- **Scripts run under Node's type stripping** (`node scripts/x.ts`). Anything they
  import can't use `@/` paths, enums or constructor parameter properties.
- **`scripts/ask-providers.ts` runs under `tsx`** (`npm run ask:providers`), not Node's type
  stripping: it imports the `@/` paths that `lib/answers` uses.
- **`lib/providers.ts` is display labels;** the provider interface is `lib/answers/`.
- **Claude: keep `web_search_20250305`.** The 20260209 tool answers without citations.
- **Gemini grounding has its own quota,** separate from plain generation, and isn't on
  the free tier.
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
