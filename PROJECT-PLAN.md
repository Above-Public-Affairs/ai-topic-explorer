# AI Topic Explorer

## Project Overview

A web application that queries multiple AI systems (Claude, GPT, Gemini) with a user-provided topic and visualizes what AI collectively knows about it. Results are displayed through a combined word cloud, linked named entities, and AI-suggested citations. Results are stored in Postgres and shareable via unique URLs.

## Tech Stack

- **Framework:** Next.js 16 (App Router, TypeScript, Tailwind CSS)
- **Hosting:** Railway
- **Database:** PostgreSQL (Railway) via Prisma 7
- **AI APIs:** Claude Sonnet 5.5 for analysis + Claude Haiku 4.5 for query expansion (Anthropic), GPT-4o-mini (OpenAI), Gemini Flash (Google)
- **Word Cloud:** @cp949/react-wordcloud (React 19 compatible)
- **Text Analysis:** Hybrid — AI extracts entities/citations, client-side JS counts word frequency

---

## Key Design Decisions

- **Combined visualizations** — one word cloud and one entity list merging all AI responses (not per-AI)
- **Citations section** — AIs provide source URLs; shown as clickable links with provider badges and disclaimer
- **Wait-for-all reveal** — progress tracker shows per-AI status, results appear only when all have responded or failed
- **Shareable results** — stored in Postgres, accessible via unique URLs like `/results/abc123`
- **Budget-conscious models** — Claude Sonnet 5.5 ($2 / $10 per million input/output tokens), GPT-4o-mini, Gemini Flash; the cheaper Claude Haiku 4.5 handles query expansion
- **Cost guardrails** — rate limiting (10/hour per IP), 1000 token cap per AI call, kill switch env var

---

## Build Order

1. **Phase 1:** Foundation — Next.js, homepage with methodology section, Prisma/Postgres, Railway deploy
2. **Phase 2:** AI integration — Claude only first, API route with rate limiting + kill switch, save to DB
3. **Phase 3:** Text analysis — word frequency counting, entity merging, citation merging
4. **Phase 4:** Visualization — results page, word cloud, entities, citations, share button, progress tracker
5. **Phase 5:** Add OpenAI + Gemini — plug in remaining providers (auto-detected via env vars)

---

## Phase 1: Foundation

- Next.js project with TypeScript, Tailwind, App Router
- Prisma 7 with PostgreSQL adapter (`@prisma/adapter-pg`)
- Homepage: hero section with input form, example topic chips, methodology "How It Works" section, attribution footer
- Railway deployment with standalone output

---

## Phase 2: AI Integration (Claude First)

- Type definitions for AIResponse, AnalysisResult, entities, citations, word frequencies, token usage
- Claude client wrapper (Claude Sonnet 5.5) with structured prompt requesting analysis + JSON (entities with URLs + citations)
- **Query expansion:** Before analysis, a separate Haiku call generates 3-4 subtopic queries from the user's input, providing broader topic coverage. Uses a dedicated API key (`ANTHROPIC_EXPANSION_API_KEY`) for usage tracking.
- API route: kill switch check → rate limit check → **query expansion** → auto-detect configured providers → parallel AI calls (all queries × all providers) via nested `Promise.allSettled` → merge subtopic results per provider → merge across providers → save to Postgres → return `{ id, ...result }`
- Token usage logging: input/output tokens tracked per call, tagged by purpose (expansion vs. analysis), logged to console with summary
- Rate limiting: 10 analyses/hour per IP, in-memory

---

## Phase 3: Text Analysis

- Word frequency: stop-word filtering, frequency counting, merging across providers
- Entity merging: deduplication by normalized name, preserves URLs
- Citation merging: deduplication by URL, tracks which providers suggested each, sorts by multi-provider consensus

---

## Phase 4: Visualization

- Results page loads from Postgres by ID (works for fresh analysis AND shared links)
- Combined word cloud (neutral blue/slate palette)
- Entity list with clickable links (People, Organizations, Locations, Concepts)
- Citation list with provider badges, disclaimer, and AEO Checker callout
- Progress tracker showing per-AI status
- Share button copies URL to clipboard
- Partial failure banner when some AIs fail

---

## Phase 5: Add OpenAI + Gemini

- Install `openai` and `@google/generative-ai` SDKs
- Create client wrappers following same pattern as Claude
- Add API keys to env — API route auto-detects and activates them
- Test parallel execution and merging with multiple providers

---

## Cost & Abuse Guardrails

- **Rate limiting:** 10/hour per IP (in-memory)
- **Token cap:** 4096 max tokens per analysis call, 300 max tokens per expansion call
- **Kill switch:** `ANALYSIS_ENABLED` env var
- **Separate API keys:** `ANTHROPIC_API_KEY` for analysis, `ANTHROPIC_EXPANSION_API_KEY` for query expansion (enables independent usage tracking in Anthropic console)
- **Estimated cost (Claude):** ~$0.12-0.21 per analysis at Claude Sonnet 5.5 rates ($2 / $10 per million input/output tokens) — 1 Haiku 4.5 expansion call (under $0.001) + 4-5 analysis calls of ~400 input and ~3,000 to 4,096 output tokens. Monthly worst case not yet re-baselined; the earlier ~$150/month figure was set at Haiku pricing

---

## Post-MVP Roadmap

### Brand/AEO Mode
- "Is your brand mentioned by AI?" — enter a brand name, see what AIs know
- Brand recognition score, associated keywords, cited pages
- Funnel to AEO Checker

---

## Prerequisites

- [x] Anthropic API account and key
- [ ] OpenAI API account and key
- [ ] Google AI (Gemini) API account and key
- [ ] Railway account with Postgres database
- [ ] GitHub repository
