# Changelog

All notable changes to AI Topic Explorer will be documented in this file.

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
