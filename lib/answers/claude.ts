import Anthropic from "@anthropic-ai/sdk";
import { MODEL } from "@/lib/ai-clients/claude";
import { computeCost } from "./prices";
import { mergeSources, roundUsd, uniqueQueries } from "./shared";
import type { AnswerProvider, AnswerSource, AskOptions, AskResult } from "./types";

// Thinking off, as in the analyze flow: `between_tools` is Sonnet 5.5's
// thinking-off setting (`disabled` is a 400).
const THINKING_OFF: Anthropic.ThinkingConfigParam = { type: "between_tools" };

// A server-tool loop that runs long comes back with stop_reason "pause_turn";
// the turn is resumed by sending the response back. Cap the resumes.
const MAX_CONTINUATIONS = 3;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  return (client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));
}

async function ask(question: string, options: AskOptions = {}): Promise<AskResult> {
  const { location, signal } = options;
  const started = Date.now();

  // The basic search tool, not web_search_20260209. The newer one filters
  // results through code execution, so the answer cites nothing and the
  // input doubles (tested Nov 2026). Citations are what we track.
  const webSearch: Anthropic.WebSearchTool20250305 = {
    type: "web_search_20250305",
    name: "web_search",
    ...(location && {
      user_location: {
        type: "approximate",
        city: location.city,
        region: location.region,
        country: location.country,
        timezone: location.timezone ?? null,
      },
    }),
  };

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];
  const responses: Anthropic.Message[] = [];
  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    const response = await getClient()
      .messages.stream(
        {
          model: MODEL,
          max_tokens: 16000,
          thinking: THINKING_OFF,
          tools: [webSearch],
          messages,
        },
        { signal }
      )
      .finalMessage();
    responses.push(response);
    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }

  const last = responses[responses.length - 1];
  if (last.stop_reason === "refusal") throw new Error("Claude declined to answer this question");

  let answer = "";
  const sources: AnswerSource[] = [];
  const queries: string[] = [];
  let input = 0;
  let cachedInput = 0;
  let cacheWrite = 0;
  let output = 0;
  let searches = 0;

  // Citations split one paragraph into several text blocks, which join with
  // no gap. Text on either side of a search ("I'll search for…") gets a
  // paragraph break.
  let breakBeforeText = false;
  for (const response of responses) {
    for (const block of response.content) {
      if (block.type !== "text") {
        breakBeforeText = answer.length > 0;
      }
      if (block.type === "text") {
        if (breakBeforeText) answer = answer.trimEnd() + "\n\n";
        breakBeforeText = false;
        answer += block.text;
        for (const c of block.citations ?? []) {
          if (c.type === "web_search_result_location") {
            sources.push({ url: c.url, title: c.title, cited: true });
          }
        }
      } else if (block.type === "server_tool_use" && block.name === "web_search") {
        const query = (block.input as { query?: unknown } | null)?.query;
        if (typeof query === "string") queries.push(query);
      } else if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const r of block.content) sources.push({ url: r.url, title: r.title, cited: false });
      }
    }
    const u = response.usage;
    input += u.input_tokens;
    cachedInput += u.cache_read_input_tokens ?? 0;
    cacheWrite += u.cache_creation_input_tokens ?? 0;
    output += u.output_tokens;
    searches += u.server_tool_use?.web_search_requests ?? 0;
  }

  const cost = computeCost("claude", MODEL, { input, cachedInput, cacheWrite, output, searches });

  return {
    provider: "claude",
    requestedModel: MODEL,
    model: last.model,
    question,
    answer: answer.trim(),
    sources: mergeSources(sources),
    searchQueries: uniqueQueries(queries),
    usage: {
      inputTokens: input + cachedInput + cacheWrite,
      cachedInputTokens: cachedInput,
      outputTokens: output,
      // Thinking is off; any between-tool thinking is inside output_tokens and
      // the API doesn't break it out.
      reasoningTokens: 0,
      searchCalls: searches,
    },
    location: location ?? null,
    locationMode: location ? "parameter" : "none",
    cost: {
      usd: roundUsd(cost.usd),
      source: "computed",
      breakdown: { tokensUsd: roundUsd(cost.tokensUsd), searchUsd: roundUsd(cost.searchUsd) },
      priceIds: cost.priceIds,
    },
    finishReason: last.stop_reason,
    latencyMs: Date.now() - started,
  };
}

export const claudeProvider: AnswerProvider = { id: "claude", model: MODEL, ask };
