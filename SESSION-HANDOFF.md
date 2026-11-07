# Session Handoff — AI Topic Explorer

**Last Updated:** November 7, 2026

## Where we are
Live in production (beta) on Railway with four providers: Claude, ChatGPT, Gemini
and Grok. Phase 1 tasks 1.2, 1.3, 1.4 (cost and abuse guards) and 1.5 (stop losing results) have shipped, and task 5.1
(email sending) is in place for the later alert and report phases. Task 2.1, the provider
interface for the tracker, is proven live for all four providers and waits for Josh's
merge approval. Task 1.7 (Gemini on a paid Google tier) is done. Task 2.2 (tracking tables) is built and
proven on a copy of production. Task 2.7 (entity merging, extraction model in the model
list) is built and proven locally. Task 2.5 moves the public site onto the new pipeline
(`lib/answers` + `lib/extraction` via `runPipeline`); see "Public site (task 2.5)" below.
The app is becoming an internal topic-tracking tool.

**Plan and tracker.** The roadmap is in `PROJECT-PLAN.md`. Work runs from the project
tracker (https://claude.ai/artifact/Hm5BrTX5Tb8hTxaZBw6FCS) and the "AI Topic
Explorer — master" chat. Done: 1.1, 1.2, 1.3, 1.4, 1.5, 3.1, 3.2 (no X Search) and 5.1.

## Public-site review fixes (task 6.7)
- Reviews: `docs/reviews/accessibility-2026-11.md` (6.3), `speed-2026-11.md` (6.4),
  `design-2026-11.md` + screenshots (6.5). 6.7 fixed accessibility 0–9 (+10, 11, 13, 14,
  16, 19, 18 partly), design 1–9 (+13, 14, 15, 17 sidebar label) and speed 1–3 (+7).
- Tailwind v4: write CSS-variable classes as `text-(--text-secondary)`, never
  `text-[--x]` (compiles to nothing). Tokens were darkened to pass AA.
- Sources display: `lib/results/sources.ts` (URL de-dup, title fallback, order by first
  link, Claude search-preamble strip). View only; stored answers are untouched.
- Modals: use `components/Dialog.tsx` (native `<dialog>`), not a hand-rolled overlay.
- Local check without production data: seed a scratch Postgres from the public results
  pages' RSC payload (the props carry the full view); prod has no public DB URL.
- **Left for 6.6:**
  - Speed 2 (second half): render `AnswerProse` on the server so the Markdown renderer
    never ships to new-layout results (~50 KB gz). Needs `AnswerTabs` to take rendered
    panels as props.
  - Speed 4 (send less data to the browser: on-demand word context), 5 (cache saved
    results), 6 (inline CSS), 8 (polyfills), 9 (Footer changelog out of the JS bundle).
  - Accessibility 12 partly (mobile header doesn't collapse on scroll), 15 (theme chips
    still truncate), 17 (some text links are 32px tall, under the 44px house guidance),
    20 (mobile sticky bar truncates the topic; the full topic is now the page `<h1>`),
    21 (new-tab notice only on source lists and citation pills, not every link).
  - Design P2/P3: 10 (Answers first / sticky tabs on mobile), 11 (per-AI "reading"
    progress, hero jump when the panel appears), 12 (near-duplicate themes, an extraction
    fix), 16 (entity grid dead space). Dark theme not started.
  - A real VoiceOver pass over the dialogs and progress announcements (DOM checked only).

## Question sets (task 4.2)
- `lib/questions/`: `rules.ts` (sizes, `checkVoterVoice`, `selectQuestions`, the promotion
  rule `findPromotions`), `generate.ts` (`generateSet("anchor" | "fresh")` with the model
  list's `questions` row, strict JSON, one retry), `sets.ts` (`draftAnchorSet`,
  `lockAnchorSet`, `retireQuestion`, `promoteRecurring`, `questionsForSnapshot`), `review.ts`
  (reviewed file → migration SQL), `watch-items.ts` (`WATCH_ITEMS`, matched by the seed
  migration in a test).
- For 4.4 (weekly worker): create the `Run` (kind weekly, watch item, ask location), call
  `questionsForSnapshot(db, { watchItemId, runId })`, then `runPipeline(db, { runId, questions:
  [...locked × repeats (4.3), ...fresh], ... })`. Labels are "set.position" (1.3, 5.2).
- **Production anchor sets wait on Josh.** He reads `scripts/anchor-sets/2026-11-07.json`.
  On approval: `npm run questions -- --migration=scripts/anchor-sets/2026-11-07.json
  --reviewed=YYYY-MM-DD > prisma/migrations/<ts>_anchor_sets/migration.sql`, commit, push. If
  he wants changes, edit the file (still a draft) and re-check with `npm test` (a test runs
  every question through `checkVoterVoice` and checks sub-topic coverage).
- Locked questions can't be edited or deleted (trigger `question_locked_guard`); retire with
  `npm run questions -- --retire=<id> --reason="…"`.
- Local scripts: `railway run -- env DATABASE_URL=<local> npm run questions -- --draft-anchor`
  then `--lock-anchor`, `--fresh`, `--list`, `--export=`. Writes refuse non-local databases.
- DB tests: `TEST_DATABASE_URL=<local migrated db> npx vitest run tests/question-sets.db.test.ts`
  (skipped in CI, which has no database).

## Measured cost (task 2.6)
- Real cost per answer and the monthly figure (~$83 vs the $60 estimate) are in
  `PROJECT-PLAN.md` under "Measured cost". Rerun with
  `railway run -- env DATABASE_URL=<local> npx tsx scripts/cost-batch.ts` (`--report-only`,
  `--cap=`); it refuses any non-local database.
- Gemini's recorded cost prices search at list; real is ~$0.002 while under 5,000 grounding
  requests a month. Grok's reported charge matched a list-price recompute. Claude and OpenAI
  weren't checked against their consoles. Grok returned one 429 "at capacity" in 10 calls.

## Model list (task 2.4)
- `lib/answers/registry.ts` holds `FREE_TIER_DEFAULTS` (one free-tier default per
  provider, with source URL, date confirmed, guess flag) and `getModel(provider)`.
  Providers call it unless `ask(q, { settings })` passes a `ModelChoice`; `askAll` reads
  all four once. Answers carry `modelRegistryId` for `Answer.modelRegistryId`.
- Seeded by data migration `20261107180000_seed_model_registry` (inserts only where a
  provider has no current row). A test checks the SQL matches `FREE_TIER_DEFAULTS`; if
  the defaults change, regenerate the SQL in a new migration or call `saveModel()`.
- To change a model: `saveModel({...})` retires the current row and adds the new one;
  the watcher (task 4.5) should do the same. `npm run models:seed -- --show` prints rows.
- Tests blank `DATABASE_URL`, so the registry uses its defaults there.
- Public site (`lib/ai-clients/`) still has its own `MODEL` constants (Gemini 3.6 Flash,
  no longer the free default). Moving it is task 2.5.
## Entity merging and the extraction model's row (task 2.7)
- `lib/extraction/canonical.ts`: pure merge rules and `EntityResolver`. Keys are scoped
  person / place / thing. `name` keys merge (and fold two stored entities together);
  `acronym` keys ("ERCOT") match the same text or one unambiguous expansion; `derived`
  keys (acronyms of full names, or the short form the model expanded) only join an
  entity known solely by that acronym. The model's `canonicalName` is the main key.
- `lib/extraction/link.ts`: `linkEntities(db)` writes it (advisory lock, loads only
  canonical entities sharing a key); called by `extractAndStore` after each extraction
  and by `extractMissing`. `relinkAllEntities` / `npm run entities:merge` rebuild it all.
  Run that on Railway after changing the rules.
- Extraction model: `ModelRegistry` row with `role = extraction`, read by
  `getExtractionModel()` (fallback `EXTRACTION_DEFAULT`). `getModels()` ignores it.
  `saveModel()` scopes by role. `Extraction.modelRegistryId` records the row.
- Gotchas: a surname alone ("Governor Abbott") never merges without the model's full
  name; ambiguous bare acronyms join whichever full name came first.

- The public site now reads its models from the registry too (task 2.5).

## Public site (task 2.5)
- `/api/analyze` → `runPipeline({ kind: "public", topic, providers })`, no location, no
  query expansion. Saves `Analysis.result = { schemaVersion: 3, topic, runId }`.
- `/results/[id]`: `readRunPointer` → `loadRunView` (`lib/results/run-view.ts`, pure
  `buildRunView`) → `RunResultsContent`. v1/v2 blobs still go through `readStoredResult`.
  Both share `components/ResultsShell.tsx`.
- Spend: `runSpendUsd` = run cost (answers + extraction) + $0.15 per timed-out call.
- `ANTHROPIC_EXPANSION_API_KEY` on Railway is no longer used.
- Local proof needs a DB: prod Postgres has no public proxy. Run `next dev` under
  `railway run` with `DATABASE_URL` pointed at a scratch local Postgres with
  `prisma migrate deploy` applied.
## Extraction and pipeline runner (task 2.3)
- `lib/extraction/`: `schema.ts` (`EXTRACTION_MODEL` = `gpt-6-luna`, `PROMPT_VERSION`,
  strict JSON schema; bump the version on any prompt/schema change), `extract.ts` (the
  one call: `reasoning: none`, structured output, priced via `lib/answers/prices.ts`),
  `parse.ts` (lenient clean-up, merges entities/themes by `normalizeName`), `map.ts`
  (pure row mapping, tested), `store.ts` (`extractAndStore`; failures stored with
  `errorMessage`, so every answer with text gets an `Extraction`).
- `lib/pipeline/run.ts` `runPipeline(db, {kind, topic, questions, location, providers,
  subTopics, watchItemId})`; `backfill.ts` `extractMissing(db)`.
- "for"/"against" means favorable/critical toward the industry, not agreement with the
  question; v1 of the prompt got this wrong, fixed in `2026-11-07.2`.
- Entity names aren't resolved across answers ("ERCOT" vs "Electric Reliability Council
  of Texas (ERCOT)" stay separate `normalized` values). Needed before phase 4 compares
  entities.
- Proof: prod Postgres has no public proxy, so the run used Railway's API keys and a
  local PG17 database migrated to the same schema (`ate_task23`).
- `EXTRACTION_MODEL` is still a constant: the 2.4 registry covers the four answering models only.

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
