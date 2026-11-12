# Session Handoff — AI Topic Explorer

**Last Updated:** November 11, 2026

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
Explorer — master" chat. Done: 1.1, 1.2, 1.3, 1.4, 1.5, 3.1, 3.2 (no X Search) and 5.1. Phase 7 testing (7.1–7.3) found 20 issues; task 7.4 fixed them (see below).

## Fixes from cross-device testing (task 7.4)
- Reports: `docs/testing/7.1-desktop.md`, `7.2-iphone-safari.md`, `7.3-android-chrome.md`
  (screenshots stay on their unmerged branches).
- Key Themes near-duplicate merge is display-only, in `lib/results/theme-merge.ts`, called from
  `buildRunView`. Rule: strip topic words, filler and facet nouns (FACETS), fold SYNONYMS; two
  themes merge when one core holds the other plus at most one word. Tune FACETS/SYNONYMS there;
  `tests/theme-merge.test.ts` holds the 7.1 examples. The tracker's 4.8 merge is separate.
- `components/useKeepInView.ts` keeps a toggle in place when content above it collapses.
- `.hit-area` (globals.css) adds an invisible tap box; tune with `[--hit-x:…] [--hit-y:…]` and
  keep neighbours from overlapping.
- Short viewports (≤520px tall, below lg) slim the results header via `.results-mobile-header-*`.
- Dialog focus return remembers the last pressed control (Safari/iOS don't focus on click).
- Share: `navigator.share` only on `(pointer: coarse)`; GA `share.method` is `copy_link` or
  `share_sheet`.
- Per-result share image: `app/results/[id]/opengraph-image.tsx` (+ `twitter-image.tsx`).
- Local verification DB: `ate_task74` on localhost (copy of `ate_task52`, Analysis rows
  `local74dc`, `local74ren`, `local74og`). Production Postgres has no public proxy.
- Open: the home OG image (`app/opengraph-image.tsx`) still says "5 leading AI systems";
  7.1 #5 (bare headings as theme excerpts) is unfixed.

## Privacy policy (task 6.9)
- The site has no policy page of its own: Above's one policy at
  https://abovepublicaffairs.com/privacy-policy/ (WordPress page 61 on the `abovepa` WP Engine
  install, edited with `wp post update 61 -` over SSH; the SSH gateway has no scp) covers it.
  The URL is `PRIVACY_POLICY_URL` in `lib/privacy.ts`; `/privacy` redirects there (next.config.ts).
- Its "On AI Topic Explorer" section names the four providers, OpenAI's extraction pass, the
  GA topic parameter and 14-month event retention, the bug report fields, the 30-day Error
  Reporter prune, and `beta-banner-dismissed`. If any of those change, update the policy
  in the same session (development-guidelines privacy-policy skill), with Josh's approval.

## Review fixes (task 6.6, app half)
- Reviews: `docs/reviews/6.1-code-review.md`, `docs/reviews/6.2-security-review.md`. All
  findings in this repo fixed (H1, M1–M5, L1–L3; security M1, L1–L3). Tests:
  `tests/spend-caps.test.ts`, `tests/bug-report.test.ts`, new cases in the weekly, model,
  event, alerts and reports tests, and `tests/spend.db.test.ts` (reservation under 20
  concurrent requests). DB tests need a fresh migrated local DB each, run one file at a time.
- **Money paths, in one place:** failed-call and failed-extraction estimates and the
  per-answer search limit are `lib/answers/estimates.ts`. Failed answers sent to a provider
  store the estimate in `Answer.costUsd` with a `costNote`, so `spentSoFar` counts them.
  Snapshots gate each call through `spendGate` (`lib/snapshots/run.ts`). The public cap
  reserves `ANALYSIS_RESERVE_USD` ($0.50) in `reserveSpend` and settles in `settleSpend`.
- **Event watcher caps** read stored runs: per slot since its trigger time, per UTC day for
  all event snapshots. A SIGTERM now counts as an attempt (3 at most).
- **Alerts mid-send** are settled as sent with `UNKNOWN_SEND_NOTE` (SIGTERM release, or
  the next `afterSnapshot` after 15 min); check SendGrid's activity if one matters.
- **Recurring questions:** `recurringQuestions()` replaced `promoteRecurring()`; nothing is
  promoted. The monthly report lists them. Josh, Nov 11: "Never add automatically".
- **In-site changelog** moved from `components/Footer.tsx` to `lib/changelog.ts`.
- **X-Real-IP check:** `POST /api/bug-report` with header `x-ate-ip-check: 1` logs (yes/no
  only) whether a client-sent `X-Real-IP: 203.0.113.7` survived Railway's edge. Send it with an
  empty description so nothing is forwarded. Result Nov 11, 18:05 UTC: the edge replaced the
  client-sent value, so `X-Real-IP` can be trusted for rate limits. It did not equal the right-most
  of the 2 `X-Forwarded-For` hops, so the right-most-hop fallback in `getClientIp` isn't the
  client address; it's only used if `X-Real-IP` is ever missing.
- **Connector:** `lib/alerts/withdraw.ts` is vendored there and changed here (a stuck
  `sending` alert can be withdrawn); re-vendor on the connector's next update.
- **6.7 leftovers deferred, with reasons:**
  - Speed 2 (server-render `AnswerProse`), 4 (word context on demand): refactors of the
    results data flow, worth their own task; ~50 KB and ~30 KB gains on results pages.
  - Speed 5 (cache saved results): 50–100 ms; needs care that unreadable/not-found pages
    aren't cached and a cache that survives Railway redeploys.
  - Speed 8 (14 KB polyfills): needs a bundle analysis first to find the source.
  - Accessibility 12 (collapse the mobile header on scroll), design 10, 11, 12, 16 and the
    dark theme: design work for a design pass, not fixes.
  - Accessibility 17 rest: mobile jump links stay 32px tall; 44px would make the sticky
    header taller, which 12 is about.
  - VoiceOver pass over dialogs and announcements: needs a person with VoiceOver.

## Alerts (task 5.2)
- `lib/alerts/` (`afterSnapshot`), called once where each snapshot finishes: `lib/worker/weekly.ts`,
  `lib/watchers/events/worker.ts`, `lib/watchers/models.ts`. Never throws; failures go to error
  reporting as `alert_error`. Table `Alert` (migration `20261110190000_alerts`), readable A-1, A-2…
- **Sending is off** until task 8.2: `ALERTS_ENABLED` unset/false stores alerts as `suppressed`.
  Turn on by setting `ALERTS_ENABLED=true` (and optionally `ALERT_RECIPIENTS`) on the three cron
  services. Suppressed alerts are never sent later; only new ones are.
- Re-runs are safe (created once per run, claimed before sending). An alert a process left in
  `sending` is settled as sent, outcome unknown (task 6.6); check SendGrid's activity before resending by hand.
- Tools: `npm run alerts -- --list | --run=<id> | --show=A-n [--html=f] | --send-test=A-n`.
  Local proof DBs: `ate_task52` (real Gemini switch alerts) and `ate_task52b` (injected changes) on
  localhost:5432. DB test: `tests/alerts.db.test.ts` (env in its header).
- First real weekly alerts can come from the Nov 16 snapshot (vs the Nov 10 baselines).
- **Withdrawn alerts (4.9):** status `withdrawn` keeps an unreliable alert out of emails, the monthly
  report and (when built) the connector; read only `REPORTED_ALERT_STATUSES` from `lib/alerts`.
  A-1 to A-3 are withdrawn (Nov 10 event snapshot had no ChatGPT answers: OpenAI credits ran out).
  That snapshot itself still counts in reports as a partial run.

## Deploy-safe crons (tasks 4.7, 4.9)
- All three cron services start with `node --import tsx scripts/<name>.ts` (set in each service's
  settings; a redeploy keeps the old command, so rebuild after changing it). On SIGTERM they release
  their WatcherJob claims and `running` runs (`lib/worker/shutdown.ts`). A deploy doesn't start a
  cron run, so a weekly run stopped by a push waits for the next Monday unless retried by hand.
- Live since Nov 11, 2026 03:09 UTC (commit d8a1551). Proved in production the same night by moving
  each schedule a few minutes ahead and back: weekly skipped all 3 items ($0, "+ $14.26 earlier this
  week" of the $18 production run cap); model watcher found 4 unchanged ($0.08).
- To run a script against production by hand: the Postgres service has no public TCP proxy, so use
  `railway ssh -s ai-topic-explorer -- sh -c 'cd /app && node --import tsx scripts/<name>.ts …'`.

## Monthly report (task 5.3)
- Railway cron service `monthly-report` (same project, same repo) runs `npm run report:monthly`
  at `0 14 1 * *` for the previous month. Code: `scripts/monthly-report.ts`, `lib/reports/`
  (aggregate, load, charts, summary, template, monthly, sample). Env: references to the web
  service (`DATABASE_URL`, `OPENAI_API_KEY`, `SENDGRID_*`, `ERROR_API_*`), plus
  `REPORTS_ENABLED` (false; 8.2 switches it on) and `REPORT_RECIPIENTS` (empty = Josh).
- An item goes in once it has 4 weekly snapshots through the month's end; with none ready the
  log says "Monthly report for <Month>: skipped, not enough history yet." Nothing is claimed,
  so a later run that month can still send.
- Once sent, `WatcherJob` `report:monthly:<YYYY-MM>` is complete; to resend a month, delete
  that row. A SendGrid timeout marks it complete too (it may have been delivered).
- `--sample --out=.reports/sample [--send-to=…]` renders the synthetic sample (no DB; the
  summary needs `OPENAI_API_KEY`, else the code-written one). `--preview --month=2026-12
  --out=…` renders real data to files without sending. `.reports/` is gitignored.
- Charts need `lib/reports/fonts/*.ttf` (resvg loads no system fonts), and paths are from the
  repo root, so run from there.
- Each topic lists its alerts from the month (`Alert` rows, sent or suppressed).
- Service `monthly-report` (id `50ede79d-5ed0-4942-b749-af77e0eda7ff`) created Nov 10, 2026,
  variables referencing `ai-topic-explorer`, `REPORTS_ENABLED=false`. Test run for November
  (19:20 UTC, schedule moved ahead, then restored): all three items "not enough history yet:
  1 of 4 weekly snapshots"; "Monthly report for November 2026: skipped, not enough history yet."

## Model watcher (task 4.5)
- Railway cron service `model-watcher` runs `npm run worker:models` at `0 13 * * *` (daily
  13:00 UTC). Code: `scripts/model-watcher.ts`, `lib/watchers/models.ts` (loop, switch,
  resume), `lib/watchers/models-check.ts` (search check, evidence rules). Env: references to
  the web service, like `weekly-snapshots`; no migrations.
- Re-runs are safe: a provider whose row was confirmed today (UTC) is skipped. "Unclear"
  doesn't confirm, so it's checked again on the next run (about $0.01).
- A new default with no price in `lib/answers/prices.ts` is held as unclear: add its
  prices and the next run switches. The switch run asks the old model first, while it's served.
- Switch runs: `Run.kind = model_switch`, one per watch item, `Run.stats.modelSwitch`
  {eventId, old/new registryId, model, answered, failed}; answers carry `modelRegistryId`.
  `Event.runId` holds only the first run (one-to-one column), so find the rest by
  `stats.modelSwitch.eventId`.
- First production run (Nov 10, 2026, 17:10 UTC, schedule moved ahead for it): all four
  unchanged, 34s, $0.055 of the $1 check cap, exit 0.
- Proof of a switch: `npm run worker:models -- --providers gemini --simulate gemini=gemini-3.6-flash`
  against a local copy (it refuses anything but localhost). DB test:
  `tests/model-watcher.db.test.ts` (needs `TEST_DATABASE_URL`, a scratch copy; it changes the list).

## Event watcher (task 4.7)
- Railway cron service `event-watcher` (same project, same repo) runs `npm run worker:events`
  daily at 13:00 UTC (hourly until Nov 11, 2026, when Josh moved it). Code: `scripts/event-watcher.ts`, `lib/watchers/events/` (rules, scan, jobs, worker).
  Rules and costs are in `PROJECT-PLAN.md` §4D.
- Every step is claimed in `WatcherJob` by key (`events:scan:<day>`,
  `events:known-dates:<monday>:<geographies>`, `events:snapshot:<item>:<triggerAt>`), so a
  redeploy repeats nothing. To re-run a scan by hand, delete that day's `events:scan:` row.
- Read what it found: `Event` rows (`status` pending/approved/ignored, `note` = why ignored or
  failed, `runId` = the snapshot), and `WatcherJob.stats` for each scan's scopes, costs, drops
  and repeats.
- `npm run worker:events -- --force-scan` scans before 12:00 UTC; `--only=known,scan,schedule,snapshots`
  picks stages.
- `new_model` events are the model watcher's (4.5); this worker never touches them.
- Live since Nov 10, 2026, cron `0 13 * * *` since Nov 11 (was `15 * * * *`; service
  `36acb483-b80e-4d60-a869-b63f02948019`). It does not run on deploy, but a deploy stops a run in
  progress: the worker then marks its unfinished jobs failed, and the next day's run retries them
  (each counts as one of 3 attempts). With one run a day, an event snapshot lands 24–48h after the
  event rather than ~24h, and a failed one is retried a day later.
- DB test: `TEST_DATABASE_URL=<fresh migrated local db> npx vitest run tests/event-watcher.db.test.ts`.
  Give it its own database (see LESSONS).
- Gotcha: GPT-6 Luna at low effort runs only 2–4 searches a call, so one broad known-dates
  call missed dates; it now asks elections and sessions separately per geography. A
  one-state House runoff came back as a "federal election" until the prompt said nationwide only.

## Weekly worker (task 4.4)
- Railway cron service `weekly-snapshots` (same project, same repo) runs `npm run worker:weekly`
  at `0 5 * * 1` (Monday 05:00 UTC), one snapshot per active watch item, then exits.
  Code: `scripts/weekly-snapshots.ts`, `lib/worker/weekly.ts`.
- Its env is Railway references to the web service (`DATABASE_URL`, AI keys, `ERROR_API_*`),
  so rotating a key on the web service carries over. It doesn't run migrations.
- Safe to re-run by hand (Railway "Run now" / redeploy): items with a complete/partial weekly
  snapshot this UTC week are skipped; failed ones retry. Run cap `WEEKLY_RUN_CAP_USD`
  (default $15), item cap `WEEKLY_ITEM_CAP_USD` (default $6).
- Each snapshot's comparison against the item's previous one is on `Run.stats.comparison`.
- Gotcha: Railway cron is UTC, so it's 11pm Sunday Central in winter, midnight in summer.
- Gotcha: deploying a cron service doesn't run it (checked Nov 10, 2026, see LESSONS.md). To
  run one now, move its schedule a few minutes ahead, redeploy, then move it back.
- Baseline (Nov 10, 2026): runs `cmwa8hqj1000018pelxdia3va` (Data centers in Texas, $4.99),
  `cmwa8p83p05h318pej5mcx6xn` (Oil and gas in New Mexico, $4.68), `cmwa8vppw0ams18pekwo8lngh`
  (Renewables in Texas, $4.59); all complete, 0 failed calls. At ~$14.30 a week the $15 run
  cap is tight: the third item gets only what's left (~$5.30).

## Theme merging (task 4.8)
- `lib/themes/`: `vocab.ts` (reviewed vocabulary per watch item, keyed by `WatchItem.name`;
  never rename a slug), `key.ts` (`themeKey`: normalize + singular words), `mapper.ts` (one
  batched call, strict enum of slugs + "new"), `link.ts` (`linkThemes`, `relinkThemes`,
  `mergeThemes`, `seedThemeVocab`). Tables `CanonicalTheme` (status vocab/new) and
  `ThemeAlias` (`<sub-topic or ->|<key>`, unique per item).
- `extractAndStore` links known labels only (no AI); `runSnapshot` maps the rest before
  stats (failure only logs; unlinked themes fall back to their label). Findings key `t:<slug>`.
- `npm run themes -- --list-new` / `--merge=<new>:<vocab> --item=…` to review new themes;
  `--seed` after editing the vocabulary; `--relink --forget-mapped` after changing rules.
  Non-local DB writes need `--yes-production`. Run it on Railway via `railway ssh` into the
  web service (prod Postgres has no public proxy).
- Gotchas: OpenAI's filter sometimes refuses a harmless batch (400 invalid_prompt); the mapper
  splits and retries. Overall-vocab aliases only match labels with no sub-topic (see LESSONS).
- Local proof copy `ate_task48` (4.3's runs re-linked); numbers in `PROJECT-PLAN.md` §4C.

## Snapshots, repeats and noise bands (task 4.3)
- `lib/snapshots/runSnapshot(db, watchItemId)` is what the weekly worker (4.4) calls: locked
  questions ×3 (`DEFAULT_REPEATS`), fresh ×1, optional `maxCostUsd` cap and `askConcurrency`.
  Held vs noisy findings and the noise band go on `Run.stats` (version 1); no schema change.
- `compareRuns(db, before, after)` lists swings beyond the band; 5.2 alerts and 5.3 report
  build on it. Method and calibration in `PROJECT-PLAN.md` §4C.
- `npm run snapshot` (local DB only): `--item=… [--repeats] [--cap]`, `--report=<run> [--as-repeats=2]`,
  `--restat=<run>` (recompute stats after a method change, no AI calls), `--compare=a,b`.
- Gotchas: per-AI tone and argument-lean bands are wide (14–50 pts). If the rule or repeat count
  changes, re-run the A/A check (two snapshots minutes apart should show ~0 swings).
- Proof runs `cmw9ti9320000xki11tqnrozy` and `cmw9tp9zn00008wi15ujm7yxt` live only in the
  local DB `ate_task43`.

## Google Analytics (task 6.8)
- Property `G-6WT4RP9NQD` via Railway `NEXT_PUBLIC_GA_MEASUREMENT_ID` (build-time: a change
  needs a rebuild). Event names and params live only in `lib/analytics.ts`; a test fails on
  stray names, dead catalog entries, direct `gtag("event")` calls or the old property ID.
- An inline `<head>` stub queues events until the lazy-loaded gtag.js arrives.
- GA's config sends the landing page view even with `send_page_view: false`, so the site
  lets it and sends `page_view` only on later route changes (`components/AnalyticsTracker.tsx`,
  after Next swaps in the new `<title>`). GA's own "browser history" page views must stay off
  in the stream's enhanced measurement, or in-app pages count twice.
- `debug_mode` on `config` never reaches the hits, so `trackEvent` adds it per hit when
  `?ga_debug=1` (or `NEXT_PUBLIC_GA_DEBUG=1`) is on.
- Admin checklist `docs/ga4-setup.md`: steps 1–5 done Nov 11. Event retention is 14 months, and
  the privacy policy says so; change both together.
- Source links are counted by a `data-source-link` attribute (`answer_inline`, `answer_sources`,
  `citation_list`, `argument_list`). A new external source link without it sends nothing.
- Not seen live: `word_clicked` (word cloud shows only on old results with no key themes) and
  `bug_report_sent` (needs a real report).

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
- Voice (Nov 9, Josh): entries read like real people typing into ChatGPT/Gemini, with a
  mix of plain, fragment and stance, balanced leans, and `Question.lean` stored. See
  PROJECT-PLAN §4B.
- `lib/questions/`: `rules.ts` (sizes, `checkVoterVoice`, `checkSetShape` (balance and mix), `selectQuestions`, the promotion
  rule `findPromotions`), `generate.ts` (`generateSet("anchor" | "fresh")` with the model
  list's `questions` row, strict JSON, one retry), `sets.ts` (`draftAnchorSet`,
  `lockAnchorSet`, `retireQuestion`, `promoteRecurring`, `questionsForSnapshot`), `review.ts`
  (reviewed file → migration SQL), `watch-items.ts` (`WATCH_ITEMS`, matched by the seed
  migration in a test).
- For 4.4 (weekly worker): create the `Run` (kind weekly, watch item, ask location), call
  `questionsForSnapshot(db, { watchItemId, runId })`, then `runPipeline(db, { runId, questions:
  [...locked × repeats (4.3), ...fresh], ... })`. Labels are "set.position" (1.3, 5.2).
- **Anchor sets are locked in production** (Josh approved Nov 9; migration
  `20261109180000_lock_anchor_sets`, from `scripts/anchor-sets/2026-11-09.json`). They're
  never edited: retire a stale one with `--retire`. A future watch item follows the same path:
  draft locally, export, Josh reads it, then `npm run questions -- --migration=<file>
  --reviewed=YYYY-MM-DD > prisma/migrations/<ts>_anchor_sets/migration.sql` (the SQL skips
  items that already have set 1).
  To load a reviewed file into a local DB: `--draft-anchor --from=<file>`.
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
