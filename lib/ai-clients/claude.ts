import Anthropic from "@anthropic-ai/sdk";
import type { AIResponse, TokenUsage } from "@/lib/types";
import { PROMPT_TEMPLATE, parseStructuredData, extractRawText } from "./shared";

const MODEL = "claude-sonnet-5-5";

// Sonnet 5.5 thinks by default, and thinking tokens count against max_tokens,
// where they would eat into the prose and the trailing JSON block.
// `between_tools` is this model's thinking-off setting (`disabled` is a 400),
// which keeps Claude comparable to the other providers (Gemini runs with
// thinking off too). SDK 0.74's types predate the value, hence the cast.
const THINKING_OFF = {
  type: "between_tools",
} as unknown as Anthropic.ThinkingConfigParam;

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function analyzeWithClaude(
  query: string,
  signal?: AbortSignal
): Promise<AIResponse> {
  // Stream the response and accumulate deltas as they arrive. Streaming keeps
  // the connection active with incremental data, which avoids the
  // request-timeout failures that non-streaming calls hit on long/high-max_tokens
  // generations. The optional signal lets the caller's timeout cancel the
  // request — and because we accumulate text ourselves rather than waiting on
  // finalMessage(), a cancelled request still yields whatever had streamed in
  // instead of throwing everything away.
  const stream = client.messages.stream(
    {
      model: MODEL,
      // Matches the other providers. Sonnet 5.5's tokenizer spends ~30% more
      // tokens on the same text than Sonnet 4.5 did, and at 4096 responses
      // routinely hit the cap and lost the JSON block emitted last.
      max_tokens: 8192,
      thinking: THINKING_OFF,
      messages: [
        {
          role: "user",
          content: PROMPT_TEMPLATE(query),
        },
      ],
    },
    { signal }
  );

  let responseText = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: string | null = null;
  let interrupted = false;

  try {
    for await (const event of stream) {
      if (event.type === "message_start") {
        inputTokens = event.message.usage.input_tokens;
        outputTokens = event.message.usage.output_tokens;
      } else if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        responseText += event.delta.text;
      } else if (event.type === "message_delta") {
        stopReason = event.delta.stop_reason ?? stopReason;
        outputTokens = event.usage.output_tokens;
      }
    }
  } catch (err) {
    // Aborted by the caller's timeout, or the connection dropped mid-stream.
    // Partial text is still usable — only give up if nothing arrived at all.
    if (!responseText.trim()) throw err;
    interrupted = true;
    console.warn(
      `[Analysis: Claude] Stream interrupted after ${responseText.length} chars; using partial response:`,
      err instanceof Error ? err.message : String(err)
    );
  }

  const usage: TokenUsage = {
    inputTokens,
    outputTokens,
    purpose: "analysis",
  };

  console.log(
    `[Analysis: Claude] Query: "${query.slice(0, 60)}..." — Tokens — input: ${usage.inputTokens}, output: ${usage.outputTokens}${interrupted ? " (partial)" : ""}`
  );

  // A safety decline is an HTTP 200 that simply stops. Without this check it
  // would parse to an empty analysis and be counted as a success.
  if (stopReason === "refusal") {
    throw new Error("Claude declined to analyze this topic");
  }

  if (stopReason === "max_tokens") {
    console.warn("Claude response was truncated due to max_tokens limit");
  }

  // The structured JSON block is emitted last, so a truncated response loses
  // entities/citations/themes and falls back to empty ones. The prose still
  // feeds the word cloud.
  const { entities, citations, keyThemes } = parseStructuredData(
    responseText,
    "Claude"
  );

  return {
    provider: "claude",
    rawText: extractRawText(responseText),
    entities,
    citations,
    keyThemes,
    model: MODEL,
    usage: [usage],
  };
}
