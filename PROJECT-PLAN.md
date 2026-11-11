# AI Topic Explorer — Project Plan

**Tracker:** https://claude.ai/artifact/Hm5BrTX5Tb8hTxaZBw6FCS

**Last updated:** November 6, 2026

## Direction

AI Topic Explorer is becoming an **internal topic-tracking tool** for Above. It tracks how
the AI systems people actually use describe the issues we work on. It reports when that
picture changes, and which sources are shaping it, so we can find insights and promote
into them.

The **public website stays up**. It gets the same durability and security work as the
backend, and picks up the new pipeline and Grok improvements as they land. It is no longer
the main product.

**Outputs are deliberately narrow:** a monthly health report, notable-change alerts, and
a Claude connector for everything else. There is no dashboard.

---

## Phase map: what can start when

Use this to jump between phases. A **hard blocker** means the work can't start, or would be
thrown away, until that piece ships. A **wait** is outside our control: a decision or
action from Josh, a vendor, or the calendar.

| Phase | Can start | Hard blockers | Waits on Josh | Calendar / vendor waits |
|---|---|---|---|---|
| **1. Durability & security fixes** | Now | None | Gemini quota (doesn't block code) | `gpt-4o` shuts down **Jan 14, 2027** |
| **2. New pipeline** | Now for design. Code after **1A** ships | **1A** (SDK upgrades) | None | None |
| **3. Grok web search** | After **2A** ships | **2A** (provider interface) | None | xAI's release pace |
| **4. Tracking** | After **2** ships | **2** (pipeline, tables, registry) | Approve the event list before **4D** goes live | Baselines only start once 4 runs |
| **5. Outputs** | **5C** after **2B**. **5A/5B** after **4** | **4** (snapshots and noise bands) | Add the org Connector; email sender | Monthly report needs ≥4 weekly snapshots; alerts need ≥2 |

**What can run side by side:**
- **Phase 1 sub-parts are independent** of each other, except 1A should land first because
  the others touch the same `package.json` and client files.
- **Phase 3 build and phase 4** both depend only on phase 2, so they can run in parallel.
  Tracking runs fine with the phase 2 Grok adapter, and phase 3 improvements fold in later.
- **5C (the connector)** can be built against the phase 2 tables while phase 4 is underway.

**Why phase 4 should not wait long:** depth and breadth comparisons, noise bands and swings
all need history. Every week before the first tracking run is a week of baseline we never
get back.

---

## Phase 1 — Durability & security fixes

Fixes from the November 2026 codebase review. Covers the public site and the shared backend.

**Blockers:** none. **Waits:** none for the code.

### 1A. Platform and dependencies (do first)
- Next 16.1.6 → 16.4.5 and Prisma 7.4 → 7.10.1, then `npm audit fix` (non-force). This
  clears the critical advisory and most of the 19 high ones.
- Anthropic SDK 0.74 → 1.x (removes the `between_tools` type cast) and openai 6 → 7.
- Gemini: move from the deprecated `@google/generative-ai` to `@google/genai`.
- Pin Node 24 (`engines`, `.nvmrc`), and bump `@types/node` to match.
- Add `railway.json` with `prisma migrate deploy` as the pre-deploy command, and take it
  out of `start`.
- Add `dotenv` explicitly, or drop it from `prisma.config.ts`.

### 1B. Retired and expiring models
- **Remove Perplexity** from the public site and the backend: client, components,
  related-questions UI, env var, and in-site copy.
- **Grok:** replace the retired `grok-3`, which xAI silently redirects to `grok-4.3`, with an
  explicit model ID. Fix the stored label.
- **OpenAI:** replace `gpt-4o` before its Jan 14, 2027 shutdown.
- **Gemini:** call `gemini-3.6-flash` directly, since `3.5-flash` is auto-routed to it.
- **Query expansion:** move from Haiku 4.5 to Haiku 5.5, with `effort: "low"` and about
  1,024 `max_tokens`.
- One `MODEL` constant per client, so the stored label can't drift from the model called.

### 1C. Cost and abuse guards (the public site stays public)
- Cap topic length at about 300 characters, on the server and in `<input maxLength>`. Keep
  only the first 4 expanded queries, each capped at about 200 characters. Pass the topic to
  the expansion model as quoted data, not as part of the instructions.
- Client IP: use the hop Railway sets, not the left-most `X-Forwarded-For` value.
- Move rate-limit counts into Postgres, so they survive deploys and work across replicas.
  Validate the request body before counting it.
- Add a daily spend cap next to the `ANALYSIS_ENABLED` kill switch.
- Stop sending every rate-limit hit to the error digest.
- Bug-report route: rate limit, field length caps, a fetch timeout, and an honest response
  when the forward fails.
- Reject scanner POSTs that carry a `Next-Action` header, so real errors show in the logs.

### 1D. Correctness
- Save the result even when the user leaves mid-analysis. Today every one of those runs is
  paid for and thrown away.
- Make the expansion timeout cancel the call (pass the signal, and set SDK `timeout` and
  `maxRetries`).
- One overall deadline under the client's 180s, plus an SSE heartbeat.
- Report JSON-block parse failures instead of only logging them (about 11% of OpenAI
  queries), and make the fallback regex non-greedy.
- Results page: validate the stored JSON with a schema that fills defaults, and add a
  version field to saved results.
- Gemini: retry the fallback model once. Smaller fixes: `NaN` frequencies from Grok, the
  model label on mixed Gemini Flash / Flash-Lite results, and safety-blocked responses.

### 1E. Tests
- Unit tests for parsing and sanitizing, the merge helpers, and `categorizeError`.

**Josh action (doesn't block code):** move the Gemini Google project to a paid tier, or
raise its quota, in Google AI Studio. 36% of Gemini queries are falling back to Flash-Lite
on per-minute quota.

---

## Phase 2 — New pipeline

The shared engine for the tracker and the public site.

**Blockers:** 1A, because the new adapters are written against the upgraded SDKs.
**Waits:** none.

### 2A. Provider interface
- One interface implemented by four providers: Claude, OpenAI, Gemini and Grok.
- Each provider is **asked plainly, the way a person would ask**, with its own web search
  turned on: OpenAI's web search tool, Claude's web search tool, Gemini's Google Search
  grounding, and Grok's web search.
- **Approximate user location** is sent wherever the provider supports it, so a Texas topic
  is asked as a Texas user would ask it. Confirm per provider which location parameters
  exist.
- The answer, the cited sources, the search queries the provider ran, the model that
  answered, token usage and cost are all recorded.

### 2B. Extraction and storage
- **One fixed extraction pass** with a single cheap model runs over every answer. It pulls
  out entities, citations, themes, and how the industry and topic are framed (themes,
  arguments for and against, tone, sources). This replaces asking each provider for a JSON
  block, which ends the broken-JSON problem and leaves each provider's answer unaltered.
- **Normalized tables** replace the single JSON blob: runs, answers, entities, citations,
  themes, and cost per answer.

### 2C. Model registry
- One table holds, per provider, the model, effort level, search setting and the date each
  value was confirmed.
- **Only the default model for free, non-paying accounts. Never the flagship tier.**
- The free-tier default is found from official help pages first (OpenAI's Free tier FAQ,
  Google's Gemini Apps help, Anthropic's plans page). Where no provider publishes it (xAI
  doesn't), the registry uses a best guess and marks it as a guess.

### 2D. Public site switch-over
- The public site moves onto the new pipeline. Answers become natural-length prose, so the
  results page needs a pass to fit. Update the in-site changelog.

---

## Phase 3 — Grok web search

**Decided (task 3.2): no X Search.** Grok gets web search only. There's no X developer
account, no X-vs-web comparison, and no X section on the public site.

**Blockers:** the build needs 2A, the provider interface.
**Waits:** xAI ships often (Grok 4.5 in July, 4.6 in August, 4.7 in September), so
re-check the model when this phase starts.

### 3A. Build
- Grok runs on xAI's Responses API with the web search tool only.
- Location goes in the system prompt, as for the other providers.
- Record `cost_in_usd_ticks` from each response as that answer's cost.
- Model: `grok-4.3`. This is a guess at what free users get; re-check it when the phase starts.

---

## Phase 4 — Tracking

**Blockers:** phase 2. **Waits:** Josh approves the event list before 4D goes live.
Snapshots can run before that.

### 4A. Watch items
- A watch item is a **topic**, an optional **geography** and an optional **sub-sector**.
  Josh sets the list.
- Confirmed first three (Josh tracks industries and topics, not clients):

  | Watch item | Asked as a user in | Sub-topics |
  |---|---|---|
  | Data centers in Texas | Austin, TX | power generation, water use, noise |
  | Oil and gas in New Mexico | Albuquerque, NM | none |
  | Renewables in Texas | Austin, TX | wind, solar, BESS |

- Sub-topics live inside their parent item, not as separate watch items: the anchor
  questions cover each sub-topic, and results break down by sub-topic.

### 4B. Question sets: depth and breadth
- **Anchor set (1.1, 1.2, …):** generated once when a watch item is created, then locked.
  Every snapshot re-asks it word for word. Comparing 1.n with 1.1 is the **depth** measure.
- **Fresh set (2, 3, …):** generated new at each snapshot, using web search so it reflects
  what's current, and asked once. Comparing it with 1.1 is the **breadth** measure. Sets
  with different questions are compared on what comes out of the answers (entities,
  citations, themes, framing), not question by question.
- **Promotion:** a fresh-set question that keeps recurring across snapshots moves into a
  second locked set with its own start date.
- **Retire, never edit:** stale anchor questions are retired so history stays comparable
  over a month, a year, or longer.
- Questions are written the way voters ask them.
- **Built (task 4.2, `lib/questions/`).** Each set is written by the model list's
  `questions` model (GPT-6 Luna, low effort): 8 anchor questions per item, 2 per sub-topic
  plus 2 overall (all 8 overall without sub-topics), no web search; 8 fresh questions per
  snapshot, with web search from the item's city.
- **Real-person voice (Josh, 2026-11-09).** Entries read like what people type into ChatGPT
  or Gemini, not a pollster: often lowercase, short, sometimes fragments or run-ons, first
  person and local ("near me", "my bill"), names people know (ERCOT, fracking, blackouts).
  Stances and worries are allowed. Each anchor set of 8 mixes about 4 plain questions, 2
  fragments and 2 stances, keeps 2 per sub-topic plus 2 overall, and is **balanced**: as
  many positive-leaning as negative-leaning entries. Every question stores its **lean**
  (neutral / negative / positive) so analysis can account for it. Fresh sets are balanced
  too. Hard rules kept: one question per entry, 2–25 words, no policy jargon, no company or
  client names, nothing about AI. If a set is short, unbalanced or off-mix, the model
  rewrites it once and the better attempt is kept. Every question carries a short **concern**
  label; fresh sets reuse recent labels when they ask about the same thing.
- **Recurring questions (task 4.2, changed in 6.6).** A fresh concern that came up in **at
  least 3 of the last 4 fresh sets**, with no locked question on that concern, is **listed**
  in the monthly report ("Questions that keep coming up"), with its latest wording. It is
  **never added to the locked questions automatically** (Josh, 2026-11-11, after security
  review L2: fresh sets are written with web search, so a narrative pushed on the web could
  otherwise lock in a leading question). A person adds one through the anchor review path.
- **Locked means locked.** A database trigger refuses any change to a question's wording, set
  or position, and any delete from a locked set. Stale questions get `retiredAt` and
  `retiredReason`. Anchor sets reach production only by migration, from a file Josh has read
  (`scripts/anchor-sets/`, `npm run questions -- --migration=…`).

### 4C. Repeats and noise
- Each anchor question is asked 2–3 times per snapshot as separate, identical calls, all
  automatic.
- Agreement across repeats separates stable findings from noise. The spread between runs
  sets each snapshot's **noise band**, and only changes beyond it count as swings.
- **Built (task 4.3, `lib/snapshots/`).** `runSnapshot()` creates the Run, gets its
  questions from `questionsForSnapshot()`, asks every locked question (anchor and promoted)
  N times as separate, identical calls (`Answer.repeat` 1…N) and each fresh question once,
  from the watch item's own city. Results go on `Run.stats` (no schema change).
- **What's compared.** From each answer's extraction: canonical entities (merged names),
  themes, cited domains, the lean of its arguments (more for, more against, even, none) and
  its tone.
- **Hold rule.** For each locked question × AI, a finding **holds** when it shows up in more
  than half of that pair's repeats and in at least two of them: with 2 repeats, both; with 3,
  any 2. Everything else that pair said is **noisy**. A pair left with one usable repeat (a
  call or its extraction failed) isn't judged. Fresh questions are asked once and aren't
  judged. `Run.stats.agreement` stores held and noisy findings per pair, with totals.
- **Noise band, in plain words.** A finding's **share** is the fraction of a snapshot's
  locked-question answers that contain it (ERCOT named in 40% of answers; texastribune.org
  cited in 25%; 30% of answers critical). One repeat round, every locked question asked once
  by every AI, is a **pass**. Nothing changes in the world between passes, yet shares still
  move; that movement is the noise. For each kind of finding we take the findings in at least
  10% of answers, measure how far each one's share moves from pass to pass, and pool them
  into one spread (σ). A snapshot's share averages its N passes, and comparing two snapshots
  carries the noise of both, so a change counts as a **swing** only when:
  - it is more than **three times** the combined noise, 3·√(σ₁²/N₁ + σ₂²/N₂), and at least
    5 points. Three, not the textbook two, because each comparison tests hundreds of findings
    at once, and at two the proof's back-to-back snapshots still showed false swings;
  - for a finding that moves more between passes than its kind does (a volatile source, such
    as one Gemini cites in 0 of 8 answers one pass and 3 the next), its own spread is used
    instead of the pooled one;
  - the finding is in at least **4 answers** on one side and its count moved by at least
    **3 answers**, so a one- or two-answer wobble never counts.

  Bands are worked out across all AIs and for each AI on its own (each AI has a quarter of
  the answers, so its band is wider). `Run.stats.noise` stores σ, passes and the band
  against a like snapshot, per kind and per AI.
- **Comparing snapshots.** `compareSnapshots()` / `compareRuns()` take two snapshots of a
  watch item and list the changes beyond the band (rose, fell, new, gone), over the locked
  questions both asked, biggest relative to its band first. Alerts (5.2) and the monthly
  report (5.3) build on it.
- **Repeats: 3 (task 4.3 proof, 2026-11-09).** Two snapshots of Data centers in Texas, 5
  minutes apart, 3 repeats each: 128 calls each, none failed, **$4.28 and $4.69** (answers,
  extractions and the fresh set). Recomputing the first from only 2 of its repeats:
  - With 2, each AI's noise is measured from a single pair of passes and comes out erratic:
    Gemini's tone σ read 0 (pure luck) while OpenAI's tone band was 53 points. With 3 it
    settles, and the all-AI bands shrink by 20–35% (entities 9.1 → 7.1 points at the
    two-width rule, argument lean 12.5 → 8.3, tone 15.6 → 11.2).
  - The majority rule lets one odd repeat through: with 3 repeats 44% of entity findings
    held, with 2 only 36%.
  - Cost: about **$4.30–4.70 a snapshot with 3 repeats vs ~$3.30 with 2**, so ~19 snapshots a
    month is ~$85 vs ~$65. The extra ~$20 a month buys bands tight enough to alert per AI;
    with 2, per-AI alerts would either miss everything or misfire. `DEFAULT_REPEATS = 3`.
  - **Calibration (A/A test).** Since the two snapshots were minutes apart, any swing between
    them is a false alarm. The first rule (two widths, pooled σ only, 3 answers) flagged 29;
    the rule above flags **0**. Checked it still sees real change by injecting one: a new
    entity in 4 of the 32 question × AI pairs (13% of answers) is flagged across all AIs, and
    one in 2 pairs of a single AI is flagged for that AI.
  - **Held vs noisy, per snapshot** (snapshot 1 / snapshot 2): entities 159 held, 203 noisy /
    161, 229; themes 73, 438 / 74, 434; domains 156, 180 / 162, 179; argument lean 32, 17 /
    30, 24; tone 32, 10 / 32, 11.
  - **Bands at 3 repeats** (all AIs, snapshot 2): entities 9.8 points, themes 13.3, domains
    8.8, argument lean 10.5, tone 9.9. Per AI they run 7–27 points, except argument lean and
    tone, at 14–50, so a single AI's tone needs a big move to count.
  - **Themes were the weak spot:** only ~14% of themes held, because they are free-text labels
    ("power demand" vs "electricity demand") matched word for word. Fixed by task 4.8 below.
- **Theme merging (task 4.8, `lib/themes/`).** Each theme mention keeps its own label and links
  to one `CanonicalTheme` per idea, per watch item (`Theme.canonicalThemeId`); findings key
  themes by it (`t:<slug>`).
  - **Why this approach.** Entity rules (2.7) work on names; theme labels are paraphrases
    ("grid demand and bills", "noise and local impacts"), so string rules and a small alias
    table alone linked 41% of mentions. Embeddings can't be trusted at any threshold to keep
    "electricity demand" apart from "electricity costs". A second extraction pass per answer
    is the costly option the task ruled out. So: a **reviewed vocabulary per watch item**
    (`lib/themes/vocab.ts`, 20–29 ideas each, tied to sub-topics, each with a description of
    what belongs and what doesn't), matched in three steps, cheapest first:
    1. **Alias table** (`ThemeAlias`): the label's key (lower case, no punctuation, singular
       words) under its sub-topic. Seeded from the vocabulary; no AI call. Run right after
       each extraction.
    2. **Label mapper**, for labels the table doesn't know: one batched call per snapshot
       (extraction model, strict output limited to the item's slugs or "new"), after the
       answers are in. Its choice is stored as an alias, so a label is mapped once, ever.
       The first pass over 2 proof snapshots mapped 817 labels for **$0.009**.
    3. **"New" escape:** a label that fits nothing gets a theme of its own (status `new`), so
       its later mentions join it and the mapper can choose it next time. `npm run themes --
       --list-new` lists them for review; `--merge=<new>:<vocab>` folds one in.
  - **Keeping ideas apart.** One idea per entry, no catch-alls. Sub-topics stay apart: a
    sub-topic entry's aliases match only labels with that sub-topic (or none), and an overall
    entry's aliases only labels with none, so "neighbor impacts" under noise goes to the
    mapper (noise effects) instead of the overall community theme. Vague labels ("impacts",
    "uncertainty", "local regulation") are always the mapper's call. Slugs never change.
  - **Proof (Nov 10, 2026, task 4.3's two local snapshots, re-linked, no new answers):**
    | | before | after |
    |---|---|---|
    | distinct themes (snapshot 1 / 2) | 393 / 407 | 85 / 103 |
    | themes held across repeats | 14.3% / 14.6% | **54.7% / 51.4%** |
    | themes in ≥10% of answers (what the band is measured on) | 5 / 3 | 21 / 21 |
    | theme noise band, all AIs | 6.3 / 13.3 pts | 7.7 / 9.3 pts |
    | A/A swings between the two | 0 | **0** |

    Before, the band rested on 3–5 themes, so it was mostly luck; now it rests on 21. An
    injected theme in 4 of 32 question × AI pairs is still flagged (all AIs, and the two AIs
    it was put in). 87% of mentions land in vocabulary themes; the other 13% are 193 new
    themes, nearly all seen once. Merged groups, for example: *water-consumption* (59
    wordings: "water use", "direct water use", "company consumption", "cooling water
    demand"…), *electricity-demand* (46: "power demand", "ai driven demand", "grid demand",
    "demand forecasts"…), *noise-rules* (46: "noise limits", "acoustic studies", "local
    regulation" under noise…). First pass flagged one A/A swing (Grok, "Effects on nearby
    communities", 6 → 1 answers): overall aliases were pulling noise-tagged labels into a
    broad theme; the sub-topic scoping above fixed it.
  - Public-site runs (no watch item) aren't linked; their themes stay keyed by label.

### 4D. Scheduling and watchers
- **Weekly snapshots** for every watch item, run by a Railway worker with no human input.
  **Built (task 4.4).** Railway cron service `weekly-snapshots` (same project as the web
  service, same repo) runs `npm run worker:weekly` (`scripts/weekly-snapshots.ts`,
  `lib/worker/weekly.ts`), one snapshot per active watch item, then exits.
  - **Schedule: `0 5 * * 1`, Monday 05:00 UTC.** That is Sunday 11pm Central in winter
    (midnight in summer, since Railway cron is UTC), so a fresh snapshot is ready Monday
    morning.
  - **Once a week.** Weeks start Monday 00:00 UTC. An item with a complete or partial
    weekly snapshot this week, or one still running (under 3 hours), is skipped; a failed
    one is retried on a re-run. One item failing doesn't stop the others, and failures and
    partial runs are recorded on the Run (status and note) and sent to error reporting.
  - **Spending cap per run:** `WEEKLY_RUN_CAP_USD` (default **$15**) shared across items,
    each snapshot capped at what's left, up to `WEEKLY_ITEM_CAP_USD` (default **$6**).
    Below $1 left, the remaining items are skipped.
  - Each snapshot stores its agreement and noise band (4.3) and, once a previous snapshot
    of the item exists, its comparison against it on `Run.stats.comparison`. Nothing is
    sent; alerts are 5B.
  - Env comes from Railway references to the web service (`DATABASE_URL`, the four AI
    keys); migrations stay with the web service only.
- **Model watcher (daily):** detects changes to the free-tier default model and updates
  the registry automatically. Each change is logged as an event. On a switch day, while the
  old model is still served, the anchor set runs on both models, so the model's own effect
  is separated from real-world change.
  **Built (task 4.5).** Railway cron service `model-watcher` runs `npm run worker:models`
  (`scripts/model-watcher.ts`, `lib/watchers/models*.ts`) at `0 13 * * *`, daily 13:00 UTC.
  - **The check:** GPT-6 Luna (the list's "questions" model) with web search limited to the
    provider's own domains, about $0.01 a provider. A change needs an official page whose
    quoted words are found when the page is fetched, an API id the provider serves, a price in
    `lib/answers/prices.ts`, no flagship tier and no older version than the current model.
    Anything less leaves the list alone and warns. Grok stays a guess unless xAI publishes.
  - **Unchanged:** only `confirmedAt` is refreshed. **Changed:** `saveModel()`, a `new_model`
    Event (approved, with its source), then each watch item's locked questions once on each
    model (old first), one `model_switch` Run per item; an info-level error-reporting notice.
  - **Once a day** (a provider confirmed today is skipped); an unfinished switch resumes on
    the next run for 48 hours. Caps: `MODEL_CHECK_CAP_USD` ($1 a run) and
    `MODEL_SWITCH_CAP_USD` ($12 a day). A switch costs about $1–3 (measured: $1.28 for Gemini).
- **Event watcher (daily, web search only, no other connectors):** only events that move AI
  answers count. An unscheduled event inside an approved category **auto-triggers** a
  snapshot. Approved categories (Josh, task 4.6):
  - **New models:** a provider changes its free-tier default model.
  - **Model policy:** changes to how a chatbot handles political or election topics, or its
    search and sourcing rules.
  - **Crawler changes:** a major publisher blocks or unblocks AI crawlers, or signs a
    licensing deal.
  - **Elections:** election days and certified results in every geography any watch item
    tracks, plus federal elections. New geographies are added automatically.
  - **Legislative sessions:** the start and end of the legislative session in every tracked
    geography.
  - **Very large news:** statewide or national news directly on a watch item. Data center
    policy announcements count; routine groundbreakings and openings don't. The bar is "big
    enough to move AI answers." Hearings never count.
  - **Rules:** an event snapshot runs about 24h after the event and may land within a day
    of a weekly snapshot, since the comparison shows the event's effect. At most 2 event
    snapshots a week. Every trigger is logged with its source.
  - **Built (task 4.7).** Railway cron service `event-watcher` (same project and repo) runs
    `npm run worker:events` (`scripts/event-watcher.ts`, `lib/watchers/events/`) **hourly**.
    Each run, every step claimed first in `WatcherJob` so a deploy-triggered run repeats
    nothing:
    - **Known dates, weekly:** official election days (and the canvass of the latest one)
      and legislative session first and last days for each tracked geography, plus
      nationwide federal elections and Congress, next 12 months. Stored as `scheduled`
      events; only `.gov` / `.us` sources are accepted; a moved date is refreshed.
    - **Scan, once a day from 12:00 UTC:** four web-search calls (AI companies and
      publishers; each tracked state; federal) with GPT-6 Luna, low effort, a strict JSON
      schema, at most 12 searches a call. Geographies come from the active watch items, so a
      new state is scanned automatically. Looks back to a day before the last scan (2–4
      days). Each event is logged with title, category, watch items, date, source URL and
      name, and why it clears the bar. A repeat of a logged story is not logged (the model
      flags it, or same source URL, or most title words shared within 4 days, or a session or
      election date in the same place within 2 days). Hearings and routine groundbreakings
      or openings are logged as `ignored`; so are events found more than 4 days late.
    - **Scheduling:** an event is one `Event` row per watch item it bears on, as the model
      names them: a state's events only to that state's items, federal news to the items it
      is about, AI-company and publisher events and calendar dates to every item in scope.
      Once its trigger time (24h after the event; date-only events count as 18:00 UTC) is
      within 3 days, it gets a slot. Events of one item within 24h share a snapshot. At most
      **2 event snapshots per item per week** (Monday 00:00 UTC); the rest are `ignored` with
      the reason in `Event.note`. No approval step.
    - **Snapshots:** due slots run `runSnapshot()` with Run kind `event`, linked through
      `Event.runId`, compared with the item's previous snapshot (`Run.stats.comparison`).
      Deferred if a snapshot of the item is already running. A failed one is retried up to 3
      times in all.
    - **Caps:** `EVENT_SCAN_CAP_USD` (default **$1**, the day's scan and the week's
      known-dates refresh each), `EVENT_SNAPSHOT_CAP_USD` (default **$5** a snapshot slot,
      across all its attempts), `EVENT_RUN_CAP_USD` (default **$15** of event snapshots per
      UTC day, across every process; the rest wait for the next day). Both read stored runs
      (task 6.6).
      A scan costs about $0.10, the weekly known-dates refresh about $0.15.
    - **What it costs in snapshots:** the calendar alone gives about 14 event snapshots a
      year at current watch items (~$60): Texas canvass, session start and end and the
      November 2027 election (2 items each), New Mexico canvass and session start and end
      (1 item), and Congress convening on Jan 3, 2027 (all 3).
    - Failures (a scope, a stage or a snapshot) are caught, logged and sent to error
      reporting (`watcher_error`, `snapshot_error`); one never stops the others.

---

## Phase 5 — Outputs

**Blockers:** 5A and 5B need phase 4 data. 5C needs only the 2B tables.
**Waits:** see each item.

### 5A. Monthly health report
- Emailed. Covers every watch item: charts of change over time, depth vs breadth, citation
  shifts, and model changes marked on the timeline.
- **Wait:** at least 4 weekly snapshots of history.
- **Built (task 5.3, `lib/reports/`).** Railway cron service `monthly-report`, 1st of the month
  14:00 UTC, for the month just ended. For each item with 4+ weekly snapshots through the
  month's end:
  - **Depth:** last month's final snapshot (or the month's first) against the month's last,
    through `compareSnapshots`, so only swings beyond the noise band are called real. Top
    themes, names, tone and argument lean with start → end shares; a line chart of the four
    most common themes at every snapshot.
  - **Breadth:** what the month's fresh answers named that no locked answer did (share of
    names, themes and sources, and the top ones by answer count).
  - **Citation shifts:** domain swings across all AIs and per AI, a start-vs-end chart of the
    top 8 sources, and each AI's top 3.
  - **Timeline:** `new_model` and other approved events, `model_switch` runs, numbered on the
    chart; event snapshots drawn as hollow dots.
  - **Location line** on every item and in the summary block.
  - **Summary:** one extraction-model call (about $0.0002) from the stored numbers only; any
    number not in the facts sends it back to a code-written summary.
  - **Email:** HTML tables with inline `cid:` PNGs (resvg, bundled Inter), ~400 KB for three
    items, plus a plain-text twin. `REPORTS_ENABLED` (off until 8.2), `REPORT_RECIPIENTS`
    (default Josh). Once per month (`WatcherJob` `report:monthly:<YYYY-MM>`).
  - **Plain language (Josh, Nov 10):** the first sample was "too complicated", so the email
    is written for a general reader: up to 3 changes per topic as "about 6 in 10 answers now,
    up from about 4 in 10", one chart, the top topics, what new questions raised, and what
    happened. No tables, bands or internal terms; the detail stays in the database for 5.4.
  - **Alerts:** each topic lists the month's 5.2 alerts (sent, or recorded while off).
  - **First real report:** weekly runs started Nov 10, so November has 3 and its Dec 1 run
    skips; the Jan 1 run (December) is the first with 4+.

### 5B. Notable-change alerts
- Sent when a change goes beyond the noise band or a new insight appears.
- **One finding, a plain-English summary** of what changed and why it might matter, so Josh
  can decide whether to follow up, **and a ready-made prompt** to dig in with Claude ("Using
  AI Topic Explorer, explain alert A-123").
- **Wait:** at least 2 snapshots, so a noise band exists.
- **Built (task 5.2, `lib/alerts/`).** `afterSnapshot(db, runId)` is called once where each
  snapshot finishes (weekly worker, event watcher, model watcher).
  - **What becomes an alert:** the swings `compareSnapshots()` already found (beyond the band).
    One finding per idea: the all-AI swing and each AI's own swing of the same thing are one
    alert, naming the AIs; tone and argument lean are one finding each. "New" swings are the
    new insights, lifted when never seen before in the watch item.
  - **Rank and cap:** times past the band, ×1.5 for all-AI, ×1.25 first seen, ×0.5 when only
    AIs whose model changed moved. At most **3 per item per snapshot**, 1 per model switch;
    the rest on one "also changed" line.
  - **Model changes:** a model-switch run compares the old model's answers with the new one's,
    judged by the item's latest snapshot noise, and is always labeled a model change. A weekly
    or event change carries a caveat when an AI that moved answered with a different model in
    the two snapshots.
  - **Subject:** `<item>: <AI> <does X> more/less · A-12`, "(model change)" for a switch.
  - **Plain first (Josh, Nov 10: "needs to be simpler").** Each email leads with one sentence
    built from the numbers, shares said as "N in 10" ("Gemini's new model cites reddit.com in
    about 1 in 10 answers, down from 5 in 10 with the old one"), then a plain "Why" for model
    changes, one sentence on what it could mean, how the AIs were asked, two examples and the
    Claude prompt. Percentages and the chance test sit in a small details line at the bottom.
  - **Writing:** the "what it could mean" sentence is the only AI-written line (GPT-6 Luna,
    ~$0.0001). Every number in it must already be in the facts, no jargon, at most ~25 words,
    or a stock sentence is used.
  - **Switches:** `ALERTS_ENABLED` (off: stored as `suppressed`), `ALERT_RECIPIENTS` (default
    Josh). Idempotent: created once per run in one transaction; each claimed before sending.
  - **Proof (Nov 10, 2026, local copies):** A/A on task 4.3's two snapshots → no alerts. Real
    Gemini switch (3.5-flash-lite → 3.6-flash): Data centers "reddit.com 50% → 13%" and O&G NM
    "Permian Basin 100% → 50%", both labeled model change; Renewables none. Injected changes
    (4 entities) → 3 alerts, the fourth on the also-changed line. Test email (alert A-2)
    accepted by SendGrid Nov 10, 2026 17:36 UTC.

### 5C. Claude connector
- MCP server, added as an org Connector, like the Meta Ad Library tool. Tools to look up
  watch items, compare snapshots, show what each provider says, and explain alerts. Event
  approvals happen here too.
- House rules: its own GitHub repo, Railway auto-deploy, its own distinct favicon, and
  `serverInfo.icons`.
- **Waits on Josh:** adding the org Connector in claude.ai, and the Google sign-in client in
  the Internal Tools project.

### Email (5A, 5B)
- **Decided (task 5.1, 2026-11-06): SendGrid**, the setup every other Above emailer uses
  (Agenda Briefings, Development Email Updates, TCEQ Comment Email, StackAdapt Daily
  Report, the Error Reporter digest). No project disagreed. One shared account, and
  `abovepublicaffairs.com` is already domain-authenticated, so no DNS work.
- Sender: **AI Topic Explorer `<topic-explorer@abovepublicaffairs.com>`**, send-only;
  replies go to joshua@abovepublicaffairs.com (`REPLY_TO`).
- Key: 1Password → Development → "API Key - SendGrid General" (`credential`), on Railway as
  `SENDGRID_API_KEY`. Other vars: `SENDGRID_FROM`, `SENDGRID_FROM_NAME`, `REPLY_TO`
  (see `.env.example`).
- Code: `lib/email/send.ts` (`sendEmail`: v3 mail/send over `fetch`, plain text + optional
  HTML, 30 s timeout, `email_error` reports). Test: `railway run npm run email:test`.

### Promote the location detail
Every report, alert and connector answer states how the AIs were asked, e.g. **"Asked as a
user in Texas."** Josh wants this called out to people.

---

## Estimated AI API cost

Free-tier default models, 4 providers, web search on. These are estimates from November
2026 list prices; real cost per answer is recorded from phase 2.

| Provider | Approx. per answer | Share |
|---|---|---|
| Claude (Sonnet-class on the free tier) | ~$0.048 | ~50% |
| Grok | ~$0.023 | ~24% |
| OpenAI (Luna-class on the free tier; mostly the search fee) | ~$0.021 | ~22% |
| Gemini (Flash-Lite on the free tier; search within the free allowance) | ~$0.003 | ~3% |

- **Per snapshot:** 8 anchor questions × 3 repeats plus 8 fresh questions = 32 questions,
  about **$3** (measured in task 4.3: $4.28 and $4.69; see §4C).
- **Per month, 3 watch items:** weekly snapshots plus a few event-triggered ones is about
  19 snapshots, or roughly **$60**. The watchers add about $5.
- Railway cost isn't a constraint.

### Measured cost (task 2.6, 2026-11-07)

A test batch through the new pipeline: 8 voter-style questions across the three watch items
(data centers in Texas and renewables in Texas asked from Austin, oil and gas in New Mexico
asked from Albuquerque), each asked once and 2 of them twice, so **10 questions, 40 answers**
(39 extractions). Models from the model list: `claude-sonnet-5-5` (medium effort),
`gpt-6-luna` (no reasoning), `gemini-3.5-flash-lite` (low thinking), `grok-4.3` (low effort);
extraction on `gpt-6-luna`. Total recorded spend **$1.46**. Script: `scripts/cost-batch.ts`
(local database only).

| Provider | Estimate | Real mean | Median | Range | Avg searches | Cost recorded as |
|---|---|---|---|---|---|---|
| Claude | ~$0.048 | **$0.040** | $0.045 | $0.012–$0.050 | 0.8 | computed |
| OpenAI | ~$0.021 | **$0.030** | $0.029 | $0.012–$0.057 | 2.6 | computed |
| Gemini | ~$0.003 | **$0.026** as recorded, **~$0.002** real | $0.023 | $0.015–$0.045 | 1.7 queries | computed |
| Grok | ~$0.023 | **$0.053** | $0.045 | $0.040–$0.081 | 3.8 | reported by xAI |
| Extraction (per answer) | — | **$0.0007** | — | $0.0003–$0.0013 | — | computed |

- **What drives it.** Search fees, not tokens. Claude is ~$0.032 of tokens plus $0.01 a
  search; its two cheapest answers ($0.012) didn't search at all. OpenAI's tokens are ~$0.004;
  the rest is $0.01 per search action, and it ran 1 to 5. Grok runs the most searches and has
  the largest token count (~28k in, ~1.7k out). Repeats of the same question vary up to 4×
  for OpenAI ($0.012 vs. $0.057) and ~2× for Gemini; Claude and Grok stay within ~10%.
- **Gemini's recorded cost overstates it.** $0.024 of its $0.026 is search priced at list
  ($14 per 1,000 queries). The first 5,000 grounding requests a month are free, and 19
  snapshots × 32 questions is ~600 requests (~1,000 queries), well inside it, so Gemini's
  real cost is its tokens, ~$0.002. That holds only while nothing else on the same key (the
  public site after task 2.5) eats the allowance. Its input tokens average ~70 because
  grounding results aren't counted as tokens; worth one look in the AI Studio billing page.
- **Grok's reported charge checks out.** xAI's `cost_in_usd_ticks` matched a list-price
  recompute from its tokens and searches to the cent ($0.0529 mean both ways). One of 10 Grok
  calls failed with a 429 "model at capacity", not a cost issue but a reliability one.
- **Not yet checked against the consoles.** Claude and OpenAI are computed from the price
  table. For a console check: the batch ran 2026-11-07 12:27–12:37 PT and recorded Claude
  $0.40, OpenAI $0.30 + $0.025 extraction, Gemini $0.26 (list) and Grok $0.48.

**Per question** (4 answers + 4 extractions): $0.15 as recorded, **~$0.13** with Gemini
search inside the free allowance (estimate ~$0.10).
**Per snapshot** (32 questions): $4.83 as recorded, **~$4.10** (estimate ~$3).
**Per month** (19 snapshots, 3 watch items): $92 as recorded, **~$78** real, plus ~$5 for the
watchers, so **~$83 against the ~$60 estimate, about 35–40% higher.** The gap is Grok (2.3×
its estimate, from heavy searching) and OpenAI (1.4×, more search actions than assumed);
Claude came in a bit under. Grok is now the largest share (~42%), then Claude (~31%) and
OpenAI (~24%).

---

## Shipped (v1, Feb–Oct 2026)

The public site: topic in, query expansion, every query fanned out to each provider in
parallel, merged word cloud, entities, citations and key themes, shareable results stored in
Postgres, a progress tracker over SSE, rate limiting, a kill switch, centralized error
reporting, a beta banner and a bug-report button. See `CHANGELOG.md` for the history.

## Standing rules

- Update the in-site changelog (`components/Footer.tsx`) on every user-facing change to the
  public site.
- Review UI work with the `make-interfaces-feel-better` skill before calling it done.
