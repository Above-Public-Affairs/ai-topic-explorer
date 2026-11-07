/**
 * The provider interface: one plain question to each AI, with its own web
 * search on and an approximate user location, recording the answer, sources,
 * searches, model, tokens and cost.
 *
 * The public site (app/api/analyze) and the tracker both ask through here.
 */
import { claudeProvider } from "./claude";
import { geminiProvider } from "./gemini";
import { grokProvider } from "./grok";
import { openaiProvider } from "./openai";
import { toProviderError } from "./errors";
import { getModels } from "./registry";
import type { AnswerProvider, AskOptions, AskResult, ProviderError, ProviderId } from "./types";

export * from "./types";
export { toProviderError, providerErrorLabel } from "./errors";
export { TEXAS_LOCATION } from "./shared";
export { PRICES } from "./prices";
export {
  EXTRACTION_DEFAULT,
  FREE_TIER_DEFAULTS,
  PROVIDER_IDS,
  clearModelCache,
  getExtractionModel,
  getModel,
  getModels,
  type ModelChoice,
  type ModelRole,
  type ModelSettings,
} from "./registry";

/** A provider whose every failure is a typed ProviderError. */
function withTypedErrors(provider: AnswerProvider): AnswerProvider {
  return {
    ...provider,
    async ask(question, options) {
      try {
        return await provider.ask(question, options);
      } catch (err) {
        throw toProviderError(provider.id, err);
      }
    },
  };
}

export const PROVIDERS: Record<ProviderId, AnswerProvider> = {
  claude: withTypedErrors(claudeProvider),
  openai: withTypedErrors(openaiProvider),
  gemini: withTypedErrors(geminiProvider),
  grok: withTypedErrors(grokProvider),
};

export type AskAllResult =
  | { provider: ProviderId; ok: true; result: AskResult }
  | { provider: ProviderId; ok: false; error: ProviderError };

/**
 * Ask every provider the same question in parallel, each with its current
 * model from the registry. One failure doesn't sink the rest.
 */
export async function askAll(
  question: string,
  options: Omit<AskOptions, "settings"> = {}
): Promise<AskAllResult[]> {
  const ids = Object.keys(PROVIDERS) as ProviderId[];
  const models = await getModels();
  const settled = await Promise.allSettled(
    ids.map((id) => PROVIDERS[id].ask(question, { ...options, settings: models[id] }))
  );
  return settled.map((s, i) =>
    s.status === "fulfilled"
      ? { provider: ids[i], ok: true, result: s.value }
      : { provider: ids[i], ok: false, error: toProviderError(ids[i], s.reason) }
  );
}
