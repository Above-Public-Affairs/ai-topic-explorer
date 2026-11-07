# Lessons — AI Topic Explorer

> Reusable rules this project taught us the hard way. Appended at the Compound step
> (see `build-methodology`), newest at top. Not a changelog — the rule, not the play-by-play.

## Claude's newer web search tool drops citations: use `web_search_20250305` (Nov 2026)

`web_search_20260209` (dynamic filtering) runs searches inside code execution and reads
the results there. The answer then carries no `web_search_result_location` citations, and
the input roughly doubled (31k vs 14–22k tokens for the same question). The basic
`web_search_20250305` tool cites normally on Sonnet 5.5. We track citations, so use the
basic tool even though the skill and docs recommend the newer one.

## Each provider's web search reports differently; check the raw response first (Nov 2026)

- **Gemini:** Google Search grounding has its own quota. Plain calls worked while every
  grounded call (generateContent and Interactions, both Flash models) got a 429 "exceeded
  your current quota". A working Gemini key doesn't prove grounding works. Gemini 3 also
  bills **each search query** the model runs, not each request, and its search takes no
  location, so location goes in the system instruction.
- **OpenAI:** omitting `user_location` doesn't mean "no location"; it defaults to the US.
  Pass `{ type: "approximate" }` alone for none. Sources the model only looked at come back
  only with `include: ["web_search_call.action.sources"]`, and they have no titles.
- **xAI:** server-side search runs only on the Responses API, not Chat Completions.
  `usage.cost_in_usd_ticks` is the full charge, tokens and tool calls together, at 10^10
  ticks per dollar. A `url_citation` annotation's `title` is the citation label ("1"), not
  the page title. Search tools take no location, so it goes in a system message.

## Railway config-as-code is ignored here — set deploy settings on the service (Nov 2026)

`railway.json` with a `preDeployCommand` was committed and deployed, and Railway never ran
it: the service showed no pre-deploy command and the deploy logs had no Prisma output.
Railway has deprecated config-as-code, and this service ignores the file. Set build, start
and pre-deploy commands in the service settings (Railway MCP or dashboard), then confirm in
the next deploy's logs that they ran. Don't add `railway.json` back.
