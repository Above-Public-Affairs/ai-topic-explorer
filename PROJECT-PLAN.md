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

### 4C. Repeats and noise
- Each anchor question is asked 2–3 times per snapshot as separate, identical calls, all
  automatic.
- Agreement across repeats separates stable findings from noise. The spread between runs
  sets each snapshot's **noise band**, and only changes beyond it count as swings.

### 4D. Scheduling and watchers
- **Weekly snapshots** for every watch item, run by a Railway worker with no human input.
- **Model watcher (daily):** detects changes to the free-tier default model and updates
  the registry automatically. Each change is logged as an event. On a switch day, while the
  old model is still served, the anchor set runs on both models, so the model's own effect
  is separated from real-world change.
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

---

## Phase 5 — Outputs

**Blockers:** 5A and 5B need phase 4 data. 5C needs only the 2B tables.
**Waits:** see each item.

### 5A. Monthly health report
- Emailed. Covers every watch item: charts of change over time, depth vs breadth, citation
  shifts, and model changes marked on the timeline.
- **Wait:** at least 4 weekly snapshots of history.

### 5B. Notable-change alerts
- Sent when a change goes beyond the noise band or a new insight appears.
- **One finding, a plain-English summary** of what changed and why it might matter, so Josh
  can decide whether to follow up, **and a ready-made prompt** to dig in with Claude ("Using
  AI Topic Explorer, explain alert A-123").
- **Wait:** at least 2 snapshots, so a noise band exists.

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
  about **$3**.
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
