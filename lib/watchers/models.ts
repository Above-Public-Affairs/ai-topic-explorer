/**
 * The model watcher (task 4.5, PROJECT-PLAN §2C, §4D). A Railway cron service
 * runs scripts/model-watcher.ts daily at 13:00 UTC:
 *
 * 1. For each provider, check the free-tier default (models-check.ts). One
 *    provider failing never stops the others.
 * 2. Unchanged: refresh the row's confirmedAt only.
 * 3. Changed (with clear evidence): saveModel() retires the old row and adds
 *    the new one; a `new_model` Event is logged (approved, with its source);
 *    then, while the old model is still served, every watch item's locked
 *    anchor questions are asked once on each model, in a `model_switch` Run
 *    per item, so the model's own effect can be told from real-world change.
 *    Each answer points at the registry row it used.
 *
 * Safety:
 * - Once a day: a provider whose row was confirmed today (UTC) is skipped, so
 *   a second run (by hand, or a retry) does nothing new. A switch whose runs didn't
 *   all finish is resumed on the next run, within SWITCH_RESUME_MS.
 * - Daily check cap (MODEL_CHECK_CAP_USD, default $1) and a switch-day cap
 *   (MODEL_SWITCH_CAP_USD, default $12) shared across a day's switch runs.
 */
import { afterSnapshot } from "@/lib/alerts";
import type { Prisma, PrismaClient, RunStatus } from "@/app/generated/prisma/client";
import type { ModelChoice, ModelSettings, ProviderId } from "@/lib/answers";
import { PROVIDER_IDS, saveModel } from "@/lib/answers/registry";
import { runPipeline } from "@/lib/pipeline/run";
import { lockedQuestions } from "@/lib/questions";
import { askFreeTierDefault, decide, type CheckOutput, type Decision, type HasPrices, type ModelExists, type PageFetcher } from "./models-check";

export const DEFAULT_CHECK_CAP_USD = 1;
export const DEFAULT_SWITCH_CAP_USD = 12;
/** A switch whose runs didn't all finish is picked up again for this long. */
export const SWITCH_RESUME_MS = 48 * 60 * 60 * 1000;
/** A switch run "running" longer than this was orphaned. */
export const STALE_RUNNING_MS = 3 * 60 * 60 * 1000;
/** Planning figure for a switch item when no past answers say what the provider costs. */
export const FALLBACK_ANSWER_USD = 0.15;

/** Midnight UTC of the day `now` falls in. */
export function dayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** A ModelRegistry row, as the watcher reads it. */
export interface RegistryRecord {
  id: string;
  provider: ProviderId;
  model: string;
  effortLevel: string | null;
  searchSetting: string | null;
  locationMode: ModelChoice["locationMode"];
  confirmedAt: Date;
  isGuess: boolean;
  sourceUrl: string | null;
  note: string | null;
  activeFrom: Date;
  retiredAt: Date | null;
}

export function choiceFromRecord(row: RegistryRecord): ModelChoice {
  return {
    role: "answer",
    provider: row.provider,
    model: row.model,
    effortLevel: row.effortLevel,
    searchSetting: row.searchSetting,
    locationMode: row.locationMode,
    confirmedAt: row.confirmedAt,
    isGuess: row.isGuess,
    sourceUrl: row.sourceUrl,
    note: row.note,
    registryId: row.id,
    source: "registry",
  };
}

/** The new row's settings: the new model, with the old row's effort, search and location carried over. */
export function newSettings(current: RegistryRecord, d: Extract<Decision, { verdict: "changed" }>, now: Date): ModelSettings {
  return {
    role: "answer",
    provider: current.provider,
    model: d.modelId,
    effortLevel: current.effortLevel,
    searchSetting: current.searchSetting,
    locationMode: current.locationMode,
    confirmedAt: now,
    isGuess: d.isGuess,
    sourceUrl: d.sourceUrl,
    note:
      `Model watcher, ${now.toISOString().slice(0, 10)}: "${d.quote.slice(0, 400)}" (${d.sourceUrl}). ` +
      `Free default "${d.consumerName}" mapped to ${d.modelId}${d.isGuess ? " (a best guess: no official page names the API id)" : ""}. ` +
      `Effort, search and location carried over from ${current.model}.`,
  };
}

export interface ProviderOutcome {
  provider: ProviderId;
  outcome: "unchanged" | "changed" | "unclear" | "skipped" | "failed" | "resumed";
  reason?: string;
  model?: string;
  newModel?: string;
  checkCostUsd?: number;
  eventId?: string;
  switch?: SwitchResult;
  error?: unknown;
}

export interface SwitchItem {
  watchItemId: string;
  name: string;
  runId?: string;
  status?: RunStatus;
  outcome: "ran" | "skipped" | "failed";
  reason?: string;
  questions?: number;
  oldAnswered?: number;
  newAnswered?: number;
  costUsd?: number;
}

export interface SwitchResult {
  eventId: string;
  oldModel: string;
  newModel: string;
  items: SwitchItem[];
  costUsd: number;
  capUsd: number;
}

export interface ModelWatcherOptions {
  now?: Date;
  providers?: ProviderId[];
  checkCapUsd?: number;
  switchCapUsd?: number;
  /** Swappable for tests (and for injecting a "new default" in a proof). */
  check?: (provider: ProviderId, current: ModelChoice) => Promise<CheckOutput>;
  fetchPage?: PageFetcher;
  modelExists?: ModelExists;
  hasPrices?: HasPrices;
  /** Stands in for runPipeline in tests. */
  pipeline?: typeof runPipeline;
  /** Provider calls in flight at once on a switch run. */
  askConcurrency?: number;
  alerts?: typeof afterSnapshot;
  log?: (line: string) => void;
}

export interface ModelWatcherResult {
  providers: ProviderOutcome[];
  checkCostUsd: number;
  switchCostUsd: number;
  checkCapUsd: number;
  switchCapUsd: number;
}

const REGISTRY_SELECT = {
  id: true,
  provider: true,
  model: true,
  effortLevel: true,
  searchSetting: true,
  locationMode: true,
  confirmedAt: true,
  isGuess: true,
  sourceUrl: true,
  note: true,
  activeFrom: true,
  retiredAt: true,
} as const;

async function currentRow(db: PrismaClient, provider: ProviderId): Promise<RegistryRecord | null> {
  return db.modelRegistry.findFirst({ where: { role: "answer", provider, retiredAt: null }, orderBy: { activeFrom: "desc" }, select: REGISTRY_SELECT });
}

export async function runModelWatcher(db: PrismaClient, options: ModelWatcherOptions = {}): Promise<ModelWatcherResult> {
  const now = options.now ?? new Date();
  const checkCapUsd = options.checkCapUsd ?? DEFAULT_CHECK_CAP_USD;
  const switchCapUsd = options.switchCapUsd ?? DEFAULT_SWITCH_CAP_USD;
  const log = options.log ?? (() => {});
  const check = options.check ?? ((p: ProviderId, c: ModelChoice) => askFreeTierDefault(p, c, { now }));
  // The switch cap is per day: count switch runs already paid for today (an earlier deploy's run).
  const spentToday = await db.run.aggregate({ where: { kind: "model_switch", startedAt: { gte: dayStart(now) } }, _sum: { costUsd: true } });
  const budget = { check: 0, switch: spentToday._sum.costUsd ?? 0 };
  const outcomes: ProviderOutcome[] = [];

  for (const provider of options.providers ?? PROVIDER_IDS) {
    try {
      // A switch from an earlier run whose both-models runs didn't all finish.
      const pending = await pendingSwitch(db, provider, now);
      if (pending) {
        log(`${provider}: resuming the switch to ${pending.newRow.model} (event ${pending.eventId})`);
        const result = await runSwitch(db, { ...pending, provider }, budget, switchCapUsd, options);
        outcomes.push({ provider, outcome: "resumed", model: pending.oldRow.model, newModel: pending.newRow.model, eventId: pending.eventId, switch: result });
        log(switchLine(provider, result));
        continue;
      }

      const current = await currentRow(db, provider);
      if (!current) {
        outcomes.push({ provider, outcome: "failed", reason: "no current ModelRegistry row; run npm run models:seed" });
        log(`${provider}: FAILED, no current registry row`);
        continue;
      }
      if (current.confirmedAt >= dayStart(now)) {
        outcomes.push({ provider, outcome: "skipped", model: current.model, reason: `already checked today (${current.confirmedAt.toISOString()})` });
        log(`${provider}: skipped, already checked today`);
        continue;
      }
      if (budget.check >= checkCapUsd) {
        outcomes.push({ provider, outcome: "skipped", model: current.model, reason: `daily check cap $${checkCapUsd} reached ($${budget.check.toFixed(4)} spent)` });
        log(`${provider}: skipped, check cap reached`);
        continue;
      }

      const out = await check(provider, choiceFromRecord(current));
      budget.check += out.costUsd;
      const decision = await decide(provider, current, out.report, { fetchPage: options.fetchPage, modelExists: options.modelExists, hasPrices: options.hasPrices });
      const base = { provider, model: current.model, checkCostUsd: out.costUsd };

      if (decision.verdict === "unchanged") {
        // Refresh the confirmation only; the note and guess flag stay as they were.
        await db.modelRegistry.update({ where: { id: current.id }, data: { confirmedAt: now } });
        outcomes.push({ ...base, outcome: "unchanged" });
        log(`${provider}: unchanged, ${current.model} ($${out.costUsd.toFixed(4)}, ${out.searches} searches)`);
        continue;
      }
      if (decision.verdict === "unclear") {
        outcomes.push({ ...base, outcome: "unclear", reason: decision.reason });
        log(`${provider}: UNCLEAR, left as ${current.model}: ${decision.reason} ($${out.costUsd.toFixed(4)})`);
        continue;
      }

      // A clear change: update the list, log the event, run both models.
      const saved = await saveModel(newSettings(current, decision, now));
      const newRow = await db.modelRegistry.findUniqueOrThrow({ where: { id: saved.id }, select: REGISTRY_SELECT });
      const event = await db.event.create({
        data: {
          category: "new_model",
          status: "approved",
          title: `${provider} free-tier default changed: ${current.model} → ${decision.modelId}`,
          summary:
            `"${decision.quote.slice(0, 600)}" Free default "${decision.consumerName}" mapped to ${decision.modelId}` +
            `${decision.isGuess ? " (mapping is a guess)" : ""}. Old row ${current.id}, new row ${saved.id}.`,
          sourceUrl: decision.sourceUrl,
          sourceName: new URL(decision.sourceUrl).hostname,
          occurredAt: decision.effectiveDate ? new Date(`${decision.effectiveDate}T00:00:00Z`) : now,
          detectedAt: now,
          triggerAt: now,
          modelRegistryId: saved.id,
        },
        select: { id: true },
      });
      log(`${provider}: CHANGED ${current.model} → ${decision.modelId} (event ${event.id}, row ${saved.id})`);
      const oldRow = { ...current, retiredAt: now };
      const result = await runSwitch(db, { provider, eventId: event.id, oldRow, newRow }, budget, switchCapUsd, options);
      outcomes.push({ ...base, outcome: "changed", newModel: decision.modelId, eventId: event.id, switch: result });
      log(switchLine(provider, result));
    } catch (err) {
      outcomes.push({ provider, outcome: "failed", reason: String(err), error: err });
      log(`${provider}: FAILED: ${String(err)}`);
    }
  }
  const switchCostUsd = outcomes.reduce((s, o) => s + (o.switch?.costUsd ?? 0), 0);
  return { providers: outcomes, checkCostUsd: budget.check, switchCostUsd, checkCapUsd, switchCapUsd };
}

interface PendingSwitch {
  eventId: string;
  oldRow: RegistryRecord;
  newRow: RegistryRecord;
}

/** Where a switch run says which event and models it belongs to. */
export interface ModelSwitchStats {
  modelSwitch: {
    eventId: string;
    provider: ProviderId;
    old: { registryId: string; model: string; answered: number; failed: number };
    new: { registryId: string; model: string; answered: number; failed: number };
    repeats: 1;
  };
}

/** A recent new_model event for this provider whose switch runs haven't all finished. */
async function pendingSwitch(db: PrismaClient, provider: ProviderId, now: Date): Promise<PendingSwitch | null> {
  const event = await db.event.findFirst({
    where: { category: "new_model", status: "approved", detectedAt: { gte: new Date(now.getTime() - SWITCH_RESUME_MS) }, modelRegistry: { provider, role: "answer" } },
    orderBy: { detectedAt: "desc" },
    select: { id: true, modelRegistryId: true },
  });
  if (!event?.modelRegistryId) return null;
  const items = await activeItems(db);
  const done = await switchRunsByItem(db, event.id, now);
  const open = [];
  for (const i of items) if (!done.has(i.id) && (await lockedQuestions(db, i.id)).length) open.push(i);
  if (!open.length) return null;
  const newRow = await db.modelRegistry.findUniqueOrThrow({ where: { id: event.modelRegistryId }, select: REGISTRY_SELECT });
  // A newer switch since retired this row: the old pair no longer matters.
  if (newRow.retiredAt) return null;
  const oldRow = await db.modelRegistry.findFirst({
    where: { role: "answer", provider, id: { not: newRow.id }, retiredAt: { not: null, lte: newRow.activeFrom } },
    orderBy: { retiredAt: "desc" },
    select: REGISTRY_SELECT,
  });
  if (!oldRow) return null;
  return { eventId: event.id, oldRow, newRow };
}

async function activeItems(db: PrismaClient) {
  return db.watchItem.findMany({ where: { active: true, retiredAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
}

/** Watch items that already have a finished (or still running) switch run for this event. */
async function switchRunsByItem(db: PrismaClient, eventId: string, now: Date): Promise<Set<string>> {
  const runs = await db.run.findMany({
    where: { kind: "model_switch", stats: { path: ["modelSwitch", "eventId"], equals: eventId } },
    select: { watchItemId: true, status: true, startedAt: true },
  });
  return new Set(
    runs
      .filter((r) => r.status === "complete" || r.status === "partial" || (r.status === "running" && now.getTime() - r.startedAt.getTime() < STALE_RUNNING_MS))
      .map((r) => r.watchItemId)
      .filter((id): id is string => !!id)
  );
}

/** Average cost of this provider's recent successful answers, for planning a switch item. */
async function answerCostEstimate(db: PrismaClient, provider: ProviderId): Promise<number> {
  const recent = await db.answer.findMany({ where: { provider, errorKind: null, costUsd: { gt: 0 } }, orderBy: { createdAt: "desc" }, take: 50, select: { costUsd: true } });
  if (!recent.length) return FALLBACK_ANSWER_USD;
  return recent.reduce((s, a) => s + a.costUsd, 0) / recent.length;
}

/**
 * Ask every active watch item's locked questions once on the old model and
 * once on the new, one Run (kind model_switch) per item. Items already done
 * for this event are skipped. Stops starting items when the switch cap can't
 * cover the next one, and stops mid-item at the cap.
 */
async function runSwitch(
  db: PrismaClient,
  sw: PendingSwitch & { provider: ProviderId },
  budget: { switch: number },
  capUsd: number,
  options: ModelWatcherOptions
): Promise<SwitchResult> {
  const pipeline = options.pipeline ?? runPipeline;
  const now = options.now ?? new Date();
  const items = await activeItems(db);
  const done = await switchRunsByItem(db, sw.eventId, now);
  const perAnswer = await answerCostEstimate(db, sw.provider);
  const result: SwitchResult = { eventId: sw.eventId, oldModel: sw.oldRow.model, newModel: sw.newRow.model, items: [], costUsd: 0, capUsd };
  const models = { old: choiceFromRecord(sw.oldRow), new: choiceFromRecord(sw.newRow) };

  for (const item of items) {
    if (done.has(item.id)) {
      result.items.push({ watchItemId: item.id, name: item.name, outcome: "skipped", reason: "already ran for this switch" });
      continue;
    }
    const locked = await lockedQuestions(db, item.id);
    if (!locked.length) {
      result.items.push({ watchItemId: item.id, name: item.name, outcome: "skipped", reason: "no locked questions" });
      continue;
    }
    const estimate = perAnswer * locked.length * 2;
    const left = capUsd - budget.switch;
    if (estimate > left) {
      result.items.push({ watchItemId: item.id, name: item.name, outcome: "skipped", reason: `switch cap $${capUsd}: needs about $${estimate.toFixed(2)}, $${left.toFixed(2)} left` });
      continue;
    }

    const full = await db.watchItem.findUniqueOrThrow({ where: { id: item.id }, include: { subTopics: { where: { retiredAt: null } } } });
    const location = { city: full.askCity, region: full.askRegion, country: full.askCountry, ...(full.askTimezone ? { timezone: full.askTimezone } : {}) };
    const stats: ModelSwitchStats = {
      modelSwitch: {
        eventId: sw.eventId,
        provider: sw.provider,
        old: { registryId: sw.oldRow.id, model: sw.oldRow.model, answered: 0, failed: 0 },
        new: { registryId: sw.newRow.id, model: sw.newRow.model, answered: 0, failed: 0 },
        repeats: 1,
      },
    };
    const run = await db.run.create({
      data: {
        kind: "model_switch",
        watchItemId: item.id,
        topic: full.topic,
        askCity: location.city,
        askRegion: location.region,
        askCountry: location.country,
        askTimezone: location.timezone ?? null,
        note: `model watcher: ${sw.provider} ${sw.oldRow.model} → ${sw.newRow.model}, event ${sw.eventId}`,
        stats: stats as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    // The event links to its first switch run; every run names the event in stats.
    await db.event.updateMany({ where: { id: sw.eventId, runId: null }, data: { runId: run.id } });

    const stop = new AbortController();
    let itemSpent = 0;
    const questions = locked.map((q) => ({ text: q.text, questionId: q.id, repeat: 1 }));
    const outcome: SwitchItem = { watchItemId: item.id, name: item.name, runId: run.id, outcome: "ran", questions: locked.length };
    try {
      const statuses: RunStatus[] = [];
      // Old model first: it's the one that may stop being served.
      for (const which of ["old", "new"] as const) {
        const r = await pipeline(db, {
          kind: "model_switch",
          topic: full.topic,
          questions,
          location,
          providers: [sw.provider],
          models: { [sw.provider]: models[which] },
          watchItemId: item.id,
          runId: run.id,
          subTopics: full.subTopics.map((s) => ({ id: s.id, name: s.name })),
          askConcurrency: options.askConcurrency,
          signal: stop.signal,
          onAnswer: (e) => {
            if (e.ok) itemSpent += e.result.cost.usd;
            if (budget.switch + itemSpent > capUsd && !stop.signal.aborted) stop.abort(new Error(`switch spending cap $${capUsd} reached`));
          },
        });
        statuses.push(r.status);
        const answered = r.answers.filter((a) => a.ok).length;
        stats.modelSwitch[which].answered = answered;
        stats.modelSwitch[which].failed = r.answers.length - answered;
        outcome.costUsd = (outcome.costUsd ?? 0) + r.costUsd;
      }
      outcome.oldAnswered = stats.modelSwitch.old.answered;
      outcome.newAnswered = stats.modelSwitch.new.answered;
      const status: RunStatus = statuses.every((s) => s === "failed") ? "failed" : statuses.every((s) => s === "complete") ? "complete" : "partial";
      outcome.status = status;
      if (stop.signal.aborted) outcome.reason = `stopped at the $${capUsd} switch cap`;
      await db.run.update({
        where: { id: run.id },
        data: {
          status,
          finishedAt: new Date(),
          costUsd: Math.round((outcome.costUsd ?? 0) * 1e8) / 1e8,
          stats: stats as unknown as Prisma.InputJsonValue,
          note: `model watcher: ${sw.provider} ${sw.oldRow.model} → ${sw.newRow.model}, event ${sw.eventId}; old ${stats.modelSwitch.old.answered}/${locked.length}, new ${stats.modelSwitch.new.answered}/${locked.length}${outcome.reason ? `; ${outcome.reason}` : ""}`,
        },
      });
    } catch (err) {
      outcome.outcome = "failed";
      outcome.reason = String(err);
      await db.run.update({ where: { id: run.id }, data: { status: "failed", finishedAt: new Date(), note: `model watcher: ${String(err)}`.slice(0, 1000) } }).catch(() => {});
    }
    // Labeled as a model change, never as real-world change; skips a failed run.
    if (outcome.outcome === "ran") await (options.alerts ?? afterSnapshot)(db, run.id, { log: (l) => options.log?.(`${sw.provider} ${item.name}: ${l}`) });
    budget.switch += outcome.costUsd ?? 0;
    result.costUsd += outcome.costUsd ?? 0;
    result.items.push(outcome);
  }
  return result;
}

export function switchLine(provider: ProviderId, r: SwitchResult): string {
  const items = r.items.map((i) =>
    i.outcome === "ran"
      ? `${i.name}: ${i.status}, old ${i.oldAnswered}/${i.questions}, new ${i.newAnswered}/${i.questions}, $${(i.costUsd ?? 0).toFixed(2)}${i.reason ? ` (${i.reason})` : ""}`
      : `${i.name}: ${i.outcome}${i.reason ? `, ${i.reason}` : ""}`
  );
  return `${provider}: switch runs ${r.oldModel} vs ${r.newModel}, $${r.costUsd.toFixed(2)} of $${r.capUsd}. ${items.join("; ")}`;
}
