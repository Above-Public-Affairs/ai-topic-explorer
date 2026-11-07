/**
 * The public results page for an analysis run on the new pipeline (§2D):
 * each AI's answer as written, with its sources, plus the themes, arguments
 * and entities the extraction pass pulled out, combined across the AIs.
 *
 * `buildRunView` is pure, so it can be tested without a database;
 * `loadRunView` reads the run's rows and calls it.
 */
import type { Provider } from "@/lib/types";
import type { ProviderErrorKind } from "@/lib/answers/types";
import { providerErrorLabel } from "@/lib/answers/errors";
import { domainOf } from "@/lib/extraction/map";

/** Order the AIs are shown in. */
export const PROVIDER_ORDER: Provider[] = ["claude", "openai", "gemini", "grok"];

/** The rows the view is built from (the shape `loadRunView` selects). */
export interface RunRows {
  id: string;
  topic: string;
  startedAt: Date;
  answers: {
    provider: string;
    model: string | null;
    requestedModel: string;
    answer: string | null;
    errorKind: string | null;
    citations: { url: string; domain: string; title: string | null; cited: boolean | null; origin: string; position: number }[];
    extraction: {
      tone: string | null;
      framing: string | null;
      errorMessage: string | null;
      entities: { name: string; normalized: string; type: string; mentions: number; url: string | null }[];
      themes: { label: string; normalized: string; sentiment: string | null; weight: number | null }[];
      arguments: { side: "for" | "against"; text: string; sourceUrl: string | null }[];
    } | null;
  }[];
}

export interface AnswerSourceView {
  url: string;
  title: string;
  domain: string;
}

export interface AnswerView {
  provider: Provider;
  status: "done" | "failed";
  /** The model that answered, or the one asked for when the call failed. */
  model: string;
  text: string;
  /** Sources the answer cites (falls back to every source when the API doesn't mark which were cited). */
  sources: AnswerSourceView[];
  tone: string | null;
  framing: string | null;
  errorReason?: string;
}

export interface ThemeView {
  label: string;
  /** 1–5, for sizing: how many AIs raised it and how much of their answers it took. */
  relevance: number;
  providers: Provider[];
  sentiment: string | null;
}

export interface ArgumentView {
  text: string;
  providers: Provider[];
  sourceUrl: string | null;
}

export interface EntityView {
  name: string;
  url?: string;
  providers: Provider[];
  mentions: number;
}

export interface CitationView {
  title: string;
  url: string;
  domain: string;
  providers: Provider[];
}

export interface RunView {
  runId: string;
  topic: string;
  startedAt: Date;
  answers: AnswerView[];
  themes: ThemeView[];
  arguments: { for: ArgumentView[]; against: ArgumentView[] };
  entities: { label: string; items: EntityView[] }[];
  citations: CitationView[];
}

const ENTITY_GROUPS: { type: string; label: string }[] = [
  { type: "person", label: "People" },
  { type: "organization", label: "Organizations" },
  { type: "place", label: "Places" },
  { type: "legislation", label: "Laws and bills" },
];
const MAX_THEMES = 12;
const MAX_ENTITIES_PER_GROUP = 15;
const MAX_CITATIONS = 30;

function byProviderOrder(a: Provider, b: Provider) {
  return PROVIDER_ORDER.indexOf(a) - PROVIDER_ORDER.indexOf(b);
}

/** A URL reduced to a key for de-duplication: no fragment, no trailing slash. */
function urlKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/** Lower-cased words only, so near-identical argument sentences merge. */
function textKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function errorReason(kind: string | null): string {
  const kinds: ProviderErrorKind[] = ["quota_exhausted", "rate_limited", "auth", "blocked", "unavailable", "timeout", "other"];
  return providerErrorLabel(kinds.includes(kind as ProviderErrorKind) ? (kind as ProviderErrorKind) : "other");
}

function answerSources(citations: RunRows["answers"][number]["citations"]): AnswerSourceView[] {
  const ordered = [...citations].sort((a, b) => a.position - b.position);
  // Providers that say which sources were cited: show those. Providers that
  // don't (cited null) or only report what they looked at: show everything.
  const cited = ordered.filter((c) => c.cited !== false);
  const list = cited.length > 0 ? cited : ordered;
  const seen = new Set<string>();
  const out: AnswerSourceView[] = [];
  for (const c of list) {
    const key = urlKey(c.url);
    if (seen.has(key)) continue;
    seen.add(key);
    // Some titles arrive with Markdown heading marks ("# Title").
    const title = c.title?.replace(/^#+\s*/, "").trim();
    out.push({ url: c.url, title: title || c.domain, domain: c.domain || domainOf(c.url) || c.url });
  }
  return out;
}

export function buildRunView(run: RunRows): RunView {
  // One answer per provider (the public site asks one question once).
  const answers: AnswerView[] = [];
  const answered: { provider: Provider; row: RunRows["answers"][number]; sources: AnswerSourceView[] }[] = [];
  for (const provider of PROVIDER_ORDER) {
    const row = run.answers.find((a) => a.provider === provider);
    if (!row) continue;
    const text = row.answer?.trim() ?? "";
    if (!text) {
      answers.push({
        provider,
        status: "failed",
        model: row.model ?? row.requestedModel,
        text: "",
        sources: [],
        tone: null,
        framing: null,
        errorReason: row.errorKind ? errorReason(row.errorKind) : "Returned an empty answer",
      });
      continue;
    }
    const sources = answerSources(row.citations);
    answers.push({
      provider,
      status: "done",
      model: row.model ?? row.requestedModel,
      text,
      sources,
      tone: row.extraction?.errorMessage ? null : (row.extraction?.tone ?? null),
      framing: row.extraction?.errorMessage ? null : (row.extraction?.framing ?? null),
    });
    answered.push({ provider, row, sources });
  }

  // Themes: merged by normalized label across AIs.
  const themes = new Map<string, { label: string; providers: Set<Provider>; weight: number; sentiments: string[] }>();
  for (const { provider, row } of answered) {
    for (const t of row.extraction?.themes ?? []) {
      const key = t.normalized || t.label.toLowerCase();
      const entry = themes.get(key) ?? { label: t.label, providers: new Set(), weight: 0, sentiments: [] };
      entry.providers.add(provider);
      entry.weight += t.weight ?? 0.1;
      if (t.sentiment) entry.sentiments.push(t.sentiment);
      themes.set(key, entry);
    }
  }
  const themeList = [...themes.values()]
    .map((t) => ({ ...t, score: t.providers.size + t.weight }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_THEMES);
  const topScore = themeList[0]?.score ?? 1;
  const themeViews: ThemeView[] = themeList.map((t) => {
    const sentiments = new Set(t.sentiments);
    return {
      label: t.label,
      relevance: Math.max(1, Math.min(5, Math.round((t.score / topScore) * 5))),
      providers: [...t.providers].sort(byProviderOrder),
      sentiment: sentiments.size === 1 ? t.sentiments[0] : sentiments.size > 1 ? "mixed" : null,
    };
  });

  // Arguments: merged only when the sentence is the same. Most-shared first;
  // ties take turns across the AIs (each one's first, then each one's
  // second…) so the top of the list isn't all one AI.
  type ArgEntry = ArgumentView & { rank: number; first: Provider };
  const args = { for: new Map<string, ArgEntry>(), against: new Map<string, ArgEntry>() };
  for (const { provider, row } of answered) {
    const ranks = { for: 0, against: 0 };
    for (const a of row.extraction?.arguments ?? []) {
      const side = args[a.side];
      if (!side) continue;
      const rank = ranks[a.side]++;
      const key = textKey(a.text);
      const existing = side.get(key);
      if (existing) {
        if (!existing.providers.includes(provider)) existing.providers.push(provider);
        existing.sourceUrl ??= a.sourceUrl;
      } else {
        side.set(key, { text: a.text, providers: [provider], sourceUrl: a.sourceUrl, rank, first: provider });
      }
    }
  }
  const sortArgs = (m: Map<string, ArgEntry>): ArgumentView[] =>
    [...m.values()]
      .sort(
        (a, b) =>
          b.providers.length - a.providers.length || a.rank - b.rank || byProviderOrder(a.first, b.first)
      )
      .map(({ text, providers, sourceUrl }) => ({ text, providers: providers.sort(byProviderOrder), sourceUrl }));

  // Entities: merged by normalized name within each type.
  const entities = new Map<string, EntityView & { type: string }>();
  for (const { provider, row } of answered) {
    for (const e of row.extraction?.entities ?? []) {
      const key = `${e.type}:${e.normalized || e.name.toLowerCase()}`;
      const entry = entities.get(key) ?? { name: e.name, type: e.type, providers: [], mentions: 0 };
      if (!entry.providers.includes(provider)) entry.providers.push(provider);
      entry.mentions += e.mentions || 1;
      if (!entry.url && e.url) entry.url = e.url;
      entities.set(key, entry);
    }
  }
  const entityGroups = ENTITY_GROUPS.map(({ type, label }) => ({
    label,
    items: [...entities.values()]
      .filter((e) => e.type === type)
      .sort((a, b) => b.providers.length - a.providers.length || b.mentions - a.mentions)
      .slice(0, MAX_ENTITIES_PER_GROUP)
      .map(({ name, url, providers, mentions }) => ({
        name,
        ...(url && { url }),
        providers: providers.sort(byProviderOrder),
        mentions,
      })),
  })).filter((g) => g.items.length > 0);

  // Citations: every AI's sources, merged by URL, most-shared first, then by
  // where they first appeared.
  const citations = new Map<string, CitationView & { order: number }>();
  let order = 0;
  for (const { provider, sources } of answered) {
    for (const s of sources) {
      const key = urlKey(s.url);
      const entry = citations.get(key) ?? { ...s, providers: [], order: order++ };
      if (!entry.providers.includes(provider)) entry.providers.push(provider);
      citations.set(key, entry);
    }
  }
  const citationList = [...citations.values()]
    .sort((a, b) => b.providers.length - a.providers.length || a.order - b.order)
    .slice(0, MAX_CITATIONS)
    .map(({ title, url, domain, providers }) => ({ title, url, domain, providers: providers.sort(byProviderOrder) }));

  return {
    runId: run.id,
    topic: run.topic,
    startedAt: run.startedAt,
    answers,
    themes: themeViews,
    arguments: { for: sortArgs(args.for), against: sortArgs(args.against) },
    entities: entityGroups,
    citations: citationList,
  };
}

/** Load a run's rows and build its view; null when the run doesn't exist. */
export async function loadRunView(runId: string): Promise<RunView | null> {
  const { prisma } = await import("@/lib/db");
  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: {
      id: true,
      topic: true,
      startedAt: true,
      answers: {
        orderBy: { createdAt: "asc" },
        select: {
          provider: true,
          model: true,
          requestedModel: true,
          answer: true,
          errorKind: true,
          citations: { select: { url: true, domain: true, title: true, cited: true, origin: true, position: true } },
          extraction: {
            select: {
              tone: true,
              framing: true,
              errorMessage: true,
              entities: { select: { name: true, normalized: true, type: true, mentions: true, url: true } },
              themes: { select: { label: true, normalized: true, sentiment: true, weight: true } },
              arguments: { select: { side: true, text: true, sourceUrl: true } },
            },
          },
        },
      },
    },
  });
  return run ? buildRunView(run) : null;
}
