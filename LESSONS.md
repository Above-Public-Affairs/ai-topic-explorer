# Lessons — AI Topic Explorer

> Reusable rules this project taught us the hard way. Appended at the Compound step
> (see `build-methodology`), newest at top. Not a changelog — the rule, not the play-by-play.

## A Railway redeploy keeps the old start command: change it, then rebuild (Nov 2026)

Testing the `monthly-report` cron, the start command was changed to pass `--month=2026-11` and
the service redeployed twice. Both runs fired on the new cron time but ran the old command
(the log still showed the report for October). A redeploy reuses the deployment it copies,
start command included; the schedule is read live. To apply a new start command, start a
fresh build (reconnect the source or push to `main`), then confirm the command in the run's
log before trusting the result.

## An HTML email needs a charset meta, or every arrow and curly quote turns to junk (Nov 2026)

The first alert email rendered "→" as "â†’" and quotes as "â€œ": SendGrid sends the body as
UTF-8, but an HTML part with no `<meta charset="utf-8">` can be read as Latin-1. Start every
email template with a `<head>` holding the charset meta, and look at the rendered HTML in a
browser before the first send, not just the text.

## Scope merge aliases by context, or a broad entry swallows specific ones (Nov 2026)

Theme aliases first matched any sub-topic, so "neighbor impacts" tagged noise landed in the
overall "effects on communities" theme instead of noise effects. That one broad bucket then
moved 6 → 1 answers between two identical snapshots and showed up as a false swing. Match an
overall entry's aliases only on labels with no sub-topic, and send the rest to the mapper,
which sees the sub-topic. Run the A/A check after any merge change: a bad merge shows up as a
false swing before anyone reads it as news.

## OpenAI's prompt filter can refuse a batch of harmless text (Nov 2026)

A batch of 40 short theme labels about data centers came back 400 "invalid_prompt …
flagged as potentially violating our usage policy". Nothing in it was harmful, and smaller
batches of the same labels went through. Catch that error, split the batch in half and
retry, and let a single refused item fall back to a safe default ("new").

## Official pages about old defaults stay online: hold a model change to more than a quote (Nov 2026)

The first real model check found an official page with an exact quote for two providers, and
both were stale: Anthropic's Sonnet 5 launch post ("the default model for Free and Pro
plans") and OpenAI's out-of-date GPT-5.6 help page. Official domain, quote on the page and a
served model id all passed. What stops it: refuse a change to an older version than the
current model, tell the check model that launch pages outlive their news, and treat anything
doubtful as "unclear" (leave the list, warn a person) rather than a change.

## A Railway cron service doesn't run when it deploys: to test one now, move its schedule (Nov 2026)

Task 4.4 believed a deploy starts the job. On Nov 10, 2026, four deploys of `model-watcher`
(first attach, a manual redeploy, two auto-deploys from pushes to `main`) and today's
`weekly-snapshots` deploys all ended SUCCESS with no output, and the database showed the job
never ran. Deploy SUCCESS on a cron service only means the image is ready. To see a real run
before its schedule, set the cron a few minutes ahead, redeploy, read the logs, then set it
back. Keep the once-per-period guards anyway: they make a manual run or a retry harmless.

## A deploy kills a cron job that is running: release its work on SIGTERM (Nov 2026)

The event watcher's first production run (17:15 UTC, Nov 10) was killed 3 minutes in, when a
docs push to `main` redeployed every service and Railway sent the running container SIGTERM.
Its "running" job row then blocked a retry until the 3-hour stale window passed. Any cron here
can be cut off by any push. Catch SIGTERM, mark this run's unfinished work failed (and any Run
it left `running`), and keep the stale window shorter than the cron interval so even a hard
kill is retried on the next run. Start the worker with `node --import tsx <script>`, not
`npm run` or the `tsx` CLI: neither passes SIGTERM on, so a handler behind them never runs
(seen in production at 18:20 UTC, then reproduced locally).

## Calibrate a change detector with an A/A test before trusting it (Nov 2026)

Two snapshots of the same watch item run minutes apart can't differ for real, so every
"swing" between them is a false alarm. The textbook rule (2 noise widths, one pooled noise
figure per kind of finding) flagged 29 there: a comparison tests hundreds of findings, and
some single findings (a source Gemini cites in 0 of 8 answers, then 3) are far noisier than
their kind. Raise the bar to 3 widths, use a finding's own spread when it's larger, require a
move of a few whole answers, then check it still catches an injected change. Re-run this
check whenever the rule or the repeat count changes.

## A new Postgres enum value goes in one migration, its first use in the next (Nov 2026)

`ALTER TYPE … ADD VALUE` can't be used by a statement in the same transaction. Adding the
`questions` model role and seeding its row in one migration would fail on deploy. Split
them: one migration adds the value, the next inserts rows that use it (task 4.2 did
`20261107230000_question_sets` then `20261107230100_seed_watch_items`).

## Keep logic out of Next route files so it can be tested (Nov 2026)

A Next.js `route.ts` may export only route handlers and route config; exporting a helper
fails the build's type check. So helpers defined there can't be imported by a test.
Put any logic worth testing in `lib/` and import it into the route.

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
  location, so location goes in the system instruction. Its source links are expiring
  `vertexaisearch.cloud.google.com` redirects titled with the bare domain; resolve them
  (HEAD, no redirect follow, read `Location`) before storing.
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

## A worker test with a far-future "now" acts on every real row (Nov 2026)

The event watcher's database test used dates in 2031 to stay clear of real data, and ran it
against the database holding the local proof. With "now" in 2031, every real calendar event
(sessions and elections in 2026–27) was due, so the stubbed snapshots ran on them and
"took over" a real snapshot that was still running (3 hours old, as seen from 2031). Give a
worker's database test its own freshly migrated database, never one with real events in it.

