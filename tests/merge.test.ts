import { describe, expect, it } from "vitest";
import { mergeEntities } from "@/lib/analysis/merge-entities";
import { mergeCitations } from "@/lib/analysis/merge-citations";
import { mergeKeyThemes } from "@/lib/analysis/merge-themes";
import { clampFrequency, mergeProviderResponses } from "@/lib/analysis/merge-provider-responses";
import { mergeSources } from "@/lib/answers/shared";
import type { AIResponse, Citation } from "@/lib/types";

describe("mergeEntities", () => {
  it("dedupes case-insensitively, prefers a URL, counts providers and sorts by mentions", () => {
    const merged = mergeEntities([
      { provider: "claude", entities: { people: [{ name: "Greg Abbott" }], organizations: [{ name: "ERCOT" }] } },
      {
        provider: "openai",
        entities: {
          people: [{ name: " greg abbott ", url: "https://en.wikipedia.org/wiki/Greg_Abbott" }, { name: "Pablo Vegas" }],
          organizations: [],
        },
      },
      { provider: "gemini", entities: { people: [{ name: "GREG ABBOTT" }], organizations: [] } },
    ]);
    expect(merged.people[0]).toEqual({
      name: " greg abbott ",
      url: "https://en.wikipedia.org/wiki/Greg_Abbott",
      providers: ["claude", "openai", "gemini"],
    });
    expect(merged.people[1]).toEqual({ name: "Pablo Vegas", providers: ["openai"] });
    expect(merged.organizations).toEqual([{ name: "ERCOT", providers: ["claude"] }]);
  });

  it("keeps the top 15 of each kind", () => {
    const people = Array.from({ length: 20 }, (_, i) => ({ name: `Person ${i}` }));
    const merged = mergeEntities([{ provider: "grok", entities: { people, organizations: [] } }]);
    expect(merged.people).toHaveLength(15);
  });
});

describe("mergeCitations", () => {
  it("dedupes by URL ignoring case and trailing slashes, ranking shared sources first", () => {
    const merged = mergeCitations([
      { provider: "claude", citations: [{ title: "Zeta", url: "https://ercot.com/news/" }, { title: "Alpha", url: "https://a.example.com/x" }] },
      { provider: "openai", citations: [{ title: "Zeta (OpenAI title)", url: "https://ERCOT.com/news" }] },
    ]);
    expect(merged.map((c) => c.title)).toEqual(["Zeta", "Alpha"]);
    expect(merged[0]).toMatchObject({ domain: "ercot.com", providers: ["claude", "openai"] });
  });

  it("strips www. and groups same-domain primaries, then pulls in same-domain companions past the top 10", () => {
    const citations: Citation[] = [
      ...Array.from({ length: 10 }, (_, i) => ({ title: `P${String(i).padStart(2, "0")}`, url: `https://site${i}.example.com/` })),
      { title: "P00b", url: "https://www.site0.example.com/b" },
      { title: "Z companion", url: "https://site3.example.com/other" },
      { title: "Z orphan", url: "https://nowhere.example.com/" },
    ];
    const merged = mergeCitations([{ provider: "claude", citations }]);
    const titles = merged.map((c) => c.title);
    expect(titles.slice(0, 3)).toEqual(["P00", "P00b", "P01"]);
    expect(titles.indexOf("Z companion")).toBe(titles.indexOf("P03") + 1);
    expect(titles).not.toContain("Z orphan");
    expect(titles).not.toContain("P09"); // 11th after the www. sibling joined the top 10
  });

  it("uses the raw URL as the domain when it can't be parsed", () => {
    const [c] = mergeCitations([{ provider: "grok", citations: [{ title: "Bad", url: "not a url" }] }]);
    expect(c.domain).toBe("not a url");
  });
});

describe("mergeKeyThemes", () => {
  it("merges plurals and near-duplicates, keeping the higher-relevance phrasing", () => {
    const merged = mergeKeyThemes(
      [{ phrase: "Data Centers", relevance: 3 }, { phrase: "water use", relevance: 4 }],
      [{ phrase: "data center", relevance: 5 }, { phrase: "grid reliability", relevance: 2 }],
      [{ phrase: "texas grid reliability", relevance: 1 }]
    );
    expect(merged).toEqual([
      { phrase: "data center", relevance: 5 },
      { phrase: "water use", relevance: 4 },
      { phrase: "grid reliability", relevance: 2 },
    ]);
  });

  it("keeps the top 20", () => {
    const themes = Array.from({ length: 25 }, (_, i) => ({ phrase: `theme${i}`, relevance: (i % 5) + 1 }));
    expect(mergeKeyThemes(themes)).toHaveLength(20);
  });
});

describe("mergeProviderResponses", () => {
  const base = (over: Partial<AIResponse>): AIResponse => ({
    provider: "gemini",
    rawText: "",
    entities: { people: [], organizations: [] },
    citations: [],
    keyThemes: [],
    model: "gemini-3.6-flash",
    ...over,
  });

  it("joins subtopic answers into one per provider", () => {
    const merged = mergeProviderResponses([
      base({
        rawText: "first",
        entities: { people: [{ name: "Greg Abbott" }], organizations: [] },
        citations: [{ title: "A", url: "https://a.example.com" }],
        keyThemes: [{ phrase: "grid", relevance: 3 }],
        usage: [{ inputTokens: 1, outputTokens: 2, purpose: "analysis" }],
      }),
      base({
        rawText: "second",
        model: "gemini-3.5-flash-lite",
        entities: { people: [{ name: "greg abbott", url: "https://x" }], organizations: [] },
        citations: [{ title: "A", url: "https://a.example.com" }],
        keyThemes: [{ phrase: "grids", relevance: 5 }],
        usage: [{ inputTokens: 3, outputTokens: 4, purpose: "analysis" }],
      }),
      base({ rawText: "third" }),
    ]);
    expect(merged.provider).toBe("gemini");
    expect(merged.rawText).toBe("first\n\nsecond\n\nthird");
    expect(merged.model).toBe("gemini-3.6-flash, gemini-3.5-flash-lite");
    expect(merged.entities.people).toEqual([{ name: "greg abbott", url: "https://x", providers: ["gemini"] }]);
    // Citations are concatenated here; deduping happens across providers later.
    expect(merged.citations).toHaveLength(2);
    expect(merged.keyThemes).toEqual([{ phrase: "grids", relevance: 5 }]);
    expect(merged.usage).toHaveLength(2);
    expect(merged).not.toHaveProperty("quotedPhrases");
  });

  it("dedupes quoted phrases, clamps frequency, sorts and caps at 15", () => {
    const phrases = [
      { phrase: "Same phrase", frequency: 2 },
      { phrase: "same PHRASE", frequency: 4 },
      { phrase: "  ", frequency: 5 },
      { phrase: "Stringy", frequency: "high" as unknown as number },
      ...Array.from({ length: 20 }, (_, i) => ({ phrase: `p${i}`, frequency: 1 })),
    ];
    const merged = mergeProviderResponses([base({ provider: "grok", quotedPhrases: phrases })]);
    expect(merged.quotedPhrases).toHaveLength(15);
    expect(merged.quotedPhrases?.[0]).toEqual({ phrase: "same PHRASE", frequency: 4 });
    expect(merged.quotedPhrases?.[1]).toEqual({ phrase: "Stringy", frequency: 3 });
  });
});

describe("clampFrequency", () => {
  it.each([
    [3.4, 3],
    [9, 5],
    [-2, 1],
    ["4", 4],
    ["high", 3],
    [null, 1],
    [undefined, 3],
    [Number.NaN, 3],
  ])("%s → %s", (input, expected) => {
    expect(clampFrequency(input)).toBe(expected);
  });
});

describe("mergeSources", () => {
  it("merges by URL: cited wins, a known title fills a missing one", () => {
    expect(
      mergeSources([
        { url: "https://a", title: null, cited: false },
        { url: "https://b", title: "B", cited: null },
        { url: "https://a", title: "A", cited: true },
        { url: "https://b", title: "B2", cited: false },
        { url: "https://a", title: "A2", cited: false },
      ])
    ).toEqual([
      { url: "https://a", title: "A", cited: true },
      { url: "https://b", title: "B", cited: false },
    ]);
  });
});
