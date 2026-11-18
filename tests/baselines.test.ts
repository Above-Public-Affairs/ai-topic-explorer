import { describe, expect, it } from "vitest";
import { confirmSwings, type Comparison, type Swing } from "@/lib/snapshots";

const swing = (key: string, change: number, scope: Swing["scope"] = "all", metric: Swing["metric"] = "entity"): Swing => ({
  scope,
  metric,
  key,
  label: key,
  before: 0.5,
  after: 0.5 + change,
  change,
  threshold: 0.1,
  countBefore: 5,
  countAfter: 9,
  kind: change > 0 ? "rose" : "fell",
});
const cmp = (swings: Swing[], questions = 8): Comparison => ({ questions, swings });

describe("confirmSwings", () => {
  it("keeps everything when there is no other baseline", () => {
    const r = confirmSwings(cmp([swing("ercot", 0.3), swing("puc", -0.2)]), []);
    expect(r.swings.map((s) => s.key)).toEqual(["ercot", "puc"]);
    expect(r).toMatchObject({ confirmedAgainst: [], unconfirmed: 0 });
  });

  it("keeps a swing only when every baseline found it, in the same direction", () => {
    const primary = cmp([swing("ercot", 0.3), swing("puc", -0.2), swing("kut.org", 0.25, "all", "domain")]);
    const r = confirmSwings(primary, [
      { runId: "w1", comparison: cmp([swing("ercot", 0.2), swing("puc", -0.3), swing("kut.org", 0.4, "all", "domain")]) },
      // w2 saw ercot rise too, puc rise (opposite) and no kut.org swing.
      { runId: "w2", comparison: cmp([swing("ercot", 0.35), swing("puc", 0.15)]) },
    ]);
    expect(r.swings.map((s) => s.key)).toEqual(["ercot"]);
    expect(r.confirmedAgainst).toEqual(["w1", "w2"]);
    expect(r.unconfirmed).toBe(2);
  });

  it("keeps the primary's numbers, not the other baselines'", () => {
    const r = confirmSwings(cmp([swing("ercot", 0.3)]), [{ runId: "w1", comparison: cmp([swing("ercot", 0.5)]) }]);
    expect(r.swings[0].change).toBe(0.3);
  });

  it("matches on scope and kind of finding as well as the key", () => {
    const r = confirmSwings(cmp([swing("ercot", 0.3, "claude"), swing("ercot", 0.3, "all", "theme")]), [
      { runId: "w1", comparison: cmp([swing("ercot", 0.3, "all"), swing("ercot", 0.3, "all", "theme")]) },
    ]);
    expect(r.swings.map((s) => `${s.scope}/${s.metric}`)).toEqual(["all/theme"]);
  });

  it("leaves out a baseline that shares no locked questions with the new snapshot", () => {
    const r = confirmSwings(cmp([swing("ercot", 0.3)]), [{ runId: "old", comparison: cmp([], 0) }]);
    expect(r.swings).toHaveLength(1);
    expect(r.confirmedAgainst).toEqual([]);
  });
});
