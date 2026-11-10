import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import type { ProviderId } from "@/lib/answers";
import { dayStart, runModelWatcher, type RegistryRecord } from "@/lib/watchers/models";
import { decide, isFlagship, isOlderVersion, modelVersion, isOfficialUrl, parseReport, quoteOnPage, type CheckOutput, type DefaultReport } from "@/lib/watchers/models-check";

const report = (over: Partial<DefaultReport> = {}): DefaultReport => ({
  sameAsCurrent: false,
  consumerName: "Sonnet 6",
  apiModelId: "claude-sonnet-6",
  mappingIsGuess: false,
  evidenceUrl: "https://claude.com/pricing",
  evidenceQuote: "Free plan includes Sonnet 6",
  effectiveDate: "2026-11-09",
  notes: "",
  ...over,
});
const current = { model: "claude-sonnet-5-5", sourceUrl: "https://claude.com/pricing" };
const page = "<html><body><h2>Free</h2><p>Free plan includes&nbsp;<b>Sonnet 6</b> and Haiku.</p></body></html>";
const deps = { fetchPage: async () => page, modelExists: async () => true, hasPrices: () => true };

describe("evidence rules", () => {
  it("accepts only the provider's own domains", () => {
    expect(isOfficialUrl("claude", "https://support.claude.com/en/articles/1")).toBe(true);
    expect(isOfficialUrl("openai", "https://help.openai.com/en/articles/6825453")).toBe(true);
    expect(isOfficialUrl("gemini", "https://support.google.com/gemini/answer/1")).toBe(true);
    expect(isOfficialUrl("claude", "https://claude.com.evil.example/pricing")).toBe(false);
    expect(isOfficialUrl("openai", "https://www.theverge.com/openai")).toBe(false);
    expect(isOfficialUrl("gemini", "https://google.com/search?q=gemini")).toBe(false);
    expect(isOfficialUrl("grok", "not a url")).toBe(false);
  });

  it("refuses flagship tiers", () => {
    expect(isFlagship("claude", "claude-opus-5-5")).toBe(true);
    expect(isFlagship("claude", "claude-fable-5-2")).toBe(true);
    expect(isFlagship("gemini", "gemini-3.5-pro")).toBe(true);
    expect(isFlagship("openai", "gpt-6-pro")).toBe(true);
    expect(isFlagship("grok", "grok-4.7")).toBe(true);
    expect(isFlagship("claude", "claude-sonnet-6")).toBe(false);
    expect(isFlagship("gemini", "gemini-3.5-flash-lite")).toBe(false);
  });

  it("spots a downgrade, the mark of a stale page", () => {
    expect(modelVersion("claude-sonnet-5-5")).toEqual([5, 5]);
    expect(modelVersion("gemini-3.5-flash-lite")).toEqual([3, 5]);
    expect(modelVersion("claude-haiku-4-5-20251001")).toEqual([4, 5]);
    // Both false positives from the first real check (Nov 10, 2026).
    expect(isOlderVersion("claude-sonnet-5", "claude-sonnet-5-5")).toBe(true);
    expect(isOlderVersion("gpt-5.6-luna", "gpt-6-luna")).toBe(true);
    expect(isOlderVersion("claude-sonnet-6", "claude-sonnet-5-5")).toBe(false);
    expect(isOlderVersion("gemini-3.5-flash", "gemini-3.5-flash-lite")).toBe(false); // a family move, same version
    expect(isOlderVersion("grok-5", "grok-4.3")).toBe(false);
  });

  it("matches a quote whatever the markup and spacing", () => {
    expect(quoteOnPage("Free plan includes Sonnet 6", page)).toBe(true);
    expect(quoteOnPage("Free plan includes Opus 6", page)).toBe(false);
    expect(quoteOnPage("Free", page)).toBe(false); // too short to mean anything
  });

  it("reads a malformed report as no change", () => {
    expect(parseReport(null).sameAsCurrent).toBe(true);
    expect(parseReport({ sameAsCurrent: "no" }).sameAsCurrent).toBe(true);
    expect(parseReport({ effectiveDate: "soon" }).effectiveDate).toBe("");
  });
});

describe("decide", () => {
  it("is unchanged when the report says so or names the current model", async () => {
    expect((await decide("claude", current, report({ sameAsCurrent: true }), deps)).verdict).toBe("unchanged");
    expect((await decide("claude", current, report({ apiModelId: "claude-sonnet-5-5" }), deps)).verdict).toBe("unchanged");
  });

  it("reports a change with an official page, a quote on it and a served model", async () => {
    const d = await decide("claude", current, report(), deps);
    expect(d).toMatchObject({ verdict: "changed", modelId: "claude-sonnet-6", isGuess: false, sourceUrl: "https://claude.com/pricing", effectiveDate: "2026-11-09" });
  });

  it("knows which models prices.ts can price", async () => {
    const { hasPrices } = await import("@/lib/watchers/models-check");
    expect(hasPrices("claude", "claude-sonnet-5-5")).toBe(true);
    expect(hasPrices("gemini", "gemini-3.6-flash")).toBe(true);
  });

  it("keeps the guess flag when the API id is a best match", async () => {
    expect(await decide("claude", current, report({ mappingIsGuess: true }), deps)).toMatchObject({ verdict: "changed", isGuess: true });
  });

  it("holds back without clear evidence", async () => {
    const cases: [Partial<DefaultReport>, typeof deps | undefined, RegExp][] = [
      [{ evidenceUrl: "https://news.example.com/claude" }, undefined, /no official page/],
      [{ evidenceQuote: "" }, undefined, /quoted nothing/],
      [{ apiModelId: "claude-opus-6" }, undefined, /flagship/],
      [{ apiModelId: "claude-sonnet-5" }, undefined, /older version/],
      [{ evidenceQuote: "Free plan includes Sonnet 7 now" }, undefined, /isn't on/],
      [{}, { ...deps, fetchPage: async () => Promise.reject(new Error("HTTP 403")) }, /couldn't be fetched/],
      [{}, { ...deps, modelExists: async () => false }, /doesn't serve/],
      [{}, { ...deps, hasPrices: () => false }, /no price/],
    ];
    for (const [over, d, reason] of cases) {
      const r = await decide("claude", current, report(over), d ?? deps);
      expect(r.verdict, JSON.stringify(over)).toBe("unclear");
      expect(r.verdict === "unclear" && r.reason).toMatch(reason);
    }
  });
});

/** Just enough of Prisma for the check paths that don't switch (a switch goes through saveModel; see the .db test). */
function fakeDb(rows: RegistryRecord[]) {
  const updates: { id: string; confirmedAt: Date }[] = [];
  const db = {
    run: { aggregate: async () => ({ _sum: { costUsd: null } }) },
    event: { findFirst: async () => null },
    modelRegistry: {
      findFirst: async ({ where }: { where: { provider: ProviderId } }) => rows.find((r) => r.provider === where.provider && !r.retiredAt) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: { confirmedAt: Date } }) => {
        updates.push({ id: where.id, confirmedAt: data.confirmedAt });
        const row = rows.find((r) => r.id === where.id)!;
        row.confirmedAt = data.confirmedAt;
        return row;
      },
    },
  } as unknown as PrismaClient;
  return { db, updates };
}

const row = (provider: ProviderId, model: string, confirmedAt = "2026-11-09T13:00:00Z"): RegistryRecord => ({
  id: `row-${provider}`,
  provider,
  model,
  effortLevel: "low",
  searchSetting: "web_search",
  locationMode: "parameter",
  confirmedAt: new Date(confirmedAt),
  isGuess: provider === "grok",
  sourceUrl: provider === "grok" ? "https://docs.x.ai/developers/models" : "https://claude.com/pricing",
  note: "old note",
  activeFrom: new Date("2026-11-07T00:00:00Z"),
  retiredAt: null,
});

const same = (cost = 0.02): CheckOutput => ({ report: report({ sameAsCurrent: true }), costUsd: cost, searches: 2, sources: [], model: "gpt-6-luna" });

describe("runModelWatcher (no switch)", () => {
  const now = new Date("2026-11-10T13:00:00Z");
  const rows = () => [row("claude", "claude-sonnet-5-5"), row("openai", "gpt-6-luna"), row("gemini", "gemini-3.5-flash-lite"), row("grok", "grok-4.3")];

  it("refreshes only confirmedAt when nothing changed, for every provider", async () => {
    const { db, updates } = fakeDb(rows());
    const check = vi.fn(async () => same());
    const r = await runModelWatcher(db, { now, check });
    expect(check).toHaveBeenCalledTimes(4);
    expect(r.providers.map((p) => p.outcome)).toEqual(["unchanged", "unchanged", "unchanged", "unchanged"]);
    expect(updates).toHaveLength(4);
    expect(updates.every((u) => u.confirmedAt === now)).toBe(true);
    expect(r.checkCostUsd).toBeCloseTo(0.08);
  });

  it("does nothing the second time in a day (every deploy runs the cron)", async () => {
    const { db } = fakeDb(rows());
    const check = vi.fn(async () => same());
    await runModelWatcher(db, { now, check });
    const again = await runModelWatcher(db, { now: new Date("2026-11-10T18:00:00Z"), check });
    expect(check).toHaveBeenCalledTimes(4);
    expect(again.providers.every((p) => p.outcome === "skipped" && /already checked today/.test(p.reason!))).toBe(true);
    // The next day checks again.
    await runModelWatcher(db, { now: new Date("2026-11-11T13:00:00Z"), check });
    expect(check).toHaveBeenCalledTimes(8);
  });

  it("stops checking at the daily check cap", async () => {
    const { db } = fakeDb(rows());
    const r = await runModelWatcher(db, { now, checkCapUsd: 0.05, check: async () => same(0.03) });
    expect(r.providers.map((p) => p.outcome)).toEqual(["unchanged", "unchanged", "skipped", "skipped"]);
    expect(r.providers[2].reason).toMatch(/check cap/);
  });

  it("keeps going when one provider fails", async () => {
    const { db } = fakeDb(rows());
    const r = await runModelWatcher(db, {
      now,
      check: async (p) => {
        if (p === "openai") throw new Error("search down");
        return same();
      },
    });
    expect(r.providers.map((p) => p.outcome)).toEqual(["unchanged", "failed", "unchanged", "unchanged"]);
  });

  it("leaves the list alone and doesn't confirm on unclear evidence", async () => {
    const { db, updates } = fakeDb(rows());
    const r = await runModelWatcher(db, {
      now,
      providers: ["grok"],
      check: async () => ({ ...same(), report: report({ apiModelId: "grok-5", evidenceUrl: "https://someblog.example/grok" }) }),
    });
    expect(r.providers[0]).toMatchObject({ outcome: "unclear", model: "grok-4.3" });
    expect(updates).toHaveLength(0);
  });

  it("dayStart is midnight UTC", () => {
    expect(dayStart(new Date("2026-11-10T23:59:00-06:00")).toISOString()).toBe("2026-11-11T00:00:00.000Z");
  });
});
