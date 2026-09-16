# AI Topic Explorer - Project Status

**Last Updated:** September 16, 2026

## Current Status: Live in production (beta)

Deployed on Railway with all five providers. Ongoing work is reliability hardening
driven by production error reports.

### Recent reliability work
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

## Completed

### Phase 1: Foundation
- [x] Next.js 16 project initialized (TypeScript, Tailwind, App Router)
- [x] Prisma 7 with PostgreSQL adapter and Analysis schema
- [x] Homepage with input form, example topic chips, methodology section
- [x] Footer with attribution (Built by The Canter Company)
- [x] Environment variables configured (.env, .env.example)
- [x] next.config.ts set to standalone output for Railway

### Phase 2: AI Integration (Claude Only)
- [x] TypeScript type definitions (AIResponse, AnalysisResult, entities, citations, TokenUsage)
- [x] Claude Haiku client wrapper with structured prompt + JSON extraction
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

### Deployment
- [ ] Create GitHub repository
- [ ] Provision Railway Postgres database
- [ ] Set environment variables in Railway (ANTHROPIC_API_KEY, ANTHROPIC_EXPANSION_API_KEY, DATABASE_URL, ANALYSIS_ENABLED)
- [ ] Deploy to Railway
- [ ] Run Prisma migrations against Railway Postgres
- [ ] Test end-to-end with live API

### Phase 5: Add OpenAI + Gemini
- [ ] Obtain OpenAI API key
- [ ] Obtain Google AI (Gemini) API key
- [ ] Install openai and @google/generative-ai SDKs
- [ ] Create OpenAI client wrapper
- [ ] Create Gemini client wrapper
- [ ] Add API keys to Railway env vars
- [ ] Test with all three providers running in parallel

### Post-MVP
- [ ] Brand/AEO Mode ("Is your brand mentioned by AI?")
