/**
 * SAMPLE DATA for the monthly report (task 5.3): synthetic snapshots for the
 * three watch items, so the report can be rendered and checked before four
 * real weekly snapshots exist. Every number here is made up. Reports built
 * from it say "sample data" in the subject, the banner and every chart.
 *
 * Answers are drawn at random (seeded, so the same sample every time) from a
 * base rate per finding, varied per question × AI the way real answers vary,
 * with a few changes injected partway through the month so the report has
 * real swings to show next to noise that it must not call out.
 */
import type { ProviderId } from "@/lib/answers";
import { noiseBand, type AnswerFindings, type Labels, type Metric } from "@/lib/snapshots";
import { monthFromKey } from "./month";
import type { ItemMonthInput, SnapshotInput, TimelineMark } from "./types";

export const SAMPLE_MONTH = "2026-12";
const PROVIDERS: ProviderId[] = ["claude", "openai", "gemini", "grok"];
const REPEATS = 3;
const LOCKED_QUESTIONS = 8;
const FRESH_QUESTIONS = 8;

/** mulberry32: small, seeded, good enough for sample data. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rates = Record<string, number>;

interface Change {
  from: string;
  metric: Metric;
  key: string;
  rate: number;
  provider?: ProviderId;
}

interface SampleItem {
  id: string;
  name: string;
  city: string;
  region: string;
  labels: Labels;
  entity: Rates;
  theme: Rates;
  domain: Rates;
  /** Per-AI domain rates that replace the shared one (AIs cite differently). */
  domainBias: Partial<Record<ProviderId, Rates>>;
  tone: Rates;
  side: Rates;
  /** Findings only fresh questions bring up. */
  freshOnly: Partial<Record<"entity" | "theme" | "domain", Rates>>;
  changes: Change[];
  events: { at: string; label: string; snapshot?: boolean }[];
  alerts: { number: number; createdAt: string; subject: string }[];
}

const ITEMS: SampleItem[] = [
  {
    id: "sample-dc-tx",
    name: "Data centers in Texas",
    city: "Austin",
    region: "Texas",
    labels: {
      "c:ercot": "ERCOT", "c:puct": "Public Utility Commission of Texas", "c:sb6": "Senate Bill 6", "c:twdb": "Texas Water Development Board", "c:abilene": "Abilene", "c:oncor": "Oncor",
      "t:electricity-demand": "Electricity demand", "t:water-consumption": "Water use", "t:grid-reliability": "Grid reliability", "t:electricity-bills": "Electricity bills", "t:tax-incentives": "Tax incentives", "t:jobs": "Jobs", "t:noise-health": "Noise and health", "t:local-control": "Local control",
      "t:drought-planning": "Drought planning", "c:lcra": "Lower Colorado River Authority", "c:hood-county": "Hood County",
    },
    entity: { "c:ercot": 0.7, "c:puct": 0.35, "c:sb6": 0.3, "c:twdb": 0.2, "c:abilene": 0.18, "c:oncor": 0.15 },
    theme: { "t:electricity-demand": 0.6, "t:grid-reliability": 0.5, "t:water-consumption": 0.3, "t:electricity-bills": 0.35, "t:tax-incentives": 0.25, "t:jobs": 0.22, "t:noise-health": 0.12, "t:local-control": 0.1 },
    domain: { "texastribune.org": 0.4, "ercot.com": 0.35, "eia.gov": 0.2, "kut.org": 0.15, "reuters.com": 0.15, "dallasnews.com": 0.15, "reddit.com": 0.06, "puc.texas.gov": 0.12 },
    domainBias: { gemini: { "reddit.com": 0.1 }, grok: { "texastribune.org": 0.6 } },
    tone: { mixed: 0.55, critical: 0.25, positive: 0.15, neutral: 0.05 },
    side: { even: 0.4, "leans against": 0.35, "leans for": 0.2, "no arguments": 0.05 },
    freshOnly: { entity: { "c:lcra": 0.25, "c:hood-county": 0.15 }, theme: { "t:drought-planning": 0.3 }, domain: { "statesman.com": 0.2, "kxan.com": 0.12 } },
    changes: [
      { from: "2026-12-10", metric: "theme", key: "t:water-consumption", rate: 0.62 },
      { from: "2026-12-10", metric: "domain", key: "texastribune.org", rate: 0.1, provider: "openai" },
      { from: "2026-12-16", metric: "domain", key: "reddit.com", rate: 0.6, provider: "gemini" },
      { from: "2026-12-10", metric: "tone", key: "critical", rate: 0.42 },
    ],
    events: [{ at: "2026-12-09", label: "Sample event: state water plan draft released", snapshot: true }],
    alerts: [
      { number: 901, createdAt: "2026-12-14", subject: "Sample alert: AI answers about Texas data centers talk more about water use" },
      { number: 903, createdAt: "2026-12-17", subject: "Sample alert: Gemini points to Reddit far more after its model change" },
    ],
  },
  {
    id: "sample-og-nm",
    name: "Oil and gas in New Mexico",
    city: "Albuquerque",
    region: "New Mexico",
    labels: {
      "c:permian": "Permian Basin", "c:nmed": "New Mexico Environment Department", "c:occ": "Oil Conservation Commission", "c:blm": "Bureau of Land Management", "c:lfc": "Legislative Finance Committee", "c:carlsbad": "Carlsbad",
      "t:state-revenue": "State revenue", "t:methane-emissions": "Methane emissions", "t:produced-water": "Produced water", "t:jobs": "Jobs", "t:setbacks": "Setbacks from homes", "t:air-quality": "Air quality", "t:permanent-fund": "Permanent fund",
      "t:orphan-wells": "Orphan wells", "c:sfnm": "Santa Fe New Mexican",
    },
    entity: { "c:permian": 0.65, "c:nmed": 0.35, "c:occ": 0.25, "c:blm": 0.25, "c:lfc": 0.15, "c:carlsbad": 0.12 },
    theme: { "t:state-revenue": 0.55, "t:methane-emissions": 0.5, "t:produced-water": 0.3, "t:jobs": 0.35, "t:air-quality": 0.25, "t:setbacks": 0.15, "t:permanent-fund": 0.2 },
    domain: { "sourcenm.com": 0.3, "eia.gov": 0.3, "env.nm.gov": 0.2, "abqjournal.com": 0.2, "searchlightnm.org": 0.15, "nmoga.org": 0.1, "wikipedia.org": 0.1 },
    domainBias: { claude: { "wikipedia.org": 0.3 } },
    tone: { mixed: 0.6, critical: 0.2, positive: 0.15, neutral: 0.05 },
    side: { even: 0.45, "leans against": 0.25, "leans for": 0.25, "no arguments": 0.05 },
    freshOnly: { theme: { "t:orphan-wells": 0.35 }, domain: { "krqe.com": 0.15 } },
    changes: [{ from: "2026-12-16", metric: "theme", key: "t:methane-emissions", rate: 0.22 }],
    events: [],
    alerts: [{ number: 904, createdAt: "2026-12-21", subject: "Sample alert: fewer AI answers about New Mexico oil and gas mention methane" }],
  },
  {
    id: "sample-re-tx",
    name: "Renewables in Texas",
    city: "Austin",
    region: "Texas",
    labels: {
      "c:ercot": "ERCOT", "c:crez": "CREZ lines", "c:puct": "Public Utility Commission of Texas", "c:west-texas": "West Texas", "c:sb819": "Senate Bill 819",
      "t:power-sources": "Power sources", "t:grid-reliability": "Grid reliability", "t:electricity-bills": "Electricity bills", "t:land-use": "Land use", "t:transmission-interconnection": "Transmission", "t:storage": "Battery storage", "t:jobs": "Jobs",
      "t:hail-damage": "Hail damage to panels", "c:fort-bend": "Fort Bend County",
    },
    entity: { "c:ercot": 0.75, "c:crez": 0.2, "c:puct": 0.3, "c:west-texas": 0.3, "c:sb819": 0.2 },
    theme: { "t:power-sources": 0.55, "t:grid-reliability": 0.5, "t:electricity-bills": 0.35, "t:storage": 0.35, "t:land-use": 0.2, "t:transmission-interconnection": 0.3, "t:jobs": 0.15 },
    domain: { "ercot.com": 0.4, "eia.gov": 0.25, "texastribune.org": 0.3, "canarymedia.com": 0.15, "seia.org": 0.12, "utexas.edu": 0.12 },
    domainBias: {},
    tone: { positive: 0.35, mixed: 0.5, critical: 0.1, neutral: 0.05 },
    side: { "leans for": 0.35, even: 0.45, "leans against": 0.15, "no arguments": 0.05 },
    freshOnly: { entity: { "c:fort-bend": 0.2 }, theme: { "t:hail-damage": 0.25 } },
    changes: [{ from: "2026-12-10", metric: "domain", key: "eia.gov", rate: 0.5 }],
    events: [{ at: "2026-12-09", label: "Sample event: state water plan draft released" }],
    alerts: [],
  },
];

const SAMPLE_MARKS: TimelineMark[] = [
  { at: new Date("2026-12-16T13:00:00Z"), kind: "new_model", label: "Sample: new gemini default: gemini-3.5-flash", provider: "gemini" },
  { at: new Date("2026-12-16T13:20:00Z"), kind: "model_switch", label: "Old and new model asked side by side" },
];

const WEEKLY = ["2026-11-23", "2026-11-30", "2026-12-07", "2026-12-14", "2026-12-21", "2026-12-28"];

function rateFor(item: SampleItem, metric: Metric, key: string, base: number, provider: ProviderId, day: string): number {
  let r = base;
  const own = metric === "domain" ? item.domainBias[provider]?.[key] : undefined;
  if (own != null) r = own;
  for (const c of item.changes) if (c.metric === metric && c.key === key && day >= c.from && (!c.provider || c.provider === provider)) r = c.rate;
  return Math.min(0.95, Math.max(0, r));
}

/** One answer's pick from a set of exclusive outcomes (tone, lean). */
function pickOne(rand: () => number, rates: Rates): string {
  const total = Object.values(rates).reduce((a, b) => a + b, 0);
  let x = rand() * total;
  for (const [k, v] of Object.entries(rates)) if ((x -= v) <= 0) return k;
  return Object.keys(rates)[0];
}

function snapshot(item: SampleItem, day: string, kind: SnapshotInput["kind"], seed: number, pairBias: Map<string, number>): SnapshotInput {
  const rand = rng(seed);
  const runId = `sample-${item.id}-${day}${kind === "event" ? "-event" : ""}`;
  const answers: AnswerFindings[] = [];
  const draw = (metric: "entity" | "theme" | "domain", provider: ProviderId, q: string, scale: number, extra?: Rates) => {
    const out: string[] = [];
    for (const [key, base] of Object.entries({ ...item[metric], ...(extra ?? {}) })) {
      const rate = rateFor(item, metric, key, base, provider, day);
      // Locked pairs: a question × AI either tends to name a finding or not, and its repeats mostly agree.
      const u = pairBias.get(`${q}|${provider}|${key}`);
      const p = u == null ? rate * scale : u < rate ? 0.85 : 0.04;
      if (rand() < p) out.push(key);
    }
    return out.sort();
  };
  const tonal = (provider: ProviderId, metric: "tone" | "side") => {
    const rates = Object.fromEntries(Object.entries(item[metric]).map(([k, v]) => [k, rateFor(item, metric, k, v, provider, day)]));
    return pickOne(rand, rates);
  };
  for (let repeat = 1; repeat <= REPEATS; repeat++) {
    for (let q = 1; q <= LOCKED_QUESTIONS; q++) {
      for (const provider of PROVIDERS) {
        const questionId = `${item.id}-anchor-${q}`;
        answers.push({
          answerId: `${runId}-${questionId}-${provider}-${repeat}`,
          questionId,
          questionLabel: `1.${q}`,
          locked: true,
          provider,
          repeat,
          findings: { entity: draw("entity", provider, questionId, 1), theme: draw("theme", provider, questionId, 1), domain: draw("domain", provider, questionId, 1), side: [tonal(provider, "side")], tone: [tonal(provider, "tone")] },
        });
      }
    }
  }
  for (let q = 1; q <= FRESH_QUESTIONS; q++) {
    for (const provider of PROVIDERS) {
      const questionId = `${runId}-fresh-${q}`;
      answers.push({
        answerId: `${questionId}-${provider}`,
        questionId,
        questionLabel: `2.${q}`,
        locked: false,
        provider,
        repeat: 1,
        findings: {
          entity: draw("entity", provider, questionId, 0.7, item.freshOnly.entity),
          theme: draw("theme", provider, questionId, 0.7, item.freshOnly.theme),
          domain: draw("domain", provider, questionId, 0.7, item.freshOnly.domain),
          side: [tonal(provider, "side")],
          tone: [tonal(provider, "tone")],
        },
      });
    }
  }
  return {
    runId,
    kind,
    startedAt: new Date(`${day}T${kind === "event" ? "18" : "05"}:15:00Z`),
    askedFrom: { city: item.city, region: item.region, country: "US" },
    answers,
    labels: item.labels,
    noise: noiseBand(answers),
  };
}

/** The sample month for every watch item. Same output on every call. */
export function sampleMonth(): ItemMonthInput[] {
  const month = monthFromKey(SAMPLE_MONTH);
  return ITEMS.map((item, i) => {
    // Each question × AI's leaning toward each finding, fixed for the month: it names the
    // finding while the finding's rate is above its draw, so a rate change moves whole pairs.
    const biasRand = rng(1000 + i);
    const pairBias = new Map<string, number>();
    for (let q = 1; q <= LOCKED_QUESTIONS; q++)
      for (const p of PROVIDERS)
        for (const metric of ["entity", "theme", "domain"] as const)
          for (const key of Object.keys(item[metric])) pairBias.set(`${item.id}-anchor-${q}|${p}|${key}`, biasRand());

    const snaps = WEEKLY.map((day, w) => snapshot(item, day, "weekly", 7919 * (i + 1) + w, pairBias));
    for (const e of item.events) if (e.snapshot) snaps.push(snapshot(item, e.at, "event", 31337 + i, pairBias));
    snaps.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
    const marks: TimelineMark[] = [
      ...item.events.map((e) => ({ at: new Date(`${e.at}T12:00:00Z`), kind: "event" as const, label: e.label, ...(e.snapshot ? { runId: `sample-${item.id}-${e.at}-event` } : {}) })),
      ...SAMPLE_MARKS,
    ];
    return {
      watchItem: { id: item.id, name: item.name, askedFrom: { city: item.city, region: item.region, country: "US" } },
      month,
      baseline: snaps.filter((s) => s.startedAt < month.start).at(-1) ?? null,
      snapshots: snaps.filter((s) => s.startedAt >= month.start),
      weeklyCount: 8,
      marks,
      alerts: item.alerts.map((a) => ({ ...a, createdAt: new Date(`${a.createdAt}T06:00:00Z`), status: "suppressed" })),
    };
  });
}
