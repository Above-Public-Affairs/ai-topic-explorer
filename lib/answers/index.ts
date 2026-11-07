/**
 * The provider interface: one plain question to each AI, with its own web
 * search on and an approximate user location, recording the answer, sources,
 * searches, model, tokens and cost.
 *
 * Sits beside the public site's analyze flow (lib/ai-clients), which still
 * asks for a JSON block; switching the site over is task 2.5.
 */
import { claudeProvider } from "./claude";
import { geminiProvider } from "./gemini";
import { grokProvider } from "./grok";
import { openaiProvider } from "./openai";
import type { AnswerProvider, AskOptions, AskResult, ProviderId } from "./types";

export * from "./types";
export { TEXAS_LOCATION } from "./shared";
export { PRICES } from "./prices";

export const PROVIDERS: Record<ProviderId, AnswerProvider> = {
  claude: claudeProvider,
  openai: openaiProvider,
  gemini: geminiProvider,
  grok: grokProvider,
};

export type AskAllResult =
  | { provider: ProviderId; ok: true; result: AskResult }
  | { provider: ProviderId; ok: false; error: string };

/** Ask every provider the same question in parallel. One failure doesn't sink the rest. */
export async function askAll(question: string, options: AskOptions = {}): Promise<AskAllResult[]> {
  const ids = Object.keys(PROVIDERS) as ProviderId[];
  const settled = await Promise.allSettled(ids.map((id) => PROVIDERS[id].ask(question, options)));
  return settled.map((s, i) =>
    s.status === "fulfilled"
      ? { provider: ids[i], ok: true, result: s.value }
      : {
          provider: ids[i],
          ok: false,
          error: s.reason instanceof Error ? s.reason.message : String(s.reason),
        }
  );
}
