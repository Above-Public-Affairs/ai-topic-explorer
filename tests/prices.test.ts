import { describe, expect, it } from "vitest";
import { PRICES, computeCost, priceFor } from "@/lib/answers/prices";

const day = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("priceFor", () => {
  it.each([
    ["2026-11-07", "input", 0.75, "gemini-3.6-flash:input"],
    ["2026-12-31", "input", 0.75, "gemini-3.6-flash:input"],
    ["2027-01-01", "input", 1.5, "gemini-3.6-flash:input@2027"],
    ["2026-12-31", "output", 3.75, "gemini-3.6-flash:output"],
    ["2027-01-01", "output", 7.5, "gemini-3.6-flash:output@2027"],
    ["2026-12-31", "cached_input", 0.075, "gemini-3.6-flash:cached_input"],
    ["2027-06-01", "cached_input", 0.15, "gemini-3.6-flash:cached_input@2027"],
  ] as const)("Gemini %s %s → $%s (%s)", (date, item, usd, id) => {
    const row = priceFor("gemini", "gemini-3.6-flash", item, day(date));
    expect(row.usd).toBe(usd);
    expect(row.id).toBe(id);
  });

  it("switches at midnight UTC, not local time", () => {
    expect(priceFor("gemini", "gemini-3.6-flash", "input", new Date("2026-12-31T23:59:59Z")).usd).toBe(0.75);
    expect(priceFor("gemini", "gemini-3.6-flash", "input", new Date("2027-01-01T00:00:00Z")).usd).toBe(1.5);
  });

  it("falls back to the provider's * row for search", () => {
    expect(priceFor("gemini", "gemini-3.6-flash", "search", day("2027-03-01")).id).toBe("gemini:search");
    expect(priceFor("claude", "claude-sonnet-5-5", "search").usd).toBe(0.01);
  });

  it("throws for an unpriced model rather than costing it at zero", () => {
    expect(() => priceFor("openai", "gpt-unknown", "input", day("2026-11-07"))).toThrow(
      "No input price for openai gpt-unknown on 2026-11-07"
    );
  });

  it("throws for an item a model has no row for", () => {
    expect(() => priceFor("openai", "gpt-6-luna", "cache_write")).toThrow(/No cache_write price/);
  });
});

describe("price table", () => {
  it("has unique ids", () => {
    const ids = PRICES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never has two rows in force for the same provider/model/item on the same day", () => {
    const days = ["2026-11-07", "2026-12-31", "2027-01-01", "2028-01-01"];
    for (const d of days) {
      const live = PRICES.filter((p) => (!p.from || p.from <= d) && (!p.until || d <= p.until));
      const keys = live.map((p) => `${p.provider}|${p.model}|${p.item}`);
      expect(new Set(keys).size, `overlap on ${d}`).toBe(keys.length);
    }
  });

  it("has well-formed dates and a source on every row", () => {
    for (const p of PRICES) {
      expect(p.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (p.from) expect(p.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (p.until) expect(p.until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (p.from && p.until) expect(p.from <= p.until).toBe(true);
      expect(p.source).toMatch(/^https:\/\//);
      expect(p.unit).toBe(p.item === "search" ? "per_call" : "per_1m_tokens");
    }
  });
});

describe("computeCost", () => {
  const counts = { input: 1_000_000, cachedInput: 1_000_000, output: 1_000_000, searches: 10 };

  it("prices Gemini at 2026 rates through Dec 31", () => {
    const cost = computeCost("gemini", "gemini-3.6-flash", counts, day("2026-12-31"));
    expect(cost.tokensUsd).toBeCloseTo(0.75 + 0.075 + 3.75, 10);
    expect(cost.searchUsd).toBeCloseTo(0.14, 10);
    expect(cost.usd).toBeCloseTo(4.715, 10);
    expect(cost.priceIds).toEqual([
      "gemini-3.6-flash:input",
      "gemini-3.6-flash:cached_input",
      "gemini-3.6-flash:output",
      "gemini:search",
    ]);
  });

  it("doubles Gemini token prices from Jan 1, 2027", () => {
    const cost = computeCost("gemini", "gemini-3.6-flash", counts, day("2027-01-01"));
    expect(cost.tokensUsd).toBeCloseTo(1.5 + 0.15 + 7.5, 10);
    expect(cost.searchUsd).toBeCloseTo(0.14, 10);
    expect(cost.priceIds).toContain("gemini-3.6-flash:output@2027");
  });

  it("skips rows for zero counts, so a model without a cache_write row still prices", () => {
    const cost = computeCost("openai", "gpt-6-luna", { input: 2_000_000, output: 100_000, searches: 0 });
    expect(cost.usd).toBeCloseTo(0.2 + 0.05, 10);
    expect(cost.priceIds).toEqual(["gpt-6-luna:input", "gpt-6-luna:output"]);
  });

  it("prices Claude cache writes", () => {
    const cost = computeCost("claude", "claude-sonnet-5-5", { input: 0, cacheWrite: 1_000_000, output: 0, searches: 1 });
    expect(cost.tokensUsd).toBeCloseTo(2.5, 10);
    expect(cost.searchUsd).toBeCloseTo(0.01, 10);
  });
});
