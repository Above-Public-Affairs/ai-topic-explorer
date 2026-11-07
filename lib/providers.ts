import type { StoredProvider } from "@/lib/types";

/**
 * Display names and badge colors for every provider a saved result can name.
 * Perplexity was removed in Nov 2026 but stays here so older saved results
 * still render its citation and entity badges.
 */
export const PROVIDER_LABELS: Record<StoredProvider, string> = {
  claude: "Claude",
  openai: "ChatGPT",
  gemini: "Gemini",
  grok: "Grok",
  perplexity: "Perplexity",
};

export const PROVIDER_COLORS: Record<StoredProvider, string> = {
  claude: "bg-orange-50 text-orange-700",
  openai: "bg-emerald-50 text-emerald-700",
  gemini: "bg-blue-50 text-blue-700",
  grok: "bg-red-50 text-red-700",
  perplexity: "bg-purple-50 text-purple-700",
};

/** Label for a provider name read from stored data, which may be unknown. */
export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider as StoredProvider] ?? provider;
}

/** Badge color for a provider name read from stored data. */
export function providerColor(provider: string): string {
  return PROVIDER_COLORS[provider as StoredProvider] ?? "bg-gray-50 text-gray-700";
}
