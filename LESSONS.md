# Lessons — AI Topic Explorer

> Reusable rules this project taught us the hard way. Appended at the Compound step
> (see `build-methodology`), newest at top. Not a changelog — the rule, not the play-by-play.

## Railway config-as-code is ignored here — set deploy settings on the service (Nov 2026)

`railway.json` with a `preDeployCommand` was committed and deployed, and Railway never ran
it: the service showed no pre-deploy command and the deploy logs had no Prisma output.
Railway has deprecated config-as-code, and this service ignores the file. Set build, start
and pre-deploy commands in the service settings (Railway MCP or dashboard), then confirm in
the next deploy's logs that they ran. Don't add `railway.json` back.
