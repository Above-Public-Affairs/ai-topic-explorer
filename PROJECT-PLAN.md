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
  out entities, citations, themes, and how named clients and opponents are framed. This
  replaces asking each provider for a JSON block, which ends the broken-JSON problem and
  leaves each provider's answer unaltered.
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
- First three: "data centers in Texas", "oil and gas in New Mexico", "renewables in Texas".

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
  answers count: new models, model policy changes, crawler changes, elections, and very
  large news. Hearings don't count. Josh approves the categories and any known dates. An
  unscheduled event inside an approved category **auto-triggers** a snapshot about 24 hours
  later.

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
