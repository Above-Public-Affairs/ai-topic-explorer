/**
 * The rules for question sets (PROJECT-PLAN §4B), as pure functions so they
 * can be tested without a database or a model:
 *
 * - how many questions each set has and how the anchor set covers sub-topics,
 * - what makes a question read the way a voter asks (checkVoterVoice),
 * - which candidates a set keeps (selectQuestions),
 * - when a fresh question is promoted into a locked set (findPromotions).
 */

/** Anchor questions per watch item (the plan's cost model: 8 anchor + 8 fresh per snapshot). */
export const ANCHOR_SIZE = 8;
/** Fresh questions per snapshot. */
export const FRESH_SIZE = 8;
/** Overall (not sub-topic) questions the anchor set keeps when an item has sub-topics. */
export const ANCHOR_OVERALL = 2;

/**
 * Promotion rule. A fresh question is promoted into a new locked set when its
 * concern (the short label for what it's really about) came up in at least
 * PROMOTION_MIN_SNAPSHOTS of the last PROMOTION_WINDOW fresh sets, and no
 * question still in a locked set (anchor or promoted) has that concern.
 * At most MAX_PROMOTIONS_PER_SNAPSHOT are promoted at once, and a watch item
 * holds at most MAX_ACTIVE_PROMOTED promoted questions that aren't retired,
 * so the per-snapshot cost stays near the plan's. Ties go to the concern seen
 * in more sets, then the one seen most recently. The promoted question keeps
 * the most recent fresh wording, word for word.
 */
export const PROMOTION_WINDOW = 4;
export const PROMOTION_MIN_SNAPSHOTS = 3;
export const MAX_PROMOTIONS_PER_SNAPSHOT = 2;
export const MAX_ACTIVE_PROMOTED = 4;

/** Questions per sub-topic in the anchor set: the rest after the overall ones, split evenly, at least one each. */
export function anchorPlan(subTopics: string[], size = ANCHOR_SIZE): { perSubTopic: number; overall: number } {
  if (subTopics.length === 0) return { perSubTopic: 0, overall: size };
  const perSubTopic = Math.max(1, Math.floor((size - ANCHOR_OVERALL) / subTopics.length));
  return { perSubTopic, overall: Math.max(0, size - perSubTopic * subTopics.length) };
}

/** Lower-case, trimmed, single-spaced, without punctuation: how concerns are matched across snapshots. */
export function normalizeConcern(concern: string): string {
  return concern
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Question text compared for duplicates: case, punctuation and spacing ignored. */
export function normalizeQuestion(text: string): string {
  return normalizeConcern(text);
}

/** Policy and industry terms an ordinary voter wouldn't type. */
const JARGON =
  /\b(stakeholders?|externalit(y|ies)|ratepayers?|BESS|load growth|interconnection|curtailment|curtail(ed|ing)?|dispatchable|baseload|ancillary services|levelized|LCOE|ESG|decarboni[sz]\w*|PPAs?|offtake|midstream|severance tax|royalt(y|ies) rates?|leverage|paradigm|synerg\w*|narrative|discourse|framing|sentiment|socioeconomic|mitigat\w*)\b/i;
/** Words that load the question or assume its answer. */
const LOADED =
  /\b(scam|hoax|greedy|greed|destroy(s|ing)?|ruin(s|ing)?|radical|so-called|corrupt\w*|evil|disaster|catastroph\w*|killing|poison(ing|ed)?|rip(ping)? off|shady|propaganda|war on)\b/i;
/** Companies a voter might name. We track industries, not companies (or clients), so none appear. */
const COMPANIES =
  /\b(google|alphabet|meta|facebook|microsoft|amazon|aws|apple|openai|oracle|nvidia|tesla|xai|stargate|crusoe|exxon\w*|chevron|conocophillips|occidental|oxy|devon|eog|diamondback|mewbourne|nextera|vistra|nrg|oncor|centerpoint|aep|xcel|pnm|txnm|ercot inc|intersect power|invenergy|orsted|ørsted|enbridge|kinder morgan|energy transfer|halliburton|blackrock)\b/i;
/** Talking about the chatbot or the study, not the topic. */
const META = /\b(as an ai|ai chatbot|this survey|watch item|anchor|sub-?topic)\b/i;

export const MAX_WORDS = 30;
export const MIN_WORDS = 5;

/**
 * Why a question doesn't read the way a voter asks, or [] when it does: one
 * plain question ending in "?", 5–30 words, no jargon, no loaded words, no
 * company names, nothing about AI or this study.
 */
export function checkVoterVoice(text: string): string[] {
  const issues: string[] = [];
  const t = text.trim();
  const words = t.split(/\s+/).filter(Boolean).length;
  if (!t.endsWith("?")) issues.push("not a question");
  if ((t.match(/\?/g) ?? []).length > 1) issues.push("more than one question");
  if (words > MAX_WORDS) issues.push(`too long (${words} words)`);
  if (words < MIN_WORDS) issues.push(`too short (${words} words)`);
  const jargon = t.match(JARGON);
  if (jargon) issues.push(`jargon: "${jargon[0]}"`);
  const loaded = t.match(LOADED);
  if (loaded) issues.push(`loaded word: "${loaded[0]}"`);
  const company = t.match(COMPANIES);
  if (company) issues.push(`names a company: "${company[0]}"`);
  if (META.test(t)) issues.push("about the AI or the study, not the topic");
  return issues;
}

export interface Candidate {
  text: string;
  /** The sub-topic name exactly as stored, or null for an overall question. */
  subTopic: string | null;
  concern: string;
  why?: string | null;
}

export interface Rejected extends Candidate {
  issues: string[];
}

/**
 * Keep the candidates that pass checkVoterVoice and aren't duplicates (of each
 * other or of `existing`), up to `size`. With `perSubTopic`, each sub-topic
 * first gets that many (in the model's order), then overall questions fill
 * up to `overall`, then anything left fills the rest. `missing` says what the
 * set still lacks, for one retry.
 */
export function selectQuestions(
  candidates: Candidate[],
  options: { size: number; subTopics: string[]; perSubTopic?: number; overall?: number; existing?: string[] }
): { kept: Candidate[]; rejected: Rejected[]; missing: string[] } {
  const seen = new Set((options.existing ?? []).map(normalizeQuestion));
  const rejected: Rejected[] = [];
  const valid: Candidate[] = [];
  for (const c of candidates) {
    const text = c.text.trim().replace(/\s+/g, " ");
    const issues = checkVoterVoice(text);
    const key = normalizeQuestion(text);
    if (seen.has(key)) issues.push("duplicate");
    if (!c.concern.trim()) issues.push("no concern label");
    if (issues.length) {
      rejected.push({ ...c, text, issues });
      continue;
    }
    seen.add(key);
    valid.push({ ...c, text, concern: normalizeConcern(c.concern) });
  }

  const kept: Candidate[] = [];
  const take = (c: Candidate) => {
    if (kept.length < options.size && !kept.includes(c)) kept.push(c);
  };
  const per = options.perSubTopic ?? 0;
  const missing: string[] = [];
  if (per > 0) {
    for (const name of options.subTopics) {
      const forIt = valid.filter((c) => c.subTopic === name).slice(0, per);
      forIt.forEach(take);
      if (forIt.length < per) missing.push(`${per - forIt.length} more about ${name}`);
    }
    const overall = options.overall ?? 0;
    const general = valid.filter((c) => c.subTopic === null).slice(0, overall);
    general.forEach(take);
    if (general.length < overall) missing.push(`${overall - general.length} more about the topic overall`);
  }
  valid.forEach(take);
  if (kept.length < options.size && missing.length === 0) missing.push(`${options.size - kept.length} more`);
  // Keep the model's order within the set, sub-topics grouped as it wrote them.
  kept.sort((a, b) => valid.indexOf(a) - valid.indexOf(b));
  return { kept, rejected, missing };
}

export interface FreshSetHistory {
  setId: string;
  startedAt: Date;
  questions: { id: string; text: string; concern: string | null; subTopicId: string | null }[];
}

export interface Promotion {
  concern: string;
  /** The fresh question the promoted copy comes from (the latest wording). */
  fromQuestionId: string;
  text: string;
  subTopicId: string | null;
  /** In how many of the window's fresh sets the concern came up. */
  seenIn: number;
}

/**
 * Apply the promotion rule (see PROMOTION_WINDOW above) to a watch item's
 * past fresh sets. `lockedConcerns` are the concerns of questions still in a
 * locked set; `activePromoted` is how many promoted questions aren't retired.
 */
export function findPromotions(
  freshSets: FreshSetHistory[],
  lockedConcerns: Iterable<string>,
  activePromoted: number,
  rules: { window?: number; minSnapshots?: number; perSnapshot?: number; maxActive?: number } = {}
): Promotion[] {
  const window = rules.window ?? PROMOTION_WINDOW;
  const min = rules.minSnapshots ?? PROMOTION_MIN_SNAPSHOTS;
  const room = Math.min(rules.perSnapshot ?? MAX_PROMOTIONS_PER_SNAPSHOT, (rules.maxActive ?? MAX_ACTIVE_PROMOTED) - activePromoted);
  if (room <= 0) return [];
  const locked = new Set([...lockedConcerns].map(normalizeConcern));
  const recent = [...freshSets].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()).slice(0, window);

  const byConcern = new Map<string, { sets: Set<string>; latest: { index: number; q: FreshSetHistory["questions"][number] } }>();
  recent.forEach((set, index) => {
    for (const q of set.questions) {
      if (!q.concern) continue;
      const concern = normalizeConcern(q.concern);
      if (!concern || locked.has(concern)) continue;
      const entry = byConcern.get(concern);
      if (!entry) byConcern.set(concern, { sets: new Set([set.setId]), latest: { index, q } });
      else entry.sets.add(set.setId);
    }
  });

  return [...byConcern.entries()]
    .filter(([, e]) => e.sets.size >= min)
    .sort(([, a], [, b]) => b.sets.size - a.sets.size || a.latest.index - b.latest.index)
    .slice(0, room)
    .map(([concern, e]) => ({
      concern,
      fromQuestionId: e.latest.q.id,
      text: e.latest.q.text,
      subTopicId: e.latest.q.subTopicId,
      seenIn: e.sets.size,
    }));
}
