import Anthropic from "@anthropic-ai/sdk";
import type { TokenUsage } from "@/lib/types";

const MODEL = "claude-haiku-5-5";

const EXPANSION_PROMPT = (topic: string) => `Given the topic: "${topic}"

Generate 3-4 distinct subtopic queries that would provide comprehensive coverage of this topic. Each query should explore a different angle or dimension — for example, different aspects like history, current state, key players, controversies, technical details, societal impact, etc.

Return ONLY a JSON array of strings, no other text:
["subtopic query 1", "subtopic query 2", "subtopic query 3"]`;

export async function expandQuery(
  topic: string
): Promise<{ queries: string[]; usage: TokenUsage }> {
  const apiKey = process.env.ANTHROPIC_EXPANSION_API_KEY;
  if (!apiKey) {
    // Fall back to single query if no expansion key configured
    return {
      queries: [topic],
      usage: { inputTokens: 0, outputTokens: 0, purpose: "expansion" },
    };
  }

  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model: MODEL,
    // Haiku 5.5 thinks by default and thinking counts against max_tokens, so
    // leave room above the ~100-token JSON array. Low effort keeps it brief.
    max_tokens: 1024,
    output_config: { effort: "low" },
    messages: [{ role: "user", content: EXPANSION_PROMPT(topic) }],
  });

  const usage: TokenUsage = {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    purpose: "expansion",
  };

  console.log(
    `[Query Expansion] Tokens — input: ${usage.inputTokens}, output: ${usage.outputTokens}`
  );

  const responseText = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  try {
    // Extract JSON array from the response
    const match = responseText.match(/\[[\s\S]*\]/);
    if (match) {
      const queries: string[] = JSON.parse(match[0]);
      if (Array.isArray(queries) && queries.length > 0 && queries.every((q) => typeof q === "string")) {
        // Always include the original topic as the first query
        return { queries: [topic, ...queries], usage };
      }
    }
  } catch (e) {
    console.warn("Failed to parse query expansion response:", e);
  }

  // Fallback: just use the original topic
  return { queries: [topic], usage };
}
