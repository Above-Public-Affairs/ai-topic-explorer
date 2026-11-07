import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@above-public-affairs/error-reporter", () => ({ reportError: vi.fn() }));

import { reportError } from "@above-public-affairs/error-reporter";
import { extractRawText, parseStructuredData } from "@/lib/ai-clients/shared";
import { answer } from "./helpers/fixtures";

const report = vi.mocked(reportError);

beforeEach(() => {
  report.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("parseStructuredData", () => {
  it("parses a clean fenced block", () => {
    const parsed = parseStructuredData(answer("clean"), "Claude");
    expect(parsed.entities.people).toEqual([
      { name: "Greg Abbott", url: "https://en.wikipedia.org/wiki/Greg_Abbott" },
      { name: "Pablo Vegas" },
    ]);
    expect(parsed.entities.organizations.map((o) => o.name)).toEqual([
      "ERCOT",
      "Public Utility Commission of Texas",
    ]);
    expect(parsed.citations).toHaveLength(2);
    expect(parsed.keyThemes[0]).toEqual({ phrase: "large load interconnection", relevance: 5 });
    expect(report).not.toHaveBeenCalled();
  });

  it("coerces schema drift and drops what it can't recover", () => {
    const parsed = parseStructuredData(answer("drifted"), "OpenAI");
    expect(parsed.entities.people).toEqual([
      { name: "Greg Abbott" },
      { name: "Pablo Vegas", url: "https://example.com/vegas" },
    ]);
    expect(parsed.entities.organizations).toEqual([{ name: "ERCOT" }]);
    expect(parsed.citations).toEqual([
      { title: "https://www.ercot.com/news", url: "https://www.ercot.com/news" },
      { title: "PUCT", url: "https://www.puc.texas.gov" },
      { title: "https://source-only.example.com", url: "https://source-only.example.com" },
    ]);
    expect(parsed.keyThemes).toEqual([
      { phrase: "grid reliability", relevance: 3 },
      { phrase: "water use", relevance: 5 },
      { phrase: "tax abatements", relevance: 1 },
      { phrase: "rate design", relevance: 3 },
    ]);
    expect(report).not.toHaveBeenCalled();
  });

  it("finds an unfenced object by brace matching, ignoring braces in strings and trailing prose", () => {
    const parsed = parseStructuredData(answer("unfenced"), "Gemini");
    expect(parsed.entities.people).toEqual([{ name: "Greg Abbott" }]);
    expect(parsed.citations).toEqual([{ title: "Brace {in} a title", url: "https://example.com/a" }]);
    expect(parsed.keyThemes).toEqual([{ phrase: "grid reliability", relevance: 5 }]);
    expect(report).not.toHaveBeenCalled();
  });

  it.each([
    ["no-block", "missing_block", "no JSON block", false],
    ["truncated", "unclosed_block", "a JSON block cut off before it closed", false],
    ["invalid-json", "invalid_json", "an unparseable JSON block", true],
  ] as const)("reports %s as %s and returns empty fields", (fixture, kind, phrase, foundCodeBlock) => {
    const text = answer(fixture);
    const parsed = parseStructuredData(text, "Grok");
    expect(parsed).toEqual({
      entities: { people: [], organizations: [] },
      citations: [],
      keyThemes: [],
    });
    expect(report).toHaveBeenCalledTimes(1);
    const params = report.mock.calls[0][0];
    expect(params).toMatchObject({
      project: "ai-topic-explorer",
      category: "json_parse_failure",
      level: "warning",
      provider: "grok",
      message: `Grok answer had ${phrase}`,
      context: { kind, foundCodeBlock, responseLength: text.length },
    });
    expect((params.context as { responseTail: string }).responseTail).toBe(text.slice(-300));
    if (kind === "invalid_json") expect(params.rawError).toBeInstanceOf(SyntaxError);
  });

  it("doesn't report an empty answer (the route fails the provider instead)", () => {
    const parsed = parseStructuredData("   \n ", "Claude");
    expect(parsed.citations).toEqual([]);
    expect(report).not.toHaveBeenCalled();
  });

  it("keeps an unknown provider name as the report's provider", () => {
    parseStructuredData(answer("no-block"), "Expansion");
    expect(report.mock.calls[0][0].provider).toBe("Expansion");
  });
});

describe("extractRawText", () => {
  it("removes a closed JSON block", () => {
    const raw = extractRawText(answer("clean"));
    expect(raw).toContain("Texas data center growth");
    expect(raw).not.toContain("```");
    expect(raw).not.toContain('"entities"');
  });

  it("strips an unclosed block to the end so keys don't reach the word cloud", () => {
    const raw = extractRawText(answer("truncated"));
    expect(raw).toBe("The answer ran out of tokens part-way through the JSON block.");
  });

  it("leaves prose without a block alone", () => {
    expect(extractRawText(answer("no-block"))).toBe(answer("no-block").trim());
  });
});
