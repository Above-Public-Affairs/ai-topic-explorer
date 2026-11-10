# Changelog

All notable changes to AI Topic Explorer will be documented in this file.

## [2026-11-10]

### Changed (task 5.2: simpler alert email, from Josh's feedback on A-2)
- The HTML email now matches the public site (cream background, cyan-to-violet accent, Inter, white rounded card, pill tags) and shows the change as two rows of ten dots ("5 in 10" → "1 in 10"), with small before/now bars per AI when all four moved. Built from table cells, so it shows with images off and fits a phone screen
- Each alert now leads with one plain sentence built from the numbers, such as "Gemini's new model cites reddit.com in about 1 in 10 answers, down from 5 in 10 with the old one", then a one-line "Why" for model changes, one sentence on what it could mean (the only AI-written line), how the AIs were asked, two examples and a shorter Claude prompt. Percentages and the "bigger than chance" test moved to a small details line at the bottom
- Subject: "<watch item>: <AI> <does X> more/less · A-n", with "(model change)" for model switches

### Added (task 5.2: notable-change alerts)
- `lib/alerts/`: `afterSnapshot(db, runId)` runs when each snapshot finishes (weekly worker, event watcher, model watcher; one added call in each). It turns the snapshot's changes beyond the noise band into alerts, one finding each: a change seen across all AIs and for some AIs on their own is one alert naming those AIs; tone and argument lean are one finding each
- Ranked by how far past the band, lifted for all-AI changes and for things never seen before in the watch item, cut in half when only an AI whose model changed moved. At most 3 alerts per item per snapshot (1 per model switch); the rest go on one "also changed" line
- A model-switch run compares the old model's answers with the new model's (judged by the item's latest snapshot noise) and is always labeled a model change, never real-world change. A weekly or event change from an AI whose model differs between the two snapshots carries a caveat
- Each email: a plain-English summary and "why it might matter" (one GPT-6 Luna call, about $0.0002 an alert), the evidence (before/after shares, per AI, up to 3 quoted sentences with their sources), "How the AIs were asked: Asked as a user in Austin, Texas", and a Claude prompt ("Using AI Topic Explorer, explain alert A-12", with enough context to work pasted into Claude without the connector). Every number and number word in the model's text must already be in the stored facts, with no statistics jargon, or a template summary is used instead
- Off by default: `ALERTS_ENABLED` unset or false stores alerts as `suppressed`; `true` sends to `ALERT_RECIPIENTS` (comma-separated, default joshua@abovepublicaffairs.com). Idempotent: a run's alerts are created in one transaction and never again; each is claimed (pending → sending) before it's sent. Never throws into the snapshot; failures go to error reporting (`alert_error`)
- Migration `20261110190000_alerts` (additive: enum `AlertStatus`, table `Alert` with readable `number`, A-1, A-2…)
- `npm run alerts`: `--list`, `--run=<id>`, `--show=A-n [--html=<file>]`, `--send-test=A-n [--to=]`, `--compare=<before>,<after>` (local proofs)

### Added (task 5.3: monthly health report)
- `npm run report:monthly` (`scripts/monthly-report.ts`, `lib/reports/`): one email a month covering every watch item, run by Railway cron service `monthly-report` on the 1st at 14:00 UTC for the month just ended
- Per item: depth (the locked questions from last month's final snapshot to this month's last, through `compareSnapshots`, so only changes beyond the noise band are called real), breadth (what the fresh sets named that no locked answer did), citation shifts (all AIs and per AI), model changes and events numbered on the timeline, and the "Asked as a user in …" line
- A plain-English summary at the top from one extraction-model call that sees only the stored numbers; a guard rejects any number not in those facts and falls back to a summary written by code
- Charts are SVG rendered to PNG with resvg (Inter fonts bundled in `lib/reports/fonts/`), sent as inline `cid:` images so Gmail and Outlook show them with no JavaScript; plain-text twin included
- Waits for history: an item needs 4 weekly snapshots through the month's end; with none ready the run logs "not enough history yet" and stops. Off by default (`REPORTS_ENABLED=false`); recipients from `REPORT_RECIPIENTS` (default Josh). Once per month via `WatcherJob` key `report:monthly:<YYYY-MM>`; a send with no answer from SendGrid isn't retried
- Sample mode (`--sample [--out=dir] [--send-to=…]`): seeded synthetic snapshots with injected changes, marked "SAMPLE DATA" in the subject, banner and every chart. `--preview --month=YYYY-MM` renders real data to files without sending
- `sendEmail` takes optional `attachments` (inline when given a `contentId`). No schema change
- Written for a general reader (Josh's review of the first sample): "What AI is saying: <Month>", a short version at the top, then per topic the location line, up to 3 plain changes ("about 6 in 10 answers now, up from about 4 in 10"), one chart, the top topics, what new questions brought up, and what happened that month. No tables or internal terms
- Each topic lists the month's alerts (task 5.2), sent or recorded while sending was off

### Added (task 4.8: merge themes worded different ways)
- `lib/themes/`: each watch item's theme mentions link to one `CanonicalTheme` per idea ("power demand" and "electricity demand" are one theme), from a reviewed per-item vocabulary (`lib/themes/vocab.ts`): alias table first (no AI call, right after each extraction), then one batched label-mapper call per snapshot for unseen labels (stored, so each label is mapped once), with a "new" theme for labels that fit nothing. Each mention keeps its own label
- Snapshot findings key themes by canonical theme (`t:<slug>`); `runSnapshot()` links the snapshot's themes before computing stats (signature unchanged; mapper cost added to the run's cost)
- Migration `20261110120000_theme_merge` (additive: tables `CanonicalTheme`, `ThemeAlias`, nullable `Theme.canonicalThemeId`)
- `npm run themes`: `--seed`, `--link`, `--relink [--forget-mapped]`, `--groups`, `--list-new`, `--merge=<from>:<into>`, `--restat=<runs>`. Writes to a non-local database need `--yes-production`
- Proof on task 4.3's two local snapshots: themes held 14% → 51–55%, distinct themes ~400 → ~95 per snapshot, A/A comparison still 0 swings, mapper cost $0.009

### Added (task 4.5: model watcher)
- `npm run worker:models` (`scripts/model-watcher.ts`, `lib/watchers/models.ts`, `lib/watchers/models-check.ts`): a daily check of each provider's free-tier default model. Runs as Railway cron service `model-watcher`, daily 13:00 UTC
- The check asks the model list's "questions" model (GPT-6 Luna) with web search limited to the provider's own domains, about $0.01 a provider. A change counts only with clear evidence: an official page, the quoted words found on it when fetched, an API model id the provider serves, priced in `lib/answers/prices.ts`, not a flagship tier and not an older version than the current model. Anything less is "unclear": the list is left alone and a warning goes to error reporting
- Unchanged: only the row's `confirmedAt` is refreshed. Changed: `saveModel()` retires the old row and adds the new one (effort, search and location carried over), a `new_model` Event is logged (approved, with its source), then every watch item's locked questions are asked once on the old model and once on the new, one `model_switch` Run per item, and an info-level notice goes to error reporting
- Once a day (a provider confirmed today is skipped, since every deploy runs the cron); a switch whose runs didn't all finish resumes on the next run, within 48 hours. Caps: `MODEL_CHECK_CAP_USD` (default $1) per run, `MODEL_SWITCH_CAP_USD` (default $12) per day. One provider failing never stops the others
- `runPipeline` takes `models`, to ask a provider with a given model-list row instead of the current one
- No schema change: each switch run names its event and both registry rows on `Run.stats.modelSwitch`; `Event.runId` points at the first one
- Local proof: a simulated Gemini switch (flash-lite → 3.6-flash) updated the list, logged the event and ran 3 items × 8 questions × 2 models, 48/48 answered, $1.28. The first real check of all four caught two stale official pages (an old Sonnet 5 launch post, the out-of-date GPT-5.6 help page); both were held back

### Fixed (task 4.7: event watcher survives deploys)
- A push to `main` redeploys every service and stops a running cron. The event watcher now marks its unfinished scan or snapshot failed (and the snapshot's Run) when stopped, so the next hourly run retries it; an orphaned job is retried after 50 minutes instead of 3 hours. Being stopped doesn't use up one of a job's 3 attempts. The cron starts the worker with `node --import tsx`, since npm and the tsx CLI don't pass the stop signal on

### Added (task 4.7: event watcher)
- `npm run worker:events` (`scripts/event-watcher.ts`, `lib/watchers/events/`), run hourly by Railway cron service `event-watcher`: weekly refresh of official election and legislative-session dates (Texas, New Mexico, federal; next 12 months; `.gov`/`.us` sources only), a daily web-search scan from 12:00 UTC for events in the approved categories except `new_model` (model policy, crawler changes, elections, legislative sessions, very large news), scheduling, and due event snapshots
- Each event is logged with its source (URL and name), date, watch items and why it clears the bar; repeats of a logged story aren't logged again; hearings and routine groundbreakings or openings are logged as ignored
- An event triggers a snapshot of each affected watch item about 24h after it happened (Run kind `event`, linked to the event, compared with the item's previous snapshot); events within 24h share one; at most 2 event snapshots per item per week, the rest logged as ignored with the reason. No approval step
- Caps: `EVENT_SCAN_CAP_USD` ($1), `EVENT_SNAPSHOT_CAP_USD` ($5), `EVENT_RUN_CAP_USD` ($15). Failures go to error reporting
- Migration `20261110170000_event_watcher` (additive): `Event.note` and a `WatcherJob` table, the once-only ledger that makes every step safe to repeat when the cron runs on deploy

## [2026-11-09]

### Added (task 4.4: weekly snapshots on a Railway worker)
- `npm run worker:weekly` (`scripts/weekly-snapshots.ts`, `lib/worker/weekly.ts`): one weekly snapshot per active watch item, then exit. Runs as Railway cron service `weekly-snapshots`, Monday 05:00 UTC (Sunday 11pm Central in winter)
- Once-a-week guard (weeks start Monday 00:00 UTC; complete, partial or still-running snapshots block a second one, failed ones are retried), one item's failure never stops the others, and a spending cap shared across the run (`WEEKLY_RUN_CAP_USD`, default $15; `WEEKLY_ITEM_CAP_USD`, default $6)
- Each snapshot's comparison against the item's previous snapshot goes on `Run.stats.comparison`; a one-line summary per item in the logs (questions, calls, failures, cost, held/noisy); failures, partial runs and cap stops go to error reporting

### Added (task 4.3: repeats and noise bands)
- Snapshot runner `runSnapshot()` (`lib/snapshots/`): creates the Run, gets its questions from `questionsForSnapshot()`, asks each locked question 3 times (separate, identical calls, `Answer.repeat` 1–3) and each fresh question once, from the watch item's city, with an optional spending cap. `npm run snapshot` runs, reports, recomputes or compares snapshots against a local database
- Agreement across repeats per locked question × AI over canonical entities, themes, cited domains, argument lean and tone. A finding holds when it appears in more than half of the repeats and at least 2 (2 repeats: both; 3: any 2). Held and noisy findings stored on `Run.stats.agreement`
- Noise band per snapshot, per kind of finding, across all AIs and per AI, from the pass-to-pass spread of shares; stored on `Run.stats.noise`. `compareSnapshots()` / `compareRuns()` list changes beyond it (3 noise widths, a volatile finding judged by its own spread, at least 4 answers and a 3-answer move). Method in `PROJECT-PLAN.md` §4C
- `runPipeline` takes `askConcurrency` (provider calls in flight); a call still queued when the run is stopped isn't made
- No schema change: results go in the existing `Run.stats` column
- Local proof: two Data centers in Texas snapshots 5 minutes apart, $4.28 and $4.69, 0 failed calls; 0 swings between them (29 under the first, looser rule), while an injected change in 13% of answers is caught

### Added (task 4.2: anchor sets locked)
- The three watch items' anchor sets, as Josh approved them, are inserted locked by migration `20261109180000_lock_anchor_sets` (24 questions, each with its sub-topic, concern and lean). Josh reworded data centers 1.2 ("will all these data centers make my electric bill go up") and 1.3 ("how much water does a data center actually use") as neutral questions. Snapshots can now run

### Changed (task 4.2 rework: questions in a real person's voice)
- Question sets now sound like real people typing into ChatGPT or Gemini, not a pollster (Josh's call): lowercase, fragments, first person and local, stances allowed. Each anchor set mixes about 4 plain questions, 2 fragments and 2 stances, and balances leans (as many positive as negative). Each question stores its lean (`Question.lean`: neutral, negative or positive; migration `20261109120000_question_lean`, additive). The loaded-word check is gone; the balance check replaces it. New reviewed anchor drafts in `scripts/anchor-sets/2026-11-09.json` (replaces 2026-11-07.json), hand-edited; solar now covers land and property values, and every positive anchor question has a negative counterpart. Prompt version `2026-11-09.1`. Local proof: 3 fresh sets, all balanced; $0.048 spent

### Changed (task 6.8: new GA4 property, fully wired)
- GA4 moves to property `G-6WT4RP9NQD` (Railway `NEXT_PUBLIC_GA_MEASUREMENT_ID`); the old property's ID is gone from the code and a test keeps it out
- One typed event catalog in `lib/analytics.ts`: `trackEvent(name, params)` only accepts catalog events and their params; a test fails on any event name outside it, any catalog event never sent, or a direct `gtag("event")` call elsewhere
- Page views on every route: GA's config counts the landing page (it does even with `send_page_view: false`), and `components/AnalyticsTracker.tsx` sends `page_view` on each later pathname change, once the new page's title is in (same URL never twice, previous page as referrer). Needs GA's "browser history" page views off in enhanced measurement, or each in-app page counts twice
- gtag.js still loads `lazyOnload`, but an inline `<head>` stub defines `gtag`/`dataLayer` first, so events fired before it loads are queued, not dropped
- New events: `analysis_started`, `analysis_completed` (duration, AIs answered/asked), `analysis_abandoned`, `error_shown` (by type and area), `results_viewed` (new/old layout, from a shared link), `share` and `shared_link_opened` (share links carry `?ref=share`), `source_link_opened` (domain only), `modal_opened`, `bug_report_sent`. Renamed: `theme_click` → `theme_clicked`, `word_cloud_click` → `word_clicked`, `answer_tab` → `answer_tab_selected`, `new_topic_from_results` → `new_topic_clicked`; `analysis_error` → `error_shown`; `methodology_opened`/`bug_report_opened` → `modal_opened`; `share_clicked` → `share`; `bug_report_submitted` → `bug_report_sent` (on success only)
- Privacy: no user IDs; Google signals and ad personalization off; `topic_searched` keeps the topic text (Josh's call). `?ga_debug=1` turns on DebugView for that tab's session
- GA admin checklist (key events, custom dimensions and metrics, retention, enhanced-measurement switches) in `docs/ga4-setup.md`

## [2026-11-07]

### Fixed (task 6.7: public-site accessibility, speed and design review fixes)
- Tailwind v4 syntax: 150 `text-[--var]`-style classes compiled to empty rules; converted to `-(--var)`. Tokens darkened in the same change so they pass AA once they render: `--text-secondary` #475569, `--text-tertiary` #5b6577, `--accent-cyan` #0e7490. Every visible text node on home and both results layouts measures ≥4.5:1 (min 4.74:1). `@source not "../docs"` keeps the review notes' quoted class names out of the CSS
- Citations: each answer's sources are ordered by where the answer first links them (`lib/results/sources.ts`), and inline `[n]` markers render as small pills numbered by their URL's place in the list, so Grok's markers match "Sources it cited". Display only: stored answers are unchanged
- Sources: de-duplicated across tracking params (`utm_*`, `fbclid`, `gclid`, `ref`), `www.` and trailing slashes; junk titles (PDF headers, dates, paragraphs, bare domains) fall back to a title made from the URL, then the domain
- Claude's leading "I'll search for…" narration is dropped when the answer is shown (view only; `lib/answers/claude.ts` and stored text untouched)
- Attribution: "Built by Above Public Affairs" → abovepublicaffairs.com replaces the retired Canter Company credit (footer and results sidebar)
- Accessibility: shared native `<dialog>` (`components/Dialog.tsx`) for How it works, theme in context, bug report and changelog (focus moved, held and returned; Escape; scroll lock); floating keywords `aria-hidden`, pausable, paused during a run, still under reduced motion; global reduced-motion rule; provider badges `-700` on `-50` at 11px; labelled search input with a visible focus ring; input read-only (not disabled) during a run so focus stays; progress announced through a `role="log"` region; status shown by icon + text; errors in `role="alert"` with `aria-invalid`/`aria-describedby`, `red-700`; `<main id="content">` + skip link; mobile results header is a `<header>` with `scroll-padding-top`; one `<h1>` per results page; "Link copied" announced; collapsed answers open when focus enters them; context excerpts shown without Markdown
- Design: answer prose 17px / 1.7 at a 68ch measure; friendly model names; old-layout notice with "Run this topic again"; bug button icon-only (44px) below `lg` with bottom padding on results; home copy and meta/OG description describe the current product; `color-scheme: light`
- Speed: beta banner rendered on the server and hidden before paint by an inline script when dismissed (no layout shift); results layouts are separate client chunks, so old results no longer download the Markdown renderer (−49 KB gzipped); GA loads `lazyOnload`; Geist Mono not preloaded; results pages get `<title>` from the topic via `generateMetadata`

### Added
- Watch items and question sets (task 4.2). Migration `20261107230100_seed_watch_items` seeds the three watch items Josh confirmed, each with the city it's asked from and its sub-topics: Data centers in Texas (Austin; power generation, water use, noise), Oil and gas in New Mexico (Albuquerque; none), Renewables in Texas (Austin; wind, solar, BESS), plus a model-list row with the new `role = questions` (GPT-6 Luna, low effort). `lib/questions/` writes each item's locked anchor set (set 1, 8 questions covering every sub-topic, no web search) and a fresh set per snapshot (8 questions, web search from the item's city), checks every question reads the way a voter asks, and promotes a fresh concern seen in 3 of the last 4 snapshots into its own locked set. `questionsForSnapshot()` returns what a snapshot asks: the locked questions plus a new fresh set, once per run, and refuses until the anchor set is locked. Migration `20261107230000_question_sets` (additive: the enum value, nullable columns `Question.concern/why/retiredReason` and `QuestionSet.model/modelRegistryId/promptVersion/costUsd/generation`, and a trigger that stops locked questions being edited or deleted). `runPipeline` takes an existing `runId`. `npm run questions` drafts, locks, exports and lists sets locally, and turns a reviewed file into a migration. Local proof: 3 anchor sets $0.0007, 3 fresh sets $0.068. Anchor sets aren't in production yet: they wait for Josh to read the reviewed file
- Entity merging (task 2.7): the same organization, place, law or person named different ways counts as one `CanonicalEntity` across answers and runs ("ERCOT", "Electric Reliability Council of Texas (ERCOT)"; "PUCT", "PUC", "Public Utility Commission of Texas"; "SB 6", "Senate Bill 6"; "Gov. Greg Abbott", "Greg Abbott"). Each `Entity` row keeps its wording and links to its canonical entity; `EntityAlias` holds the keys it's matched by. Rules in `lib/extraction/canonical.ts`, no second AI pass: name cleanup ("U.S.", "Senate Bill", "Inc", person titles), "Full Name (ACRONYM)", "X of Texas" ↔ "Texas X", acronyms of full names matched only when unambiguous, and the extraction model's new `canonicalName` per entity (prompt version `2026-11-07.3`). Different things with similar names stay apart: two full names sharing an acronym, the same bill number in two states, a surname alone, people vs. organizations. Linked after every extraction under a Postgres advisory lock; `npm run entities:merge` rebuilds the merge over everything stored. Proof run (3 questions × 4 AIs): 82 mentions, 40 distinct names before merging, 29 entities after
- The extraction model is in the model list (task 2.7): a `ModelRegistry` row with the new `role = extraction` (GPT-6 Luna, effort none, confirmed Nov 7, 2026, source the OpenAI pricing page), read by `getExtractionModel()`. `getModels()`/`askAll()` still return only the four answering AIs. `Extraction.modelRegistryId` records the row used. Migration `20261107200000_entity_merge_and_extraction_model` (additive: two tables, nullable columns, `role` defaulting to `answer`, and the seed row)
- Public site on the new pipeline (task 2.5). `/api/analyze` asks each configured AI the visitor's topic once through `lib/answers` (models from the model list, so Gemini moves from 3.6 Flash to the free default, 3.5 Flash-Lite), runs the extraction pass on each answer as it lands, and saves `Analysis.result` as a v3 pointer `{ schemaVersion: 3, topic, runId }`. Results page shows each AI's full answer as Markdown prose in tabs with its cited sources, tone and framing, plus themes, arguments for/against, entities (people, organizations, places, laws) and sources combined across AIs. v1/v2 saved results still open on the old layout. Guards kept: kill switch, topic cap, real IP rate limit, daily spend cap (now the run's computed answer + extraction cost, plus $0.15 per call the deadline cut off, $1 if the run fails partway), 170s deadline (answers stop at 140s, extraction at 160s), save-on-leave. No location is sent. `runPipeline` gained `onAnswer` and `extractionSignal`, and extracts each answer as soon as it lands
- Measured AI cost (task 2.6): a 40-answer test batch (10 voter-style questions from Austin and Albuquerque) puts real cost per answer at Claude $0.040, OpenAI $0.030, Gemini ~$0.002 (search inside Google's free allowance; $0.026 at list), Grok $0.053, extraction $0.0007. A month of tracking 3 watch items comes to about $83, not the $60 estimated; details in `PROJECT-PLAN.md`. `scripts/cost-batch.ts` reruns the batch against a local database
- Model list (task 2.4): each provider is asked with its free, non-paying account's default model, never the flagship, read from the `ModelRegistry` table by `lib/answers/registry.ts` (`getModel`, `getModels`; rows re-read every 5 minutes; built-in defaults if the table can't be read). Data migration `20261107180000_seed_model_registry` seeds it, confirmed Nov 7, 2026 from official pages: Claude `claude-sonnet-5-5` at medium effort (claude.com/pricing, Sonnet 5.5 launch post), OpenAI `gpt-6-luna` at effort none (ChatGPT release notes, Oct 7), Gemini `gemini-3.5-flash-lite` at thinking level low (Gemini Apps "About Gemini models"), Grok `grok-4.3` at low effort, marked a guess (xAI publishes nothing). `saveModel()` and `npm run models:seed` write a row the way the model watcher (task 4.5) will. Gemini 3.5 Flash-Lite prices added to the price table
- Extraction pass and pipeline runner (task 2.3). `lib/extraction/` runs one fixed extraction over each answer's plain text with one cheap model (`EXTRACTION_MODEL` = GPT-6 Luna, strict JSON schema, prompt version `2026-11-07.2`): tone, framing, entities, themes (optionally tied to a sub-topic), arguments for and against the industry or topic, and the sources it cites. Stored in `Extraction`, `Entity`, `Theme`, `Argument`; URLs the provider didn't report go in `Citation` as `origin = extracted`. A failed extraction is stored with `errorMessage`
  - `lib/pipeline/run.ts` (`runPipeline`): asks the providers plainly through `lib/answers` (no JSON block), stores a `Run`, one `Answer` per provider (failures too) with its citations, extracts every answer, and sets the run's status and total cost. `lib/pipeline/backfill.ts` extracts any stored answer that has none
  - `scripts/run-pipeline.ts`: `railway run npm run pipeline:run -- "question"` (`--topic=`, `--only=`, `--backfill`). Proof run: 4/4 answers extracted, about $0.0007 per answer
- Test suite (task 1.6): `npm test` runs Vitest over answer parsing (`parseStructuredData` and each analyze-flow client, with recorded answers and mocked SDKs), result merging, error labels (the analyze route's and `ProviderError` kinds), the stored-result reader (including a v1 Perplexity-era result) and the dated price table. No network calls or API keys
- GitHub Actions CI (`.github/workflows/ci.yml`): lint, typecheck and tests on every push to `main` and every PR
- Tables for the tracking pipeline (task 2.2), migration `20261107120000_tracking_tables`. Additive only: `Analysis`, `RateLimitCounter` and `DailySpend` are untouched, so saved results load as before.
  - `Run` (a snapshot or public-site run), `Answer` (one provider's answer: text, model asked for and answered, search queries, usage, location and how it was sent, cost with source and price ids, or the typed error), `Citation` (cited vs. only looked at, by domain)
  - `Extraction` (the one extraction pass: model, prompt version, tone, own cost) with `Entity`, `Theme` (optionally tied to a sub-topic) and `Argument` (for/against)
  - `WatchItem` (topic, geography, the city it's asked from) with `SubTopic`, `QuestionSet` (anchor, promoted, fresh) and `Question` (retired, never edited)
  - `ModelRegistry` (provider, model, effort, search setting, location mode, date confirmed, whether it's a guess) and `Event` (category, source, trigger time, linked snapshot)

### Fixed
- Public results page lists each merged entity (task 2.7's `CanonicalEntity`) once, under its canonical name, so "HARC" and "Houston Advanced Research Center (HARC)" no longer show as two rows

### Removed
- `lib/ai-clients/`, query expansion, and the JSON parse/merge code (`lib/analysis/merge-*`, `provider-errors`), with their tests. `geminiErrorBody` and `REQUEST_MAX_RETRIES` moved into `lib/answers/`

### Changed
- The tracker pipeline (`lib/answers/`) no longer hard-codes models: each provider takes its model, effort and location mode from the registry (or from `settings` passed to `ask`), and every answer reports `modelRegistryId` and `effortLevel`. Gemini moves from 3.6 Flash to 3.5 Flash-Lite, because free Gemini app users have been on Flash-Lite since Oct 9, 2026. Claude now sends medium effort (thinking stays off). The public site (`lib/ai-clients/`) is unchanged until task 2.5
- The analyze route's error labelling and per-provider merge moved, unchanged, to `lib/analysis/provider-errors.ts` and `lib/analysis/merge-provider-responses.ts` so tests can import them (a Next route file can't export helpers)

### Fixed
- Provider interface (task 2.1), checked against a real Gemini grounded answer now that task 1.7 moved Gemini to a paid tier:
  - Gemini sources are the real page URLs. Google returns short-lived `vertexaisearch.cloud.google.com` redirect links; each is resolved with one HEAD request, and kept as-is if that fails
  - Gemini cached input tokens are priced at the cached rate instead of the full input rate

### Changed
- The price table has dates: a row can say when it starts and ends, and costs use the prices in force that day. Gemini 3.6 Flash's token prices double on Jan 1, 2027 and have rows for both periods. The grounding row notes 5,000 free requests a month, then $14 per 1,000 (each query billed), capped at 1,500 a day

## [2026-11-06]

### Fixed
- Results are lost less often (task 1.5):
  - A result is saved even when the visitor leaves mid-analysis. Those runs were paid for and thrown away. A visitor who leaves during expansion still skips the provider calls
  - One overall deadline (170s, under the browser's 180s): provider calls stop 10s before it so merging and saving fit. A 15s SSE keepalive comment keeps the connection open while providers are silent
  - Query expansion is actually cancelled at its timeout: the abort signal reaches the SDK, which also gets a 12s `timeout` and `maxRetries: 1`
  - A missing, cut-off or unparseable JSON block is reported per provider (`json_parse_failure`, warning) instead of only logged. The fallback parser matches braces from the object that holds `"entities"` instead of a greedy regex that ran to the last `}` in the answer
  - The results page reads saved results through a zod schema (`lib/results/stored-result.ts`) that fills defaults and drops bad entries. New results carry `schemaVersion: 2`; older ones read as 1. A result with no topic or no surviving answers shows a page offering to rerun the topic, and is reported
  - Gemini retries its Flash-Lite fallback once
  - Grok quoted-phrase frequencies can't be `NaN`; a provider answered by two models (Gemini Flash and Flash-Lite) names both; an empty answer (OpenAI's `content_filter`) counts as a failure, not an empty success; safety blocks and refusals read "Blocked by the provider's safety filter"; a 402 for depleted prepaid credits reads "Quota exhausted"
  - The home page no longer has hydration mismatches: the floating keywords and example topics are picked in the browser only, and the examples fade in
- `zod` is a direct dependency (it was only installed through the AI SDKs)

### Removed
- `components/MethodologySection.tsx`, imported nowhere

### Changed
- Plan: §2B extracts how the industry and topic are framed, not named clients; §4A records the three confirmed watch items with their locations and sub-topics; §4D records the approved event-watcher categories and rules (task 4.6)

### Added
- Provider interface for the tracker (task 2.1, not yet used by the public site): `lib/answers/` asks Claude, OpenAI, Gemini and Grok one plain question with each one's own web search on and an approximate user location. Each answer records the answering model, cited vs. looked-at sources, the searches run, token usage, location mode and cost in USD
  - Location goes in the search tool's parameter for Claude and OpenAI, and in a system message ("by prompt") for Gemini and Grok, whose search takes none
  - Grok moved to xAI's Responses API with web search only (task 3.3); its cost is xAI's own `cost_in_usd_ticks`. The others are priced from one table, `lib/answers/prices.ts`, with a source and date per row
  - A provider that fails throws a typed `ProviderError` saying why (quota exhausted, rate limited, auth, blocked, unavailable, timeout)
  - `scripts/ask-providers.ts` asks all four a test question as a user in Austin, Texas
- Email sending (task 5.1), for the coming alerts and monthly report: SendGrid, the same account Above's other tools use, from AI Topic Explorer `<topic-explorer@abovepublicaffairs.com>`. `npm run email:test` sends a test email
- Cost and abuse guards on the public site (task 1.4):
  - Topics are capped at 300 characters (form and server). Each analysis runs at most 4 queries of up to 200 characters, and the topic reaches the expansion model as quoted data, not as instructions
  - Rate limits are kept in Postgres (`RateLimitCounter`), so they survive deploys and work across replicas: 10 analyses and 5 bug reports per visitor per hour. Malformed requests don't count
  - The visitor's IP comes from Railway's `X-Real-IP` instead of the spoofable left-most `X-Forwarded-For` value
  - Daily AI spend cap, `DAILY_SPEND_CAP_USD` (default $50; 0 turns it off), estimated from token usage in `DailySpend`. One alert the day it's crossed
  - Bug reports: length caps on every field, an 8-second forward timeout, and an honest error when the report can't be sent
  - Scanner POSTs with a `Next-Action` header get a 404 from `proxy.ts`, so they stop filling the error logs

### Changed
- Rate-limit hits are logged, not sent to the error digest
- Phase 3 of the plan drops X Search (task 3.2): Grok gets web search only on the Responses API

### Removed
- Perplexity, from the site and the backend: its client, the related-questions section, its progress entry and badge, and the in-site copy. Its Sonar API ended Sep 27, 2026. Results saved earlier still open; their Perplexity badges on entities and citations still show
- `railway.json`. Railway ignored it for this service, so migrations never ran from it. `npx prisma migrate deploy` is now the pre-deploy command in the service settings

### Changed
- Each provider now runs the model free consumer users get by default, set by one `MODEL` constant per client so the stored label always matches the model called:
  - ChatGPT: `gpt-4o` (shuts down Jan 14, 2027) → `gpt-6-luna` with reasoning off, matching Free's Instant default
  - Grok: the retired `grok-3` → `grok-4.3` at `low` reasoning effort. xAI doesn't name the free-tier model, so this is a best fit
  - Gemini: calls `gemini-3.6-flash` directly (`gemini-3.5-flash` was auto-routed to it)
- Query expansion: Claude Haiku 4.5 → Haiku 5.5, with `effort: "low"` and 1,024 `max_tokens` so its default thinking fits
- Provider labels and badge colors live in one place (`lib/providers.ts`) instead of six copies
- The Open Graph image renders on the Node runtime; Next 16.4 deprecates the Edge runtime
- `package.json` approves install scripts for `prisma`, `@prisma/engines`, `protobufjs` and `unrs-resolver` (`allowScripts`), since npm 11.20 blocks unapproved install scripts by default
- New project plan: AI Topic Explorer becomes an internal tool that tracks how AI describes Above's issues over time. The public site stays up and gets a durability pass (see `PROJECT-PLAN.md`); a `LESSONS.md` file was added
- Security upgrade: Next.js 16.1.6 → 16.4.5 and Prisma 7.4 → 7.10.1, plus `npm audit fix`. `npm audit --omit=dev` goes from 22 vulnerabilities (1 critical, 19 high) to 0
- AI SDKs brought current: `@anthropic-ai/sdk` 0.74 → 1.6 (sends API version 2026-10-21; the `between_tools` cast is no longer needed) and `openai` 6 → 7. Models and behavior are unchanged
- Gemini moved from the deprecated `@google/generative-ai` to `@google/genai`. Same models, retries, Flash-Lite fallback, safety and thinking settings. Error details are parsed from the new SDK's `ApiError`, and a blocked response still fails the provider
- Node pinned to 24 (`engines`, `.nvmrc`, `@types/node`)
- Database migrations no longer run inside `npm start` (they were meant to move to `railway.json`; see Removed)
- Provider clients are created on first use, so `next build` no longer needs API keys in the environment
- `dotenv` is now a direct dependency (`prisma.config.ts` imports it)

### Fixed
- Lint passes again: the beta banner and the home page's rotating placeholder and `?topic=` prefill no longer call `setState` inside effects (flagged by `react-hooks/set-state-in-effect`)

## [2026-10-28]

### Changed
- Error reporting now uses `@above-public-affairs/error-reporter` 0.2 (replaces `canter-error-reporter`): records the running release at startup and waits for reports to send before exit.
- Claude analysis now runs on Claude Sonnet 5.5 (`claude-sonnet-5-5`), up from Sonnet 4.5 — cheaper per token ($2 / $10 per MTok vs $3 / $15). Thinking is turned off with `thinking: {type: "between_tools"}` (Sonnet 5.5 rejects `disabled`) so thinking tokens don't eat the 4096-token cap, matching how Gemini is run
- Gemini now runs on `gemini-3.5-flash` (thinking still off via `thinkingBudget: 0`). The rotated Gemini key lives in a new Google project, and Google no longer serves `gemini-2.5-flash` to new projects ("no longer available to new users"). `gemini-3.8-flash` is Google's suggested replacement but was timing out under high demand when tested
- Raise Claude's `max_tokens` from 4096 to 8192, matching OpenAI, Perplexity and Grok. Sonnet 4.5 already hit the 4096 cap often, losing the trailing JSON block (entities, citations, themes), and Sonnet 5.5's tokenizer spends ~30% more tokens on the same text
- The shared analysis prompt now asks for roughly 1,000-1,500 words of analysis, so the JSON block has room and long generations finish inside the 150s per-query timeout. This shortens Claude and Gemini, which ran ~2,000-3,000 words; OpenAI was already near this length
- A JSON block left unclosed by a cut-off response is now stripped from the analysis text, instead of its keys and URLs feeding the word cloud
- A Claude safety decline (`stop_reason: "refusal"`) now fails the provider with "Claude declined to analyze this topic" instead of passing through as an empty analysis

### Fixed
- Gemini now retries Google's transient errors (503 "high demand", 429, 500) up to twice, waiting about 1s and then 3s with jitter. A 429 that names its own wait is honored when that wait is 8s or less. The `@google/generative-ai` SDK never retries on its own, so in the first live analysis after the Gemini 3.5 Flash deploy, 4 of Gemini's 5 queries failed on a single 503
- When retries run out, or a 429 asks for a longer wait, the query falls back to `gemini-3.5-flash-lite` (with `thinkingLevel: "minimal"`, since Flash-Lite rejects `thinkingBudget: 0`) instead of failing. The result records the model that actually answered
- Classify provider failures on the SDK error's own `status` and `code` before matching message text. Gemini prefixes every error with the full request URL, so the HTTP status sat past the 120-char display cut and every Gemini failure was reported as an opaque `Error fetching from https://…gemini-2.5-flash…`. Gemini errors now read as auth / permission / model-not-found / rate-limit, and the URL prefix is stripped from any unclassified message
- Report OpenAI `insufficient_quota` 429s as "Quota exhausted — check the provider's billing" instead of "Rate limited". A quota 429 doesn't clear on retry, so the old label pointed at traffic when the fix is billing
- `provider_failure` reports now also carry the provider's error `code` (OpenAI) and `reason` (Gemini, e.g. `API_KEY_INVALID`)
- The `invalid.*key` auth check was a literal-string `includes()`, so it never matched; it's now a regex

## [2026-09-16]

### Fixed
- Guard the SSE stream's `controller.close()` the way `enqueue()` was already guarded. Four early-return paths in `app/api/analyze/route.ts` closed the controller and then returned through a `finally` that closed it again, throwing `Invalid state: Controller is already closed` out of the stream's `start()`. Closing is now idempotent and owned solely by the `finally`
- A client that disconnects mid-analysis no longer files a bogus `stream_error` report. Next.js cancels the stream when the user navigates away, which made the handler's own `controller.close()` throw and get caught and reported as an application fault. The stream now tracks its closed state (including via a `cancel()` handler) and aborted requests are no longer reported

## [2026-08-20]

### Fixed
- Validate and normalize the model-authored JSON block (entities, citations, key themes) at the parse boundary. A response that drifted from the requested schema — people as bare strings, `theme` instead of `phrase`, a citation with no URL — reached the merge helpers untouched and threw `Cannot read properties of undefined (reading 'toLowerCase')`, discarding every successful subtopic query for that provider. Recoverable shapes are now coerced instead of dropped, so a malformed field costs one item rather than the whole provider
- Pass the timeout's AbortSignal through the OpenAI, Gemini, Perplexity, and Grok clients. Only Claude honored it, so a timed-out query at the other four kept running to completion on the provider's side — still consuming rate-limit budget for a result nobody reads. This was the main self-inflicted source of Perplexity rate limiting
- Give provider requests a retry budget of 4 (up from the SDK default of 2). The OpenAI-compatible SDKs honor `retry-after`, so a transient 429 now clears instead of killing the subtopic query
- Stagger the subtopic query starts against each provider by 400ms instead of opening all of them in the same instant, and add the offset back to each query's deadline so the generation budget is unchanged
- Internal errors (e.g. a TypeError handling a response) no longer surface a raw JavaScript message in the UI; they read "Could not process the provider's response" while the full detail goes to the error report
- `provider_failure` reports now carry the provider's own diagnostics — HTTP status, `retry-after`, and the API's message — plus whether other subtopic queries succeeded, so a rate limit that will clear is distinguishable from a quota ceiling that won't

## [2026-08-06]

### Fixed
- Claude streams are now accumulated as deltas arrive, so a query cancelled by the provider timeout returns the partial analysis instead of discarding it. Only a stream that produced no text at all fails
- Raise the per-provider query timeout from 90s to 150s. A 4096-token generation with every expanded query running against every provider at once can legitimately exceed 90s, so healthy requests were being cancelled mid-stream and reported as failures
- Timeout errors now name the provider and the subtopic query that timed out, and `provider_failure` reports include the query plus how many expanded queries were in flight

## [2026-07-22]

### Fixed
- Stream Claude responses instead of buffering the full non-streaming reply, reducing "Timed out after 90s" provider failures on long generations
- Provider timeouts now abort the underlying request via AbortSignal instead of leaving it running in the background

## [2026-03-12]

### Fixed
- Increase provider timeout from 60s to 90s to reduce Claude timeouts on complex topics
- Add 15s timeout to query expansion to prevent indefinite hangs
- Reduce Claude max_tokens from 8192 to 4096 for faster response times

## [2026-03-10]

### Added
- Beta announcement banner at the top of every page with dismissible localStorage persistence
- Floating "Report a Bug" button in bottom-right corner with modal form
- Bug report API route that forwards user-submitted reports to centralized Error Reporter

## [2026-02-15]

### Added
- Show specific error reasons when an AI provider fails (e.g., "Timed out after 60s", "Rate limited", "API overloaded")
- Error details now visible during analysis loading and on the results page failure banner

### Changed
- Switch error reporting from local Prisma ErrorLog to centralized Error Reporter API (HTTP-based, fire-and-forget)
- Remove ErrorLog Prisma model and related migration

### Fixed
- Long entity names, citations, and word context excerpts no longer overflow on small screens

## [2026-02-14]

### Fixed
- Upgrade Gemini from deprecated 2.0 Flash to 2.5 Flash (with thinking disabled) to fix failures
- Disable Gemini safety filters so sensitive topics (politics, social issues) aren't blocked
- Increase per-provider timeout from 45s to 60s so Claude has enough time to respond
- Switch Gemini from thinking model (2.5 Flash) to non-thinking model (2.0 Flash) to prevent timeouts
- Add 45-second per-provider timeouts so one slow AI provider can't stall the entire analysis
- Retry database save on failure instead of navigating to broken results page
- Add 3-minute client-side stream timeout so analysis doesn't hang forever
- Validate results data before rendering to prevent crashes on malformed records
- Cancel server-side AI calls when client disconnects to save API costs
- Fix rate limiter memory leak from orphaned cleanup interval
- Fix TypeScript type assertion for Perplexity API return_related_questions parameter

### Changed
- Update site metadata description to include all 5 AI platforms (Claude, ChatGPT, Gemini, Perplexity, Grok)
- Update OG social card image with 5 provider dots and refreshed tagline
- Update Apple icon to show 5 dots representing all AI providers
- Change Grok pill color from blue to red to match X/Twitter branding
- Remove disclaimer text from X Perspective quoted phrases section
- Hide changelog link on results page to reduce sidebar clutter
- Replace bulky Web Perspective section with lightweight Perplexity section showing only related questions
- Show top 10 citations with same-domain companions instead of capped-at-25 list; compact single-line layout
- Cap named entities at 15 per category (people/organizations), sorted by number of mentions
- Add explainer text under Named Entities section header
- Show provider pills (Claude, GPT, Gemini) next to each named entity
- Redesign Grok X / Social Perspective section to show quoted phrases from X/Twitter
- Rename section to "X Perspective" with Grok platform pill, clarify phrases are AI-generated
- Cut X Perspective phrases from 15 to 8 and request longer, fuller talking points
- Add explainer subtitles to Citations and Related Questions sections

### Added
- Add Grok (xAI) as 5th AI provider with separate "X / Social Perspective" section
- Add topic pre-fill from URL query parameters for Explore Further links
- Add changelog modal to footer
- Add GA4 analytics, event tracking, and increase max AI response length
- Add OpenAI, Gemini, and Perplexity providers for multi-AI comparison

## [2026-02-13]

### Fixed
- Fix mobile overflow on Key Themes, Citations, and main content area

### Added
- Add OG/Twitter metadata, expand floating keywords, and improve UI polish
