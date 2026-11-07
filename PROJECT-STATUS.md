# AI Topic Explorer - Project Status

**Last Updated:** November 6, 2026

## Current Status: Live in production (beta), new direction planned

**Nov 6, 2026:** the project is pivoting to an internal topic-tracking tool. The public
site stays up and gets a durability and security pass. The full plan, with the five new
phases and what blocks each one, is in `PROJECT-PLAN.md`. Work runs from the project
tracker (https://claude.ai/artifact/Hm5BrTX5Tb8hTxaZBw6FCS). Done: 1.1 (plan docs),
1.2 (platform upgrade) and 3.1 (Grok research, not yet merged).

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

Deployed on Railway with all five providers. Ongoing work is reliability hardening
driven by production error reports.

### Platform upgrade (task 1.2, 2026-11-06)
- Next 16.4.5, Prisma 7.10.1, `@anthropic-ai/sdk` 1.6, `openai` 7, Gemini on
  `@google/genai`; Node pinned to 24. Production audit: 0 vulnerabilities.
- Migrations run as the Railway pre-deploy command (`railway.json`). The service
  has no custom build/start command in its settings (Railpack defaults).
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
- Follow-up candidate: query expansion to Claude Haiku 5.5 (needs `effort: "low"` and
  ~1,024 `max_tokens`, or its default thinking eats the 300-token cap).
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
3. Grok & X Search
4. Tracking
5. Outputs

**Josh action, open now:** move the Gemini Google project to a paid tier or raise its
quota in Google AI Studio.
