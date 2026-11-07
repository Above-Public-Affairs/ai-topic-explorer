/**
 * Entity merging (task 2.7): the same organization, place, program or person
 * named different ways across answers and runs counts as one CanonicalEntity.
 * Each mention keeps its own wording on Entity; Entity.canonicalEntityId
 * points at the merged thing.
 *
 * Cheap and predictable, no second AI pass. A mention is matched by keys:
 *
 * - **name keys**: the name cleaned up (normalizeName, then "U.S." → "us",
 *   "Senate Bill" → "sb", trailing "Inc"/"LLC", person titles), the parts of
 *   "Full Name (ACRONYM)", and "X of Texas" turned into "Texas X". Two
 *   mentions sharing a name key are the same thing; a name key shared with
 *   two existing entities merges them.
 * - **acronym keys**: a name written as an acronym ("ERCOT", "Texas PUC",
 *   "SB 6"). Matched like a name key, but never used to merge two entities
 *   that already exist.
 * - **derived keys**: acronyms built from a full name ("Electric Reliability
 *   Council of Texas" → "ercot"), and, when the extraction model expanded an
 *   acronym, the short form as written. A derived key only joins a mention
 *   to an entity written that way and *only* when exactly one entity fits,
 *   and never one that already has a different full name. Two full names that
 *   happen to share an acronym ("American Chemistry Council", "Arizona
 *   Corporation Commission") stay apart.
 *
 * The extraction model's `canonicalName` (its full name for the mention, from
 * the answer's context) is the main name when given: "Texas PUC" comes back
 * as "Public Utility Commission of Texas". Rows stored before it existed are
 * merged by the rules alone.
 *
 * Keys are scoped by group: people only match people and places only match
 * places; organizations, laws and "other" share a group, since the model
 * doesn't always type an agency or program the same way.
 */
import { normalizeName } from "./parse";

export type EntityGroup = "person" | "place" | "thing";
export type AliasKind = "name" | "acronym" | "derived";

export interface EntityKey {
  key: string;
  kind: AliasKind;
}

export interface MentionInput {
  name: string;
  type: string;
  /** The extraction model's full name for it, when it gave one. */
  canonicalName?: string | null;
}

export function entityGroup(type: string): EntityGroup {
  return type === "person" ? "person" : type === "place" ? "place" : "thing";
}

const US_STATES = [
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida",
  "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine",
  "maryland", "massachusetts", "michigan", "minnesota", "mississippi", "missouri", "montana", "nebraska",
  "nevada", "new hampshire", "new jersey", "new mexico", "new york", "north carolina", "north dakota", "ohio",
  "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina", "south dakota", "tennessee", "texas",
  "utah", "vermont", "virginia", "washington", "west virginia", "wisconsin", "wyoming",
];
const STATE_SET = new Set(US_STATES);
/** States plus the country, for "X of Texas" → "Texas X" and "Texas PUC" → "texas puc". */
const JURISDICTIONS = new Set([...US_STATES, "us"]);

/** Words left out of the short acronym form ("Public Utility Commission of Texas" → "puct"). */
const STOPWORDS = new Set(["of", "the", "and", "for", "on", "in", "to", "a", "an", "at", "by"]);
const CORPORATE_SUFFIX = / (inc|incorporated|llc|l l c|ltd|corp|co|plc|lp|llp)$/;
const PERSON_TITLE =
  /^((u s |us )?(gov|governor|lt gov|lt governor|lieutenant governor|sen|senator|rep|representative|president|vice president|mayor|judge|commissioner|chairman|chair|chairwoman|secretary|attorney general|ag|dr|mr|mrs|ms|state sen|state senator|state rep|state representative|speaker|ceo|former) )+/;

/** Joins runs of single letters: "u s department" → "us department", "s b 6" → "sb 6". */
function joinInitials(s: string): string {
  return s.replace(/\b(?:[a-z] )+[a-z]\b/g, (m) => m.replace(/ /g, ""));
}

/**
 * The name used as a key: normalizeName plus a few rewrites that are safe
 * for any topic. Empty when nothing is left.
 */
export function entityKeyText(name: string, group: EntityGroup = "thing"): string {
  let s = joinInitials(normalizeName(name));
  s = s
    .replace(/\bunited states( of america)?\b/g, "us")
    .replace(/\busa\b/g, "us")
    .replace(/\bsenate bill\b/g, "sb")
    .replace(/\bhouse bill\b/g, "hb")
    .replace(/\b(sb|hb) no (\d)/g, "$1 $2")
    .replace(/\b(sb|hb)(\d)/g, "$1 $2");
  if (group === "thing") s = s.replace(CORPORATE_SUFFIX, "");
  if (group === "person") s = s.replace(PERSON_TITLE, "");
  return s.replace(/^the /, "").trim();
}

/** "Electric Reliability Council of Texas (ERCOT)" → base and the part in parentheses. */
function splitParenthetical(name: string): { base: string; inner: string } | null {
  const m = name.trim().match(/^(.+?)\s*\(([^()]+)\)\s*$/);
  return m ? { base: m[1], inner: m[2] } : null;
}

/** Written as an acronym: one or two words, at least one all capitals ("ERCOT", "Texas PUC", "SB 6"). */
export function looksLikeAcronym(name: string): boolean {
  const words = name.trim().split(/\s+/);
  if (words.length > 2) return false;
  return words.some((w) => /^[A-Z][A-Z0-9&.\-]*[A-Z0-9.]$/.test(w) && (w.match(/[A-Z]/g)?.length ?? 0) >= 2);
}

/** "public utility commission of texas" → "texas public utility commission". */
function moveJurisdictionFirst(key: string): string | null {
  const m = key.match(/^(.+) of (.+)$/);
  if (!m || !JURISDICTIONS.has(m[2])) return null;
  return `${m[2]} ${m[1]}`;
}

/**
 * Acronyms a full name could be written as: every initial, initials without
 * small words, and with a leading state kept whole ("texas puc"). Only names
 * of three or more words, and acronyms of three or more letters.
 */
export function acronymsOf(key: string): string[] {
  const words = key.split(" ");
  if (words.length < 3 || /\d/.test(key)) return [];
  const out = new Set<string>();
  const initials = (ws: string[]) => ws.map((w) => w[0]).join("");
  out.add(initials(words));
  out.add(initials(words.filter((w) => !STOPWORDS.has(w))));
  for (const form of [key, moveJurisdictionFirst(key)]) {
    if (!form) continue;
    const state = [...JURISDICTIONS].find((j) => form.startsWith(`${j} `));
    if (!state) continue;
    const rest = form.slice(state.length + 1).split(" ");
    const short = rest.filter((w) => !STOPWORDS.has(w));
    if (short.length >= 2) {
      out.add(`${state} ${initials(rest)}`);
      out.add(`${state} ${initials(short)}`);
    }
  }
  return [...out].filter((a) => a.replace(/ .*/, "").length >= 3 || a.includes(" "));
}

/** Name keys for one written form (a name, or one side of a parenthetical). */
function formKeys(form: string, group: EntityGroup): EntityKey[] {
  const key = entityKeyText(form, group);
  if (!key) return [];
  if (group === "thing" && looksLikeAcronym(form)) return [{ key, kind: "acronym" }];
  const keys: EntityKey[] = [{ key, kind: "name" }];
  if (group === "thing") {
    const moved = moveJurisdictionFirst(key);
    if (moved) keys.push({ key: moved, kind: "name" });
  }
  if (group === "place") {
    // "Austin, Texas" is Austin; "West Texas" stays West Texas.
    const m = form.match(/^(.+?),\s*([A-Za-z .]+)$/);
    if (m && STATE_SET.has(normalizeName(m[2]))) {
      const city = entityKeyText(m[1], group);
      if (city) keys.push({ key: city, kind: "name" });
    }
  }
  return keys;
}

/**
 * The written forms of a name. "Full Name (ACRONYM)" and "ACRONYM (Full
 * Name)" give both; any other parenthetical ("Senate Bill 6 (2025)",
 * "Oncor (Dallas)") is dropped, so it never becomes a key of its own.
 */
function formsOf(name: string): string[] {
  const p = splitParenthetical(name);
  if (!p) return [name];
  const multiWord = (s: string) => /\p{L}/u.test(s) && s.trim().split(/\s+/).length >= 2;
  if (looksLikeAcronym(p.inner) && multiWord(p.base)) return [p.base, p.inner];
  if (looksLikeAcronym(p.base) && multiWord(p.inner)) return [p.base, p.inner];
  return [p.base];
}

/**
 * Every key for a mention, prefixed with its group ("thing:ercot"). Primary
 * keys (name, acronym) come from the extraction model's canonical name when
 * it gave a different one, else from the name as written; the other spelling
 * and any acronyms of full names are derived keys.
 */
export function mentionKeys(m: MentionInput): { group: EntityGroup; primary: EntityKey[]; derived: string[] } {
  const group = entityGroup(m.type);
  const written = formsOf(m.name).flatMap((f) => formKeys(f, group));
  const canonical = m.canonicalName ? formsOf(m.canonicalName).flatMap((f) => formKeys(f, group)) : [];
  const writtenKeys = new Set(written.map((k) => k.key));
  const expanded = canonical.length > 0 && canonical.some((k) => !writtenKeys.has(k.key));

  const primary = dedupeKeys(expanded ? canonical : [...written, ...canonical]);
  const derived = new Set<string>();
  if (expanded) for (const k of written) derived.add(k.key);
  if (group === "thing") for (const k of primary) if (k.kind === "name") for (const a of acronymsOf(k.key)) derived.add(a);
  for (const k of primary) derived.delete(k.key);

  const prefix = (k: string) => `${group}:${k}`;
  return {
    group,
    primary: primary.map((k) => ({ key: prefix(k.key), kind: k.kind })),
    derived: [...derived].map(prefix),
  };
}

function dedupeKeys(keys: EntityKey[]): EntityKey[] {
  const byKey = new Map<string, EntityKey>();
  for (const k of keys) {
    const seen = byKey.get(k.key);
    // A key seen as a full name anywhere counts as a name.
    if (!seen || (seen.kind === "acronym" && k.kind === "name")) byKey.set(k.key, k);
  }
  return [...byKey.values()];
}

/** The best display name for a mention: the model's full name, else the name without "(ACRONYM)". */
export function displayName(m: MentionInput): string {
  const pick = (n: string) => {
    const p = splitParenthetical(n);
    if (!p) return n.trim();
    return looksLikeAcronym(p.base) && !looksLikeAcronym(p.inner) ? p.inner.trim() : p.base.trim();
  };
  return pick(m.canonicalName?.trim() || m.name);
}

// ---------------------------------------------------------------------------
// Resolver: pure, in memory. lib/extraction/link.ts loads the existing
// entities that share a key with the new mentions, resolves, and writes back.

export interface CanonicalState {
  id: string;
  name: string;
  group: EntityGroup;
  aliases: EntityKey[];
}

interface Node extends CanonicalState {
  isNew: boolean;
  changed: boolean;
  /** Set when merged into another entity. */
  mergedInto?: string;
  order: number;
}

export interface ResolveChanges {
  created: CanonicalState[];
  /** Existing entities whose name or aliases changed (full alias list given). */
  updated: CanonicalState[];
  /** Entities folded into another: every reference moves to `into`. */
  merged: { from: string; into: string }[];
}

export class EntityResolver {
  private nodes = new Map<string, Node>();
  /** alias "kind|key" → entity ids */
  private index = new Map<string, Set<string>>();
  private order = 0;

  constructor(
    existing: CanonicalState[] = [],
    private newId: () => string = () => crypto.randomUUID()
  ) {
    for (const c of existing) this.add({ ...c, aliases: [], isNew: false, changed: false, order: this.order++ }, c.aliases);
  }

  private add(node: Node, aliases: EntityKey[]) {
    this.nodes.set(node.id, node);
    for (const a of aliases) this.addAlias(node, a);
  }

  private addAlias(node: Node, a: EntityKey): boolean {
    if (node.aliases.some((x) => x.key === a.key && x.kind === a.kind)) return false;
    node.aliases.push(a);
    const ix = `${a.kind}|${a.key}`;
    if (!this.index.has(ix)) this.index.set(ix, new Set());
    this.index.get(ix)!.add(node.id);
    return true;
  }

  private find(kind: AliasKind, key: string): Node[] {
    return [...(this.index.get(`${kind}|${key}`) ?? [])].map((id) => this.nodes.get(id)!).filter((n) => !n.mergedInto);
  }

  private hasFullName(n: Node): boolean {
    return n.aliases.some((a) => a.kind === "name");
  }

  /** The entity id a mention belongs to; creates or merges entities as needed. */
  resolve(m: MentionInput): string | null {
    const { group, primary, derived } = mentionKeys(m);
    if (!primary.length) return null;
    const names = primary.filter((k) => k.kind === "name");
    const acronyms = primary.filter((k) => k.kind === "acronym");

    // 1. Same full name: the same thing. Several entities sharing a full
    //    name with this mention are merged.
    let matches = uniq(names.flatMap((k) => this.find("name", k.key)));
    // Or the same text stored as an acronym ("SB 6" before "Senate Bill 6"), if only one.
    if (!matches.length) {
      const asAcronym = uniq(names.flatMap((k) => this.find("acronym", k.key)));
      if (asAcronym.length === 1) matches = asAcronym;
    }

    // 2. Written as an acronym: the entity written the same way, or the one
    //    full name it stands for. Ambiguous acronyms join nothing new.
    if (!matches.length && acronyms.length) {
      // Written the same way, as an acronym or (SB 6 / Senate Bill 6) as a name.
      const same = uniq(acronyms.flatMap((k) => [...this.find("acronym", k.key), ...this.find("name", k.key)]));
      const expansions = uniq(acronyms.flatMap((k) => this.find("derived", k.key)));
      const all = uniq([...same, ...expansions]);
      if (all.length === 1) matches = all;
      else if (all.length > 1) {
        // Prefer one written as the bare acronym and never expanded.
        const bare = same.filter((n) => !this.hasFullName(n));
        matches = bare.length ? [bare.sort(byOrder)[0]] : same.length === 1 ? same : [];
      }
    }

    // 3. A full name whose acronym (or the short form the model expanded)
    //    matches an entity known only by that acronym, if exactly one.
    if (!matches.length && derived.length) {
      const bare = uniq(derived.flatMap((k) => this.find("acronym", k))).filter((n) => !this.hasFullName(n));
      if (bare.length === 1) matches = bare;
    }

    // A parenthetical pairs the full name with its acronym in the answer
    // itself, so it may also fold in an entity known only by that acronym.
    if (names.length && acronyms.length) {
      const bare = uniq(acronyms.flatMap((k) => this.find("acronym", k.key))).filter((n) => !this.hasFullName(n));
      if (bare.length === 1) matches = uniq([...matches, ...bare]);
    }

    let target: Node;
    if (!matches.length) {
      target = { id: this.newId(), name: displayName(m), group, aliases: [], isNew: true, changed: true, order: this.order++ };
      this.nodes.set(target.id, target);
    } else {
      matches.sort(byOrder);
      target = matches[0];
      for (const other of matches.slice(1)) this.merge(other, target);
    }

    let added = false;
    for (const k of primary) added = this.addAlias(target, k) || added;
    for (const k of derived) added = this.addAlias(target, { key: k, kind: "derived" }) || added;
    // An entity first seen as an acronym takes the first full name it gets.
    if (looksLikeAcronym(target.name) && names.length && !looksLikeAcronym(displayName(m))) {
      target.name = displayName(m);
      added = true;
    }
    if (added) target.changed = true;
    return target.id;
  }

  private merge(from: Node, into: Node) {
    from.mergedInto = into.id;
    for (const a of from.aliases) this.addAlias(into, a);
    if (looksLikeAcronym(into.name) && !looksLikeAcronym(from.name)) into.name = from.name;
    into.changed = true;
  }

  /** What to write back. Merged ids are resolved to their final entity. */
  changes(): ResolveChanges {
    const finalId = (id: string): string => {
      let n = this.nodes.get(id)!;
      while (n.mergedInto) n = this.nodes.get(n.mergedInto)!;
      return n.id;
    };
    const out: ResolveChanges = { created: [], updated: [], merged: [] };
    for (const n of this.nodes.values()) {
      const state = { id: n.id, name: n.name, group: n.group, aliases: [...n.aliases] };
      if (n.mergedInto) {
        if (!n.isNew) out.merged.push({ from: n.id, into: finalId(n.id) });
      } else if (n.isNew) out.created.push(state);
      else if (n.changed) out.updated.push(state);
    }
    return out;
  }

  /** The final entity for an id returned by resolve() (follows merges). */
  finalId(id: string): string {
    let n = this.nodes.get(id)!;
    while (n.mergedInto) n = this.nodes.get(n.mergedInto)!;
    return n.id;
  }

  /** Current (unmerged) entities, for tests and reports. */
  entities(): CanonicalState[] {
    return [...this.nodes.values()]
      .filter((n) => !n.mergedInto)
      .map((n) => ({ id: n.id, name: n.name, group: n.group, aliases: [...n.aliases] }));
  }
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
function byOrder(a: Node, b: Node) {
  return a.order - b.order;
}
