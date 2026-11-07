/**
 * Published API prices used to compute the cost of each answer. One row per
 * price, each with its source and the date it was checked. Update a row when
 * a provider changes its price; stored answers keep the ids they were priced
 * with.
 *
 * Grok isn't priced from here: xAI reports each response's charge
 * (`usage.cost_in_usd_ticks`), which is recorded as-is. Its rows are kept for
 * reference and for checking that figure.
 */

export interface PriceRow {
  id: string;
  provider: "claude" | "openai" | "gemini" | "grok";
  /** Model the row applies to, or "*" for every model of that provider. */
  model: string;
  item: "input" | "cached_input" | "cache_write" | "output" | "search";
  /** USD per 1M tokens for token items; USD per call for "search". */
  usd: number;
  unit: "per_1m_tokens" | "per_call";
  source: string;
  checked: string;
  note?: string;
}

const CLAUDE_PRICING = "https://platform.claude.com/docs/en/about-claude/pricing";
const OPENAI_PRICING = "https://developers.openai.com/api/docs/pricing";
const GEMINI_PRICING = "https://aistudio.google.com/docs/pricing";
const XAI_PRICING = "https://docs.x.ai/developers/pricing";

export const PRICES: PriceRow[] = [
  // Claude Sonnet 5.5
  { id: "claude-sonnet-5-5:input", provider: "claude", model: "claude-sonnet-5-5", item: "input", usd: 2, unit: "per_1m_tokens", source: CLAUDE_PRICING, checked: "2026-11-06" },
  { id: "claude-sonnet-5-5:cache_write", provider: "claude", model: "claude-sonnet-5-5", item: "cache_write", usd: 2.5, unit: "per_1m_tokens", source: CLAUDE_PRICING, checked: "2026-11-06", note: "5-minute cache writes" },
  { id: "claude-sonnet-5-5:cached_input", provider: "claude", model: "claude-sonnet-5-5", item: "cached_input", usd: 0.1, unit: "per_1m_tokens", source: CLAUDE_PRICING, checked: "2026-11-06" },
  { id: "claude-sonnet-5-5:output", provider: "claude", model: "claude-sonnet-5-5", item: "output", usd: 10, unit: "per_1m_tokens", source: CLAUDE_PRICING, checked: "2026-11-06" },
  { id: "claude:search", provider: "claude", model: "*", item: "search", usd: 0.01, unit: "per_call", source: CLAUDE_PRICING, checked: "2026-11-06", note: "$10 per 1,000 searches; results are billed as input tokens" },

  // OpenAI GPT-6 Luna
  { id: "gpt-6-luna:input", provider: "openai", model: "gpt-6-luna", item: "input", usd: 0.1, unit: "per_1m_tokens", source: OPENAI_PRICING, checked: "2026-11-06" },
  { id: "gpt-6-luna:cached_input", provider: "openai", model: "gpt-6-luna", item: "cached_input", usd: 0.01, unit: "per_1m_tokens", source: OPENAI_PRICING, checked: "2026-11-06" },
  { id: "gpt-6-luna:output", provider: "openai", model: "gpt-6-luna", item: "output", usd: 0.5, unit: "per_1m_tokens", source: OPENAI_PRICING, checked: "2026-11-06" },
  { id: "openai:search", provider: "openai", model: "*", item: "search", usd: 0.01, unit: "per_call", source: OPENAI_PRICING, checked: "2026-11-06", note: "Web search (all models): $10 per 1,000 calls, search content tokens billed at model rates. Counted per search action; opening or finding in a page isn't a search." },

  // Gemini 3.6 Flash (prices double on Jan 1, 2027: $1.50 in / $7.50 out)
  { id: "gemini-3.6-flash:input", provider: "gemini", model: "gemini-3.6-flash", item: "input", usd: 0.75, unit: "per_1m_tokens", source: GEMINI_PRICING, checked: "2026-11-06", note: "Through Dec 31, 2026; $1.50 from Jan 1, 2027" },
  { id: "gemini-3.6-flash:output", provider: "gemini", model: "gemini-3.6-flash", item: "output", usd: 3.75, unit: "per_1m_tokens", source: GEMINI_PRICING, checked: "2026-11-06", note: "Includes thinking tokens. Through Dec 31, 2026; $7.50 from Jan 1, 2027" },
  { id: "gemini:search", provider: "gemini", model: "*", item: "search", usd: 0.014, unit: "per_call", source: GEMINI_PRICING, checked: "2026-11-06", note: "$14 per 1,000 search queries after 5,000 free per month (shared across Gemini 3+ models). Each query the model runs is billed. Recorded at list price, so it overstates cost while inside the free allowance." },

  // xAI Grok 4.3 (reference only; xAI reports the charge itself)
  { id: "grok-4.3:input", provider: "grok", model: "grok-4.3", item: "input", usd: 1.25, unit: "per_1m_tokens", source: XAI_PRICING, checked: "2026-11-06", note: "Prompts under 200k tokens" },
  { id: "grok-4.3:cached_input", provider: "grok", model: "grok-4.3", item: "cached_input", usd: 0.2, unit: "per_1m_tokens", source: XAI_PRICING, checked: "2026-11-06" },
  { id: "grok-4.3:output", provider: "grok", model: "grok-4.3", item: "output", usd: 2.5, unit: "per_1m_tokens", source: XAI_PRICING, checked: "2026-11-06" },
  { id: "grok:search", provider: "grok", model: "*", item: "search", usd: 0.005, unit: "per_call", source: XAI_PRICING, checked: "2026-11-06", note: "$5 per 1,000 web_search calls" },
];

/** xAI bills in ticks: 1 USD = 10^10 ticks (docs.x.ai/developers/cost-tracking). */
export const XAI_TICKS_PER_USD = 1e10;

/**
 * The price row for a provider/model/item. Falls back to the provider's "*"
 * row. Throws when there's none, so an unpriced model is caught, not costed
 * at zero.
 */
export function priceFor(
  provider: PriceRow["provider"],
  model: string,
  item: PriceRow["item"]
): PriceRow {
  const row =
    PRICES.find((p) => p.provider === provider && p.model === model && p.item === item) ??
    PRICES.find((p) => p.provider === provider && p.model === "*" && p.item === item);
  if (!row) throw new Error(`No ${item} price for ${provider} ${model} in lib/answers/prices.ts`);
  return row;
}

interface TokenCounts {
  /** Uncached input tokens. */
  input: number;
  cachedInput?: number;
  cacheWrite?: number;
  output: number;
  searches: number;
}

/** Cost of one answer from token counts and the price table. */
export function computeCost(
  provider: PriceRow["provider"],
  model: string,
  counts: TokenCounts
): { usd: number; tokensUsd: number; searchUsd: number; priceIds: string[] } {
  const rows: PriceRow[] = [];
  const per1m = (item: PriceRow["item"], tokens: number) => {
    if (!tokens) return 0;
    const row = priceFor(provider, model, item);
    rows.push(row);
    return (tokens / 1_000_000) * row.usd;
  };
  const tokensUsd =
    per1m("input", counts.input) +
    per1m("cached_input", counts.cachedInput ?? 0) +
    per1m("cache_write", counts.cacheWrite ?? 0) +
    per1m("output", counts.output);
  let searchUsd = 0;
  if (counts.searches) {
    const row = priceFor(provider, model, "search");
    rows.push(row);
    searchUsd = counts.searches * row.usd;
  }
  return { usd: tokensUsd + searchUsd, tokensUsd, searchUsd, priceIds: rows.map((r) => r.id) };
}
