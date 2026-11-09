import { describe, expect, it } from "vitest";
import {
  BAND_FLOOR,
  BAND_Z,
  FALLBACK_SIGMA,
  agreement,
  compareSnapshots,
  holdThreshold,
  metricNoise,
  noiseBand,
  pairAgreement,
  sideBalance,
  threshold,
  type AnswerFindings,
  type Metric,
  type SnapshotNoise,
} from "@/lib/snapshots";
import type { ProviderId } from "@/lib/answers";

let seq = 0;
function answer(
  opts: { q?: string; provider?: ProviderId; repeat?: number; locked?: boolean } & Partial<Record<Metric, string[]>>
): AnswerFindings {
  const { q = "q1", provider = "claude", repeat = 1, locked = true } = opts;
  return {
    answerId: `a${++seq}`,
    questionId: q,
    questionLabel: `1.${q.slice(1)}`,
    locked,
    provider,
    repeat,
    findings: {
      entity: opts.entity ?? [],
      theme: opts.theme ?? [],
      domain: opts.domain ?? [],
      side: opts.side ?? ["even"],
      tone: opts.tone ?? ["neutral"],
    },
  };
}

describe("hold rule", () => {
  it("needs every repeat with 2, a majority with 3", () => {
    expect(holdThreshold(2)).toBe(2);
    expect(holdThreshold(3)).toBe(2);
    expect(holdThreshold(4)).toBe(3);
    expect(holdThreshold(5)).toBe(3);
  });

  it("splits a pair's findings into held and noisy", () => {
    const r = pairAgreement([
      answer({ entity: ["ercot", "puc"], domain: ["texastribune.org"], tone: ["mixed"] }),
      answer({ entity: ["ercot"], domain: ["kut.org"], tone: ["mixed"], repeat: 2 }),
      answer({ entity: ["ercot", "puc"], domain: ["texastribune.org"], tone: ["critical"], repeat: 3 }),
    ]);
    expect(r.held.entity).toEqual(["ercot", "puc"]);
    expect(r.held.domain).toEqual(["texastribune.org"]);
    expect(r.noisy.domain).toEqual(["kut.org"]);
    expect(r.held.tone).toEqual(["mixed"]);
    expect(r.noisy.tone).toEqual(["critical"]);
  });

  it("with 2 repeats, one-sided findings are noisy", () => {
    const r = pairAgreement([answer({ entity: ["ercot", "puc"] }), answer({ entity: ["ercot"], repeat: 2 })]);
    expect(r.held.entity).toEqual(["ercot"]);
    expect(r.noisy.entity).toEqual(["puc"]);
  });

  it("judges locked pairs only, skips pairs with one usable repeat, and totals", () => {
    const s = agreement([
      answer({ entity: ["ercot"] }),
      answer({ entity: ["ercot"], repeat: 2 }),
      answer({ provider: "grok", entity: ["x"] }), // its repeat failed
      answer({ q: "q9", locked: false, entity: ["y"] }),
    ]);
    expect(s.pairs).toBe(1);
    expect(s.skipped).toBe(1);
    expect(s.totals.entity).toEqual({ held: 1, noisy: 0 });
    expect(s.heldRate.entity).toBe(1);
    expect(s.heldRate.theme).toBeNull();
  });

  it("labels argument balance", () => {
    expect(sideBalance([])).toBe("no arguments");
    expect(sideBalance(["for", "for", "against"])).toBe("leans for");
    expect(sideBalance(["for", "against", "against"])).toBe("leans against");
    expect(sideBalance(["for", "against"])).toBe("even");
  });
});

describe("noise band", () => {
  it("is the floor when repeats agree exactly", () => {
    const rows = [1, 2].flatMap((repeat) => ["q1", "q2"].map((q) => answer({ q, repeat, entity: ["ercot"] })));
    const n = metricNoise(rows, "entity");
    expect(n.passes).toBe(2);
    expect(n.sigma).toBe(0);
    expect(n.band).toBe(BAND_FLOOR);
  });

  it("widens with the pass-to-pass spread", () => {
    // Pass 1: ercot in 4/4 answers; pass 2: 2/4. Share 1.0 vs 0.5.
    const rows = [
      ...["q1", "q2", "q3", "q4"].map((q) => answer({ q, repeat: 1, entity: ["ercot"] })),
      ...["q1", "q2", "q3", "q4"].map((q, i) => answer({ q, repeat: 2, entity: i < 2 ? ["ercot"] : [] })),
    ];
    const n = metricNoise(rows, "entity");
    // Sample SD of [1, 0.5] = 0.3536; band = 3·√(2σ²/2) = 3σ.
    expect(n.sigma).toBeCloseTo(Math.SQRT1_2 / 2, 6);
    expect(n.band).toBeCloseTo(BAND_Z * n.sigma!, 6);
  });

  it("ignores rare findings when common ones exist", () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => answer({ q: `q${i}`, repeat: 1, entity: ["ercot", ...(i === 0 ? ["rare"] : [])] })),
      ...Array.from({ length: 10 }, (_, i) => answer({ q: `q${i}`, repeat: 2, entity: ["ercot"] })),
    ];
    expect(metricNoise(rows, "entity")).toMatchObject({ keys: 1, sigma: 0 });
  });

  it("falls back without repeats", () => {
    const n = metricNoise([answer({ entity: ["ercot"] })], "entity");
    expect(n.sigma).toBeNull();
    expect(n.band).toBeCloseTo(BAND_Z * Math.sqrt(2) * FALLBACK_SIGMA, 6);
  });

  it("is computed per AI as well as overall, from locked answers", () => {
    const band = noiseBand([answer({}), answer({ provider: "grok" }), answer({ provider: "openai", locked: false })]);
    expect(Object.keys(band).sort()).toEqual(["all", "claude", "grok"]);
  });

  it("combines both snapshots' noise", () => {
    expect(threshold({ sigma: 0.1, passes: 2 }, { sigma: 0.1, passes: 2 })).toBeCloseTo(0.3, 6);
    expect(threshold({ sigma: 0.1, passes: 3 }, { sigma: 0.1, passes: 3 })).toBeCloseTo(3 * Math.sqrt(0.02 / 3), 6);
    expect(threshold({ sigma: 0, passes: 2 }, { sigma: 0, passes: 2 })).toBe(BAND_FLOOR);
    expect(threshold({ sigma: null, passes: 2 }, { sigma: 0.1, passes: 2 })).toBeCloseTo(0.3, 6);
    expect(threshold({ sigma: 0.1, passes: 2 }, { sigma: 0.1, passes: 2 }, 2)).toBeCloseTo(0.2, 6);
  });
});

describe("compareSnapshots", () => {
  const quiet = { all: Object.fromEntries((["entity", "theme", "domain", "side", "tone"] as Metric[]).map((m) => [m, { passes: 2, keys: 1, sigma: 0.05, band: 0.15 }])) } as SnapshotNoise;
  const snap = (entityFor: (q: number, repeat: number) => string[], qs = 10) => ({
    answers: [1, 2].flatMap((repeat) => Array.from({ length: qs }, (_, i) => answer({ q: `q${i}`, repeat, entity: entityFor(i, repeat) }))),
    noise: { ...quiet, claude: quiet.all },
  });

  it("flags changes beyond the band and ignores ones inside it", () => {
    const before = snap((i) => (i < 5 ? ["ercot"] : []).concat(i < 4 ? ["puc"] : []));
    const after = snap((i) => (i < 9 ? ["ercot"] : []).concat(i < 5 ? ["puc"] : []));
    const r = compareSnapshots(before, after);
    expect(r.questions).toBe(10);
    // threshold = max(0.05, 3·√(0.0025/2·2)) = 0.15; ercot 50% → 90% is a swing, puc 40% → 50% isn't.
    const all = r.swings.filter((s) => s.scope === "all" && s.metric === "entity");
    expect(all.map((s) => [s.key, s.kind])).toEqual([["ercot", "rose"]]);
    expect(all[0].change).toBeCloseTo(0.4, 6);
    expect(all[0].threshold).toBeCloseTo(0.15, 6);
  });

  it("judges a volatile finding by its own pass-to-pass spread", () => {
    // "src" swings 0 → 8 of 10 answers between passes in both snapshots: its own sigma dwarfs the kind's.
    const volatile = (n: number) => (i: number, repeat: number) => (repeat === 1 ? (i < n ? ["src"] : []) : i < 8 ? ["src"] : []);
    expect(compareSnapshots(snap(volatile(0)), snap(volatile(4))).swings).toEqual([]);
    // The same 20-point move from a steady finding counts.
    const steady = (n: number) => (i: number) => (i < n ? ["src"] : []);
    expect(compareSnapshots(snap(steady(4)), snap(steady(6))).swings.filter((s) => s.scope === "all")).toHaveLength(1);
  });

  it("needs the answer count to move by a few", () => {
    // 1 of 10 → 2 of 10 in each pass: 10 points, count 2 → 4. Under the minimum move of 3 answers.
    const r = compareSnapshots(snap((i) => (i < 1 ? ["x"] : [])), snap((i) => (i < 2 ? ["x"] : [])), { z: 0 });
    expect(r.swings).toEqual([]);
  });

  it("marks new and gone findings, and needs a few answers", () => {
    const before = snap((i) => (i < 6 ? ["old"] : []).concat(i === 0 ? ["blip"] : []));
    const after = snap((i) => (i < 6 ? ["new"] : []));
    const kinds = Object.fromEntries(compareSnapshots(before, after).swings.filter((s) => s.scope === "all").map((s) => [s.key, s.kind]));
    expect(kinds).toEqual({ new: "new", old: "gone" });
  });

  it("compares only locked questions both snapshots asked", () => {
    const before = snap((i) => (i < 5 ? ["ercot"] : []));
    const after = snap((i) => (i < 5 ? ["ercot"] : []), 5); // q5–q9 retired: ercot share would read 100%
    after.answers.push(answer({ q: "fresh", locked: false, entity: ["ercot"] }));
    const r = compareSnapshots(before, after);
    expect(r.questions).toBe(5);
    expect(r.swings).toEqual([]);
  });
});
