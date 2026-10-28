# Session Handoff — AI Topic Explorer

**Last Updated:** October 28, 2026

## Where we are
Live in production (beta) on Railway. This session triaged the 2026-10-27 error
digest. Four errors came from a single analysis, and they turned out to be
account/key problems rather than code:

- **Anthropic:** both keys (`ANTHROPIC_API_KEY`, `ANTHROPIC_EXPANSION_API_KEY`) were
  rejected as invalid.
- **OpenAI:** out of quota. It returned a 429 on a single in-flight request after a
  few seconds of quick retries.
- **Gemini:** failed instantly, but the reason was hidden by our own error
  formatting (see below).

All four keys were rotated. They're stored in 1Password (Development vault,
"AI Topic Explorer - …") and set on Railway, and each was checked live against its
provider before being saved. Railway redeployed `main` with the new keys, so Claude
and OpenAI already work in production.

**Gemini is still down in production until this branch deploys.** The new key's
Google project is new, and Google no longer serves `gemini-2.5-flash` to new
projects. That project also needed the Gemini API enabled, which is done.

## What was built this session
Branch `claude/ai-topic-explorer-provider-errors-26b19e`, three commits plus these
docs.

- **Error classification** (`app/api/analyze/route.ts`).
  - `categorizeError` reads the SDK's `status`, OpenAI's `code` and Gemini's
    `errorDetails` `reason` before matching message text.
  - Gemini errors begin with the full request URL, so the HTTP status sat past the
    120-character display cut. The URL prefix is now stripped.
  - OpenAI `insufficient_quota` gets its own "Quota exhausted" label.
  - `providerErrorDetail` adds `code` and `reason` to reports.
  - The `invalid.*key` auth check was a literal-string `includes()` and never
    matched. It's now a regex.
- **Claude Sonnet 5.5** (`lib/ai-clients/claude.ts`).
  - Model is `claude-sonnet-5-5`.
  - Thinking is off via `thinking: {type: "between_tools"}`. `disabled` is a 400 on
    this model, and SDK 0.74's types need a cast.
  - `stop_reason: "refusal"` now throws "Claude declined to analyze this topic"
    instead of passing as an empty success.
- **Gemini** (`lib/ai-clients/gemini.ts`): `gemini-3.5-flash` with
  `thinkingBudget: 0`. Google currently serves that alias with Gemini 3.6 Flash.
  `gemini-3.8-flash` timed out under load when tested.
- **Truncation** (`claude.ts`, `lib/ai-clients/shared.ts`).
  - Claude `max_tokens` is now 8192, up from 4096.
  - The shared prompt asks for ~1,000–1,500 words of prose, which affects all five
    providers.
  - `extractRawText` strips an unclosed JSON block.
- Docs: CHANGELOG, in-site changelog (`components/Footer.tsx`), PROJECT-PLAN (no
  longer says Claude runs on Haiku), and PROJECT-STATUS.

## Verification status
- `tsc --noEmit` and eslint pass. The only warnings are three pre-existing unused
  imports in `openai.ts`.
- The new error classification was run against real SDK error objects: Anthropic
  401, OpenAI quota vs rate-limit 429, and Gemini 400/403/404.
- `extractRawText` was checked on closed, unclosed, missing and mid-text JSON
  blocks.
- Live single-request checks with the new keys all passed:
  - Sonnet 5.5 + `between_tools`
  - GPT-4o
  - Gemini 3.5 Flash with the app's exact safety + thinking settings
- **Not** exercised: a full end-to-end analysis on this branch.

## Next steps
- After deploy, run one analysis on the live site and confirm all five providers
  return. Check that Claude/Gemini prose lands near the new 1,000–1,500-word target
  and that entities/citations/themes come through.
- Delete the old Anthropic, OpenAI and Gemini keys in each console if not done yet.
- The GitHub CLI token can't create PRs in Above-Public-Affairs. The API returns
  404 even though the account is a repo admin, which points to the GitHub CLI
  OAuth app not being approved for the org. Grant it at
  github.com/settings/connections/applications if PRs are wanted.
- Candidates:
  - Query expansion to Claude Haiku 5.5 (needs `effort: "low"` + ~1,024
    `max_tokens`).
  - Move to `gemini-3.8-flash` once it's stable.
  - Trim Perplexity's fan-out.
  - Stream the other four providers.

## Known gotchas
- **Google model access depends on the project's age.** A newly created Gemini key
  may not get older models that existing projects still have. Test the exact model
  with a new key before deploying it.
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
