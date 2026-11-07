# Session Handoff — AI Topic Explorer

**Last Updated:** November 6, 2026

## Where we are
Live in production (beta) on Railway. Phase 1A task 1.2 (platform upgrade) shipped
from branch `claude/platform-upgrades-7ed9a7`. The app is becoming an internal
topic-tracking tool; later tasks (model swaps, removing Perplexity, a new provider
pipeline) build on these SDKs.

## What was built this session
- **Dependencies:** Next / eslint-config-next 16.4.5, Prisma 7.10.1,
  `@anthropic-ai/sdk` 1.6, `openai` 7.53, `@google/genai` 3, `dotenv` 18,
  `@types/node` 24. `npm audit --omit=dev`: 0 (was 22, 1 critical / 19 high).
  Dev tooling still has 8 moderate issues (minimatch via eslint).
- **Gemini** (`lib/ai-clients/gemini.ts`): on `@google/genai`. `ApiError` has only
  `status` and a `message` holding the JSON error body; `geminiErrorBody()` parses
  it for the retry delay and for `app/api/analyze/route.ts` (reason,
  providerMessage, display text). A blocked response throws, as `text()` used to.
- **Lazy clients:** all five provider clients are built on first call, so
  `next build` works with no keys.
- **Lint:** `BetaBanner` and the home page use `useSyncExternalStore` instead of
  setState-in-effect; `/` is still statically prerendered.
- **Deploy:** `railway.json` runs `npx prisma migrate deploy` before deploy;
  `start` is just `next start`. Node 24 via `engines` and `.nvmrc`.

## Verification status
- `npm run lint` (0 problems), `npx tsc --noEmit`, and `npm run build` with no
  `.env` and no keys all pass.
- In dev: prefill + URL cleanup, placeholder rotation, banner dismiss/persist work.
- Live calls: only Gemini had a local key. It returned **402 "prepayment credits
  depleted"**. Real Gemini errors parse correctly (reason `API_KEY_INVALID`).
  Claude, OpenAI, Perplexity and Grok were not called locally (no keys).

## Next steps
- Check Gemini billing in AI Studio if production also returns 402.
- Map a 402 to "Quota exhausted — check billing" in `categorizeError`.
- `FloatingKeywords` uses `Math.random()` during render, causing a hydration
  mismatch on `/`.
- Next 16.4 warns that the Edge Runtime is deprecated (one route uses it).
- Earlier candidates still open: query expansion to Claude Haiku 5.5, stream the
  other four providers.

## Known gotchas
- **Google model access depends on the project's age.** A newly created Gemini key
  may not get older models that existing projects still have. Test the exact model
  with a new key before deploying it.
- **`next build` loads route modules** to collect config, so anything constructed
  at module load runs at build time. Keep SDK clients lazy.
- **`next dev` (16.4) writes `AGENTS.md`** and restores it if removed. It's
  deliberately not committed; don't `git add -A` blindly.
- **Gemini errors are JSON in `ApiError.message`.** Use `geminiErrorBody()`,
  not message matching.
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
