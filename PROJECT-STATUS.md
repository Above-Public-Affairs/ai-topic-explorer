# AI Topic Explorer - Project Status

**Last Updated:** November 11, 2026

## Current Status: Live in production (beta), new direction planned

**Task 6.6 (review fixes, app half, Nov 11):** every high and medium finding from the code
review (6.1) and security review (6.2) in this repo is fixed, and every low one is fixed;
the spending caps now hold when runs fail, retry or get stopped by a deploy. Recurring
fresh questions are no longer locked automatically (Josh's call); the monthly report lists
them. 6.7 leftovers done or deferred as listed in `SESSION-HANDOFF.md`.

**Task 5.3 (monthly health report, Nov 10):** `lib/reports/` builds one email a month for
every watch item: depth (only changes beyond the noise band called real), breadth, citation
shifts, model changes and events on the timeline, the location line, and a short AI summary
checked against the numbers. Railway cron service `monthly-report` runs the 1st at 14:00 UTC;
it waits for 4 weekly snapshots, so the first real report is Jan 1, 2027 (for December). Off
until `REPORTS_ENABLED=true` (task 8.2). Production test run for November logged the "not enough history yet" skip. Josh found the first sample too complicated; it's now written for a general
reader, and the revised sample was sent and checked in Gmail.

**Task 4.7 (event watcher, Nov 10):** Railway cron service `event-watcher` runs hourly: a
daily web-search scan (about $0.10) for events in Josh's approved categories, a weekly refresh
of official election and session dates, and an event snapshot of each affected watch item
about 24h after an event (max 2 per item per week, $5 cap each), every trigger logged with its
source (`PROJECT-PLAN.md` §4D). Proven locally: real scan and calendar, one event snapshot ($4.44).

**Task 4.5 (model watcher, Nov 10):** Railway cron service `model-watcher` checks each
provider's free-tier default daily at 13:00 UTC, about $0.04 a day. A clear change updates the
model list, logs a `new_model` event and asks every watch item's anchor questions on both
models (`PROJECT-PLAN.md` §4D). Proven locally with a simulated Gemini switch ($1.28). First production run Nov 10, 17:10 UTC: all four unchanged, $0.055.

**Task 6.8 (new GA4 property, Nov 9):** the site sends to GA4 `G-6WT4RP9NQD` (Railway
`NEXT_PUBLIC_GA_MEASUREMENT_ID`), with page views on every route and a typed event catalog in
`lib/analytics.ts`. GA admin setup (key events, custom dimensions, retention) is the checklist
in `docs/ga4-setup.md`.

**Task 6.7 (public-site review fixes, Nov 7):** the critical/high accessibility findings
(6.3), the design P0s and P1s (6.5) and speed fixes 1–3 (6.4) are fixed; reviews are in
`docs/reviews/`. What's left for 6.6 is listed in `SESSION-HANDOFF.md` under "Public-site
review fixes (task 6.7)".

**Nov 6, 2026:** the project is pivoting to an internal topic-tracking tool. The public
site stays up and gets a durability and security pass. The full plan, with the five new
phases and what blocks each one, is in `PROJECT-PLAN.md`. Work runs from the project
tracker (https://claude.ai/artifact/Hm5BrTX5Tb8hTxaZBw6FCS). Done: 1.1 (plan docs),
1.2 (platform upgrade), 1.3 (Perplexity removed, models replaced), 1.4 (cost and
abuse guards), 1.5 (stop losing results) and 3.1 (Grok research, not yet merged). Task 3.2 decided: no X Search.
Task 2.1 (provider interface, also covering 3.3) is built and proven live for all four
providers, and waits for Josh's merge approval. Task 1.7 (Gemini on a paid Google tier) is done.
Task 2.2 (tracking tables) is built: migration `20261107120000_tracking_tables` adds 13
tables beside the public site's. Proven on a copy of production (Postgres 17.11 dump over
`railway ssh`): migration applied, no schema drift, all 122 saved results still render. Prod also
records a `20260215120000_add_error_log` migration that isn't in the repo; `migrate deploy` ignores it.
Task 2.4 (model list) is built: `lib/answers/` reads each provider's model from `ModelRegistry`,
seeded by data migration `20261107180000_seed_model_registry`. Gemini's free default is now
Flash-Lite (since Oct 9, 2026), so the tracker asks `gemini-3.5-flash-lite`; the public site
still runs `gemini-3.6-flash` until task 2.5.
Task 2.3 (extraction pass + pipeline runner) is built: `lib/extraction/` and
`lib/pipeline/`. One real run (4 providers, Railway keys, local copy of the schema):
4/4 answers extracted, about $0.0007 per answer with GPT-6 Luna. No provider is asked for
a JSON block in the new pipeline; the public site still uses `lib/ai-clients` until 2.5.
Task 2.7 (entity merging + extraction model in the model list) is built: `CanonicalEntity`
and `EntityAlias` (migration `20261107200000_entity_merge_and_extraction_model`), rules in
`lib/extraction/canonical.ts`, linked after each extraction. Proof run: 82 mentions, 40
distinct names, 29 entities after merging (30 by rules alone, without the model's
`canonicalName`). After deploy, run `npm run entities:merge` on Railway once to merge
entities stored before 2.7 (there are none in production yet unless the pipeline has run).
Task 2.5 (public site on the new pipeline) is built: `/api/analyze` runs `runPipeline` (kind
`public`, no location, topic asked once with no subtopic expansion) and saves a v3 `Analysis`
row that points at its `Run`. The results page reads v3 results from the run tables
(`lib/results/run-view.ts`) and v1/v2 blobs as before. `lib/ai-clients/` and the JSON
parse/merge code are gone. Spend cap counts real answer + extraction cost, plus $0.15 per
call cut off by the deadline. Local proof: 4/4 answered and extracted in ~40s, $0.15 total.
Task 2.6 (real cost) is done: 40 answers cost $1.46. Real per answer: Claude $0.040, OpenAI $0.030,
Gemini ~$0.002 (search free inside the allowance), Grok $0.053. About **$83/month** for 3 watch
items against the $60 estimate, mostly Grok's searching. Figures in `PROJECT-PLAN.md`.
Task 4.2 (watch items and question sets) is built: the three watch items are seeded by
migration, `lib/questions/` writes anchor and fresh sets and applies the promotion rule
(3 of the last 4 snapshots; written down in `PROJECT-PLAN.md` §4B). Proven locally: anchor
sets for all three items ($0.0007) and one fresh set each ($0.068). **Anchor sets
approved by Josh on Nov 9** (real-person voice, balanced leans, `Question.lean` recorded; he
reworded data centers 1.2 and 1.3 as neutral questions) and locked into production by
migration `20261109180000_lock_anchor_sets` from `scripts/anchor-sets/2026-11-09.json`.
Snapshots can now run. Task 4.4 (weekly worker) is built: Railway cron service `weekly-snapshots` runs `npm run worker:weekly` every Monday 05:00 UTC, one snapshot per active watch item, with a once-a-week guard and a $15 run cap (`PROJECT-PLAN.md` §4D). First production baseline stored Nov 10, 2026 (05:13–05:28 UTC): all three watch items complete, 128 calls each, 0 failed, $4.99 / $4.68 / $4.59 = $14.26.
Task 5.2 (notable-change alerts) is built: `lib/alerts/` makes at most 3 alerts per item per snapshot from the stored comparison (1 per model switch, labeled a model change), each with a checked plain-English summary, evidence, "Asked as a user in …" and a Claude prompt (`PROJECT-PLAN.md` §5B). **Sending is off** (`ALERTS_ENABLED`; alerts are stored as suppressed) until task 8.2. The first real alerts can come from the Nov 16 weekly snapshot.
Task 4.3 (repeats and noise bands) is built: `lib/snapshots/` runs a snapshot (locked
questions ×3, fresh ×1), stores held vs noisy findings and the noise band on `Run.stats`,
and `compareSnapshots()` lists changes beyond the band. 3 repeats chosen from the proof
(~$4.30–4.70 a snapshot, ~$85/month); method and numbers in `PROJECT-PLAN.md` §4C. Two
local snapshots 5 minutes apart compare with 0 swings.
Task 4.8 (theme merging) is built: `lib/themes/` links each theme mention to one theme per
idea from a reviewed per-item vocabulary (alias table, then one batched mapper call per
snapshot, "new" for the rest). On the 4.3 proof snapshots themes held 14% → 51–55%, A/A
still 0 swings (`PROJECT-PLAN.md` §4C). Production backfill of the Nov 10 baseline runs after
deploy (`npm run themes -- --link --yes-production`, then `--restat=` the three runs).

Key findings from the Nov 6 codebase review that drive phase 1:
- Perplexity's Sonar Chat Completions API ended Sep 27, 2026. Perplexity is being
  removed, not migrated.
- `grok-3` was retired May 15, 2026 and is silently redirected to `grok-4.3`.
- `gpt-4o` shuts down Jan 14, 2027.
- `npm audit`: 22 vulnerabilities (1 critical, 19 high), mostly from Next 16.1.6 and
  Prisma 7.4.
- About 11% of OpenAI queries lose their JSON block (entities, citations, themes)
  without any report.
- Gemini: 36% of queries fall back to Flash-Lite on the new Google project's per-minute
  quota.
- No outright failed analyses and no real 5xx errors in production from Oct 12 to Nov 6
  (11 real analyses in that time).

Deployed on Railway with four providers (Claude, ChatGPT, Gemini, Grok). Ongoing work is reliability hardening
driven by production error reports.

### Tests and CI (task 1.6, 2026-11-07)
- `npm test` (Vitest, `tests/`): 122 tests over parsing, merging, error labels, the
  stored-result reader and prices. Recorded answers and error bodies live in
  `tests/fixtures/`; SDKs are mocked, so no network or keys.
- CI: `.github/workflows/ci.yml` runs lint, `npm run typecheck` and `npm test` on push
  to `main` and on PRs. It runs `prisma generate` and `next typegen` first (both outputs
  are gitignored).

### Model list (task 2.4, 2026-11-07)
- `lib/answers/registry.ts`: `FREE_TIER_DEFAULTS` (seed + fallback), `getModel`/`getModels`
  (current rows, `retiredAt` null, cached 5 min; fallback per provider when there's no row
  or the database can't be read), `saveModel` (refresh the confirmation, or retire and replace).
- Confirmed Nov 7, 2026 from official pages; `sourceUrl` and `note` on every row:

  | Provider | Model | Effort | Location | Guess | Source |
  |---|---|---|---|---|---|
  | Claude | `claude-sonnet-5-5` | medium | parameter | no | claude.com/pricing (Free: Sonnet, Haiku); Sonnet 5.5 post (apps default to medium) |
  | OpenAI | `gpt-6-luna` | none | parameter | no | ChatGPT release notes, Oct 7 (Free tier FAQ still says GPT-5.6 Luna) |
  | Gemini | `gemini-3.5-flash-lite` | low | by prompt | no | support.google.com/gemini/answer/18648722 (free: Auto or Flash-Lite) |
  | Grok | `grok-4.3` | low | by prompt | **yes** | xAI names no free-tier model |

- Gemini's help page gives no version; 3.5 is the newest Flash-Lite in the API
  (`gemini-flash-lite-latest` resolves to it). Free Gemini "Auto" sends some prompts to
  Flash or Pro; the tracker asks Flash-Lite only.
- Test run 2026-11-07 against a scratch registry (all four answered on their registry row,
  Austin TX, same question as 2.1): Claude $0.043, OpenAI $0.025, Gemini $0.029, Grok $0.042.

### Provider interface (task 2.1, also 3.3, 2026-11-06)
- `lib/answers/`: `AnswerProvider.ask(question, { location })` for Claude, OpenAI,
  Gemini and Grok, plus `askAll()`. Sits beside the analyze flow, which is unchanged
  (the clients only export their `MODEL` constants now).
- Search: Claude `web_search_20250305` (the 20260209 tool cited nothing), OpenAI
  Responses `web_search`, Gemini Google Search grounding, Grok Responses `web_search`.
- Location: tool parameter for Claude and OpenAI; system message (`by_prompt`) for
  Gemini and Grok.
- Errors: every failure is a `ProviderError` with a `kind` (`quota_exhausted`,
  `rate_limited`, `auth`, `blocked`, `unavailable`, `timeout`, `other`). Gemini's quota
  429 maps to `quota_exhausted` and isn't retried.
- Cost: Grok from `cost_in_usd_ticks`; others from `lib/answers/prices.ts`, whose rows
  can carry `from`/`until` dates (Gemini 3.6 Flash token prices double 2027-01-01).
  Gemini search is priced at list ($14/1k, per query) even inside the 5,000/month
  free allowance.
- Gemini sources: grounding returns expiring redirect links, resolved to the real URL
  with one HEAD request each.
- Test run 2026-11-07 (Austin, TX; "Are data centers raising electricity bills in
  Texas?"): Claude $0.070 (9 cited / 8 looked at), OpenAI $0.035 (3 / 58), Gemini
  $0.031 (11 / 0, 2 queries), Grok $0.041 (10 / 18). Total $0.176.

### Email sending (task 5.1, 2026-11-06)
- SendGrid, as in every other Above emailer; details in `PROJECT-PLAN.md` §Email.
  `lib/email/send.ts` exports `sendEmail()`; `scripts/send-test-email.ts` is the test.
- Railway vars `SENDGRID_API_KEY`, `SENDGRID_FROM`, `SENDGRID_FROM_NAME` are set. A test
  email was accepted by SendGrid on 2026-11-07 07:14 UTC.

### Cost and abuse guards (task 1.4, 2026-11-06)
- All guard logic lives in `lib/guards/*`, `lib/rate-limit.ts` and `proxy.ts`. The
  analyze route calls `guardAnalyzeRequest()` at entry and `recordSpend()` once usage is in.
- Topic ≤300 chars, ≤4 queries of ≤200 chars, topic passed to expansion as quoted data.
- Postgres rate limits (`RateLimitCounter`, fixed hourly windows, hashed IPs): analyze
  10/h, bug reports 5/h. IP from Railway's `X-Real-IP`.
- `DAILY_SPEND_CAP_USD` (default $50, 0 = off), estimated per UTC day in `DailySpend`
  from token usage with deliberately high per-provider rates. Analyze fails closed
  (503) if the DB check fails; bug reports fail open.
- `proxy.ts` 404s any POST with a `Next-Action` header. The app has no Server Actions;
  remove it if one is ever added.

### Models (task 1.3, 2026-11-06)
- Perplexity removed everywhere. Old saved results still render; their Perplexity
  response is ignored, and its entity and citation badges still show.
- Each client has one `MODEL` constant that is also the stored label. Claude
  `claude-sonnet-5-5` (unchanged), OpenAI `gpt-6-luna` (reasoning `none`), Gemini
  `gemini-3.6-flash` (Flash-Lite fallback unchanged), Grok `grok-4.3` (reasoning
  `low`), expansion `claude-haiku-5-5` (effort `low`, 1,024 max tokens).
- The Grok choice is unconfirmed: xAI doesn't name the model behind grok.com's free
  "Fast" mode. Revisit in task 3.3 (Responses API, web search only).
- `railway.json` deleted; the pre-deploy command is set in the service settings.

### Platform upgrade (task 1.2, 2026-11-06)
- Next 16.4.5, Prisma 7.10.1, `@anthropic-ai/sdk` 1.6, `openai` 7, Gemini on
  `@google/genai`; Node pinned to 24. Production audit: 0 vulnerabilities.
- Migrations run as the Railway pre-deploy command, set in the service settings
  (`railway.json` was ignored and is deleted).
- `next build` needs no API keys; lint and type check are clean.
- **Open:** the local Gemini key's Google project returned 402 "prepayment credits
  depleted" on 2026-11-06. Check whether production's key is affected.

### Recent reliability work
- **Rotated the Anthropic (analysis + expansion), OpenAI and Gemini keys (2026-10-28).**
  On 2026-10-27 one analysis lost Claude (401), query expansion (401), OpenAI (429,
  out of quota) and Gemini at once while Perplexity and Grok succeeded — account and
  key problems, not code. New keys are stored in 1Password (Development vault,
  "AI Topic Explorer - …") and set on Railway. The new Gemini key's Google project
  needed the Gemini API enabled.
- **Provider failures are now classified by the SDK's `status` / `code` / `reason`**
  instead of message text. Gemini errors were unreadable (the URL prefix pushed the
  status past the 120-char display cut), and OpenAI `insufficient_quota` showed as
  "Rate limited".
- **Models:** Claude analysis is now Claude Sonnet 5.5 (`claude-sonnet-5-5`, thinking
  off via `between_tools`, refusal fails the provider). Gemini is now
  `gemini-3.5-flash` — Google no longer serves `gemini-2.5-flash` to new projects.
- **Truncation:** Claude `max_tokens` 4096 → 8192, the shared prompt targets ~1,000–
  1,500 words of prose, and a cut-off JSON block no longer leaks into the word cloud.
- **Fixed the `stream_error` "Invalid state: Controller is already closed" report.**
  Two distinct bugs in `app/api/analyze/route.ts`, both from `controller.close()`
  being called unguarded while `controller.enqueue()` (via `emit`) was already
  wrapped. (1) Four early-return paths — the two `signal.aborted` checks,
  all-providers-failed, and DB-save-failed — closed the controller and then
  returned *through* a `finally` that closed it again; a throw from `finally`
  bypasses the sibling `catch`, so this escaped as an unhandled rejection out of
  `start()`. (2) When a user navigates away mid-analysis Next.js cancels the
  stream, so the handler's own tidy-up `close()` threw, was caught by the stream's
  `catch`, and was filed as a `stream_error` — an application fault report for a
  user simply leaving. Closing is now idempotent via a `closeStream()` helper and
  owned solely by the `finally`; a `cancel()` handler marks the stream closed on
  disconnect; and `reportError` is skipped when `signal.aborted`, which also
  suppresses the wider class of disconnect noise (aborted in-flight provider work
  rejecting). Note the user-visible impact was nil — the client returns as soon as
  it reads the `error` event — so no in-site changelog entry was added.
- **Fixed a provider-crashing bug found via production error reports.** A `grok`
  `provider_failure` traced back to `lib/ai-clients/shared.ts`: the model's JSON
  block is parsed and cast to the declared types with no per-item validation, so
  when a response drifted from the requested schema (entities as bare strings,
  `theme` instead of `phrase`, a citation missing its url) the merge helpers threw
  `Cannot read properties of undefined (reading 'toLowerCase')` and discarded that
  provider's entire result — including subtopic queries that had already
  succeeded. Same latent bug existed for all five providers, not just Grok.
  `parseStructuredData` now runs each item through a sanitizer that coerces
  recoverable shapes and drops what it can't, so one malformed field costs one
  item instead of the whole provider.
- **Reduced the self-inflicted share of Perplexity rate-limit failures.** Only
  `claude.ts` accepted the timeout's `AbortSignal` — OpenAI, Gemini, Perplexity,
  and Grok silently dropped it, so a timed-out request kept running to completion
  on the provider's side, still consuming rate-limit budget for a result nobody
  reads. All four clients now accept and pass the signal. Also staggered the (up
  to 5) subtopic query starts per provider by 400ms instead of firing them in the
  same instant — the deadline gets the offset added back so no query loses budget
  — and raised the OpenAI-compatible clients' retry budget 2 → 4 to let a
  transient 429 clear via the SDK's `retry-after`-aware backoff.
- `provider_failure` reports now carry the provider's HTTP status, `retry-after`,
  and API message, plus `succeededQueries`/`failedQueries`, so a clearing rate
  limit is distinguishable from a hard quota ceiling without guessing. Internal
  errors (a TypeError, not a provider response) now show the user "Could not
  process the provider's response" instead of a raw JS message.
- Claude analyzer now accumulates text/usage from stream deltas directly instead of
  waiting on `finalMessage()` — an aborted stream returns whatever text arrived instead
  of discarding it. Only a stream that produced no text at all still throws.
- Raised the per-provider query timeout from 90s to 150s. With every expanded query
  (up to 5) fired at every provider at once, per-stream throughput degrades under load
  and a normal ~2,000-token generation can legitimately exceed 90s.
- Timeout errors and `provider_failure` reports now name the specific provider + query
  that timed out, so future reports are diagnosable without guessing which of the
  concurrent calls failed.
- Follow-up candidate: only Claude streams its response — applying the same pattern to
  OpenAI, Gemini, Perplexity, and Grok is still open.
- Follow-up candidate: Perplexity is still sent all (up to 5) expanded queries despite
  contributing only citations/related questions (excluded from word cloud/themes/entities)
  — trimming its fan-out to 1-2 queries would cut its request rate ~60% and further reduce
  rate-limit exposure, but changes its result depth so wasn't bundled into this fix.

---

## Completed (v1 build)

### Phase 1: Foundation
- [x] Next.js 16 project initialized (TypeScript, Tailwind, App Router)
- [x] Prisma 7 with PostgreSQL adapter and Analysis schema
- [x] Homepage with input form, example topic chips, methodology section
- [x] Footer with attribution (Built by The Canter Company)
- [x] Environment variables configured (.env, .env.example)
- [x] next.config.ts set to standalone output for Railway

### Phase 2: AI Integration (Claude Only)
- [x] TypeScript type definitions (AIResponse, AnalysisResult, entities, citations, TokenUsage)
- [x] Claude client wrapper (now Claude Sonnet 5.5) with structured prompt + JSON extraction
- [x] API route with kill switch, rate limiting, parallel execution, DB save
- [x] In-memory rate limiter (10/hour per IP)
- [x] Query expansion — Haiku generates 3-4 subtopic queries before analysis for broader coverage
- [x] Separate API key (`ANTHROPIC_EXPANSION_API_KEY`) for expansion usage tracking
- [x] Token usage logging (input/output per call, tagged expansion vs. analysis)

### Phase 3: Text Analysis
- [x] Word frequency extraction with stop-word filtering
- [x] Word frequency merging across providers
- [x] Entity deduplication by normalized name
- [x] Citation deduplication by URL with provider tracking

### Phase 4: Visualization
- [x] Results page loading from Postgres by ID
- [x] Combined word cloud component (@cp949/react-wordcloud)
- [x] Entity list with clickable links (People, Orgs, Locations, Concepts)
- [x] Citation list with provider badges and AEO Checker callout
- [x] Progress tracker component
- [x] Share button (copy URL to clipboard)
- [x] Partial failure banner
- [x] "Analyze Another Topic" navigation

---

## To-Do

See `PROJECT-PLAN.md`. It holds the five phases, the phase map of blockers and waits, and
cost estimates:
1. Durability & security fixes
2. New pipeline
3. Grok web search (no X Search, per task 3.2)
4. Tracking
5. Outputs

**Josh action (task 1.7): done 2026-11-07.** Production's `GOOGLE_AI_API_KEY` is on a
paid-tier Google project, and Search grounding works.
