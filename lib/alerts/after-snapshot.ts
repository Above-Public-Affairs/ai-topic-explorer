/**
 * afterSnapshot(): the one call each snapshot makes when it finishes (weekly
 * worker, event watcher, model watcher). Turns the snapshot's changes beyond
 * the noise band into Alert rows, at most a few per watch item, each with its
 * facts, a plain-English summary and a subject, then sends them when alerts
 * are on (ALERTS_ENABLED=true) or stores them as suppressed when off.
 *
 * Idempotent: a run's alerts are created together in one transaction, and a
 * run that already has alerts gets none new; each alert is claimed
 * (pending → sending) before it's sent, so a re-run or a second process never
 * sends one twice. It never throws: failures come back in the result and go
 * to the error reporter, so a snapshot never fails because of its alerts.
 */
import { reportError } from "@above-public-affairs/error-reporter";
import { Prisma, type PrismaClient, type RunKind } from "@/app/generated/prisma/client";
import type { ProviderId } from "@/lib/answers";
import { sendEmail, type OutgoingEmail, type SendResult } from "@/lib/email/send";
import { compareSnapshots, inScope, loadFindings, noiseBand, shares, type AnswerFindings, type Comparison, type Labels, type SnapshotNoise, type SnapshotStats, type Swing } from "@/lib/snapshots";
import { alertCode, alertSubject, renderHtml, renderText, type AlertForEmail } from "./email";
import { buildFacts, quoteFor, snapshotDates, type AlertFacts, type EvidenceQuote } from "./facts";
import { aiName, selectAlerts, type Candidate, type Trigger } from "./select";
import { writeSummary } from "./write";

export const DEFAULT_ALERT_RECIPIENTS = ["joshua@abovepublicaffairs.com"];
const QUOTES_PER_ALERT = 3;

/** ALERTS_ENABLED=true sends; anything else stores alerts as suppressed. Off by default (task 8.2 turns it on). */
export function alertsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return /^(true|1|yes|on)$/i.test(env.ALERTS_ENABLED?.trim() ?? "");
}

/** ALERT_RECIPIENTS, comma-separated; Josh when unset. */
export function alertRecipients(env: Record<string, string | undefined> = process.env): string[] {
  const list = (env.ALERT_RECIPIENTS ?? "").split(",").map((a) => a.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_ALERT_RECIPIENTS;
}

export interface AfterSnapshotOptions {
  enabled?: boolean;
  recipients?: string[];
  /** Swappable for tests. */
  send?: (email: OutgoingEmail, options?: { kind?: string }) => Promise<SendResult>;
  write?: typeof writeSummary;
  log?: (line: string) => void;
}

export interface AfterSnapshotResult {
  runId: string;
  /** Why nothing was done, when nothing was. */
  skipped?: string;
  created: number;
  /** Alerts the run already had (a re-run). */
  existing: number;
  sent: number;
  suppressed: number;
  failed: number;
  costUsd: number;
  alerts: { code: string; status: string; subject: string }[];
  error?: unknown;
}

export async function afterSnapshot(db: PrismaClient, runId: string, options: AfterSnapshotOptions = {}): Promise<AfterSnapshotResult> {
  const result: AfterSnapshotResult = { runId, created: 0, existing: 0, sent: 0, suppressed: 0, failed: 0, costUsd: 0, alerts: [] };
  const log = options.log ?? (() => {});
  try {
    const existing = await db.alert.count({ where: { runId } });
    if (existing) result.existing = existing;
    else await createAlerts(db, runId, options, result);
    if (!result.skipped) await deliver(db, runId, options, result);
    const rows = await db.alert.findMany({ where: { runId }, orderBy: { number: "asc" }, select: { number: true, status: true, subject: true } });
    result.alerts = rows.map((r) => ({ code: alertCode(r.number), status: r.status, subject: r.subject }));
    log(alertsLine(result));
  } catch (err) {
    result.error = err;
    log(`alerts for run ${runId} failed: ${String(err)}`);
    await reportError({
      category: "alert_error",
      operation: "afterSnapshot",
      message: `Alerts failed for run ${runId}: ${err instanceof Error ? err.message : String(err)}`,
      rawError: err,
      context: { runId },
    });
  }
  return result;
}

export function alertsLine(r: AfterSnapshotResult): string {
  if (r.skipped) return `alerts: none (${r.skipped})`;
  const parts = [`${r.alerts.length} alert${r.alerts.length === 1 ? "" : "s"}${r.existing ? " (already made)" : ""}`];
  if (r.sent) parts.push(`${r.sent} sent`);
  if (r.suppressed) parts.push(`${r.suppressed} stored, not sent (ALERTS_ENABLED is off)`);
  if (r.failed) parts.push(`${r.failed} failed to send`);
  if (r.costUsd) parts.push(`$${r.costUsd.toFixed(4)}`);
  return `alerts: ${parts.join(", ")}${r.alerts.length ? ` [${r.alerts.map((a) => a.code).join(", ")}]` : ""}`;
}

interface Side {
  answers: AnswerFindings[];
  labels: Labels;
  noise: SnapshotNoise;
}

async function createAlerts(db: PrismaClient, runId: string, options: AfterSnapshotOptions, result: AfterSnapshotResult): Promise<void> {
  const run = await db.run.findUnique({
    where: { id: runId },
    select: {
      id: true,
      kind: true,
      status: true,
      watchItemId: true,
      stats: true,
      askCity: true,
      askRegion: true,
      askCountry: true,
      startedAt: true,
      watchItem: { select: { name: true, topic: true } },
      events: { orderBy: { occurredAt: "desc" }, take: 1, select: { id: true, title: true, occurredAt: true, sourceUrl: true } },
    },
  });
  if (!run?.watchItemId || !run.watchItem) return void (result.skipped = "not a watch-item snapshot");
  if (run.status !== "complete" && run.status !== "partial") return void (result.skipped = `run is ${run.status}`);
  const trigger = run.kind as Trigger;
  const stats = run.stats as (SnapshotStats & { modelSwitch?: ModelSwitchInfo }) | null;

  let comparison: Comparison;
  let before: Side;
  let after: Side;
  let beforeRun: { id: string; startedAt: Date } | null = null;
  let modelChanged: ProviderId[] = [];
  let eventId: string | null = run.events[0]?.id ?? null;
  let event: (typeof run.events)[number] | null = run.events[0] ?? null;
  let modelSwitch: { provider: string; oldModel: string; newModel: string } | null = null;

  if (run.kind === "model_switch") {
    const ms = stats?.modelSwitch;
    if (!ms) return void (result.skipped = "model-switch run has no switch details");
    const sides = await modelSwitchSides(db, run.id, run.watchItemId, ms);
    if (!sides) return void (result.skipped = "model-switch run has too few answers on one model");
    [before, after] = sides;
    comparison = compareSnapshots(before, after);
    // Both sides are one AI: its scope is the comparison; "all" is the same answers under the wrong band.
    comparison.swings = comparison.swings.filter((s) => s.scope === ms.provider);
    modelChanged = [ms.provider];
    modelSwitch = { provider: ms.provider, oldModel: ms.old.model, newModel: ms.new.model };
    eventId = ms.eventId;
    event = null;
  } else {
    const stored = stats?.comparison;
    if (!stored) return void (result.skipped = "no earlier snapshot to compare with");
    comparison = stored;
    beforeRun = await db.run.findUnique({ where: { id: stored.againstRunId }, select: { id: true, startedAt: true } });
    if (!beforeRun) return void (result.skipped = `compared run ${stored.againstRunId} is gone`);
    before = await side(db, beforeRun.id);
    after = await side(db, run.id);
    modelChanged = await modelsChanged(db, beforeRun.id, run.id);
  }
  if (!comparison.swings.length) return void (result.skipped = "no changes beyond the noise band");

  const firstSeen = await firstSeenKeys(db, run.watchItemId, beforeRun?.startedAt ?? run.startedAt, comparison.swings);
  const selection = selectAlerts(comparison.swings, { trigger, modelChanged, firstSeen });
  const providersInRun = [...new Set(after.answers.filter((a) => a.locked).map((a) => a.provider))].sort();
  const write = options.write ?? writeSummary;

  const drafts: { candidate: Candidate; facts: AlertFacts; written: Awaited<ReturnType<typeof writeSummary>> }[] = [];
  for (const candidate of selection.alerts) {
    const perAi = perAiShares(candidate, before, after);
    const dates = snapshotDates(beforeRun?.startedAt ?? run.startedAt, run.startedAt);
    const evidence = await evidenceFor(db, candidate, before, after, dates.before, dates.after, modelSwitch);
    const facts = buildFacts({
      candidate,
      watchItem: run.watchItem,
      run,
      beforeRun,
      trigger,
      providersInRun,
      perAi,
      event,
      modelSwitch,
      modelChanged,
      evidence,
      alsoChanged: selection.alsoChanged,
    });
    const written = await write(facts);
    result.costUsd += written.costUsd;
    drafts.push({ candidate, facts, written });
  }

  const enabled = options.enabled ?? alertsEnabled();
  try {
    await db.$transaction(async (tx) => {
      for (const { candidate, facts, written } of drafts) {
        const s = candidate.swing;
        const row = await tx.alert.create({
          data: {
            watchItemId: run.watchItemId!,
            runId: run.id,
            beforeRunId: beforeRun?.id ?? null,
            eventId,
            trigger: run.kind as RunKind,
            dedupeKey: `${run.id}:${s.scope}:${s.metric}:${s.key}`,
            metric: s.metric,
            key: s.key,
            label: s.label,
            kind: s.kind,
            scope: s.scope,
            providers: candidate.providers,
            before: s.before,
            after: s.after,
            countBefore: s.countBefore,
            countAfter: s.countAfter,
            threshold: s.threshold,
            modelChange: candidate.modelChange,
            rank: candidate.rank,
            facts: JSON.parse(JSON.stringify(facts)) as Prisma.InputJsonValue,
            subject: "",
            summary: `${written.summary}\n\n${written.why}`,
            writer: written.writer,
            costUsd: written.costUsd,
            status: enabled ? "pending" : "suppressed",
            note: [enabled ? null : "ALERTS_ENABLED is off: stored, not sent", written.rejected ? `model text not used (${written.rejected})` : null].filter(Boolean).join("; ") || null,
          },
          select: { id: true, number: true },
        });
        await tx.alert.update({ where: { id: row.id }, data: { subject: alertSubject({ number: row.number, facts }) } });
      }
    });
  } catch (err) {
    // Another process made this run's alerts first.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      result.existing = await db.alert.count({ where: { runId } });
      return;
    }
    throw err;
  }
  result.created = drafts.length;
  if (!enabled) result.suppressed = drafts.length;
}

/** Send the run's pending alerts, each claimed first so no alert is ever sent twice. */
async function deliver(db: PrismaClient, runId: string, options: AfterSnapshotOptions, result: AfterSnapshotResult): Promise<void> {
  const enabled = options.enabled ?? alertsEnabled();
  if (!enabled) return;
  const pending = await db.alert.findMany({ where: { runId, status: "pending" }, orderBy: { rank: "asc" } });
  for (const alert of pending) {
    const claim = await db.alert.updateMany({ where: { id: alert.id, status: "pending" }, data: { status: "sending" } });
    if (claim.count === 0) continue;
    try {
      const sent = await sendAlert(alert, options);
      await db.alert.update({ where: { id: alert.id }, data: { status: "sent", sentAt: sent.sentAt, messageId: sent.messageId } });
      result.sent++;
    } catch (err) {
      await db.alert.update({ where: { id: alert.id }, data: { status: "failed", note: `send failed: ${String(err)}`.slice(0, 1000) } });
      result.failed++;
    }
  }
}

export function emailFor(alert: { number: number; facts: unknown; summary: string }): AlertForEmail & { subject: string } {
  const facts = alert.facts as AlertFacts;
  const [summary, ...rest] = alert.summary.split("\n\n");
  const a = { number: alert.number, facts, summary, why: rest.join(" ") };
  return { ...a, subject: alertSubject(a) };
}

/** Send one stored alert (also used by scripts/alerts.ts for a test send). */
export async function sendAlert(
  alert: { number: number; facts: unknown; summary: string },
  options: Pick<AfterSnapshotOptions, "recipients" | "send"> & { subjectPrefix?: string } = {}
): Promise<SendResult> {
  const a = emailFor(alert);
  const send = options.send ?? sendEmail;
  return send(
    { to: options.recipients ?? alertRecipients(), subject: `${options.subjectPrefix ?? ""}${a.subject}`, text: renderText(a), html: renderHtml(a) },
    { kind: "alert" }
  );
}

interface ModelSwitchInfo {
  eventId: string;
  provider: ProviderId;
  old: { registryId: string; model: string };
  new: { registryId: string; model: string };
}

async function side(db: PrismaClient, runId: string): Promise<Side> {
  const run = await db.run.findUnique({ where: { id: runId }, select: { stats: true } });
  const { answers, labels } = await loadFindings(db, runId);
  const noise = (run?.stats as SnapshotStats | null)?.noise ?? noiseBand(answers);
  return { answers, labels, noise };
}

/** The old model's and the new model's answers in a model-switch run, judged with the item's latest snapshot noise. */
async function modelSwitchSides(db: PrismaClient, runId: string, watchItemId: string, ms: ModelSwitchInfo): Promise<[Side, Side] | null> {
  const { answers, labels } = await loadFindings(db, runId);
  const rows = await db.answer.findMany({ where: { runId }, select: { id: true, modelRegistryId: true } });
  const registry = new Map(rows.map((r) => [r.id, r.modelRegistryId]));
  const oldAnswers = answers.filter((a) => registry.get(a.answerId) === ms.old.registryId);
  const newAnswers = answers.filter((a) => registry.get(a.answerId) === ms.new.registryId);
  if (oldAnswers.length < 2 || newAnswers.length < 2) return null;
  const latest = await db.run.findFirst({
    where: { watchItemId, kind: { in: ["weekly", "event", "manual"] }, status: { in: ["complete", "partial"] }, stats: { not: Prisma.AnyNull } },
    orderBy: { startedAt: "desc" },
    select: { stats: true },
  });
  const noise = (latest?.stats as SnapshotStats | null)?.noise ?? {};
  return [
    { answers: oldAnswers, labels, noise },
    { answers: newAnswers, labels, noise },
  ];
}

/** AIs asked with a different model in the two runs. */
async function modelsChanged(db: PrismaClient, beforeRunId: string, afterRunId: string): Promise<ProviderId[]> {
  const models = async (runId: string) => {
    const rows = await db.answer.findMany({ where: { runId, errorKind: null }, distinct: ["provider", "requestedModel"], select: { provider: true, requestedModel: true } });
    const out = new Map<string, Set<string>>();
    for (const r of rows) out.set(r.provider, (out.get(r.provider) ?? new Set()).add(r.requestedModel));
    return out;
  };
  const [a, b] = await Promise.all([models(beforeRunId), models(afterRunId)]);
  const changed: ProviderId[] = [];
  for (const [provider, set] of b) {
    const prev = a.get(provider);
    if (prev && (prev.size !== set.size || [...set].some((m) => !prev.has(m)))) changed.push(provider as ProviderId);
  }
  return changed.sort();
}

/** `${metric}:${key}` of new entities, themes and sources never seen in this watch item before `before`. */
async function firstSeenKeys(db: PrismaClient, watchItemId: string, before: Date, swings: Swing[]): Promise<Set<string>> {
  const out = new Set<string>();
  const earlier = { watchItemId, startedAt: { lt: before } };
  for (const s of swings) {
    if (s.kind !== "new" || out.has(`${s.metric}:${s.key}`)) continue;
    let seen = 1;
    if (s.metric === "entity" && s.key.startsWith("c:")) {
      seen = await db.entity.count({ where: { canonicalEntityId: s.key.slice(2), extraction: { answer: { run: earlier } } } });
    } else if (s.metric === "theme" && s.key.startsWith("t:")) {
      seen = await db.theme.count({ where: { canonical: { slug: s.key.slice(2), watchItemId }, extraction: { answer: { run: earlier } } } });
    } else if (s.metric === "domain") {
      seen = await db.citation.count({ where: { domain: s.key, answer: { run: earlier } } });
    }
    if (seen === 0) out.add(`${s.metric}:${s.key}`);
  }
  return out;
}

/** Locked answers to the questions both sides asked (what compareSnapshots compared). */
function common(before: Side, after: Side): [AnswerFindings[], AnswerFindings[]] {
  const qa = new Set(before.answers.filter((a) => a.locked).map((a) => a.questionId));
  const both = new Set(after.answers.filter((a) => a.locked && qa.has(a.questionId)).map((a) => a.questionId));
  const keep = (xs: AnswerFindings[]) => xs.filter((a) => a.locked && both.has(a.questionId));
  return [keep(before.answers), keep(after.answers)];
}

/** Each AI's share of the finding before and after, and whether it moved past that AI's own band. */
function perAiShares(c: Candidate, before: Side, after: Side): { provider: string; before: number; after: number; pastOwnBand: boolean }[] {
  const s = c.swing;
  const [a, b] = common(before, after);
  const providers = [...new Set(b.map((x) => x.provider))].sort();
  if (s.scope !== "all" && providers.length <= 1) return [];
  return providers.map((p) => {
    const share = (xs: AnswerFindings[]) => shares(xs.filter(inScope(p)), s.metric).byKey.get(s.key)?.share ?? 0;
    return { provider: p, before: share(a), after: share(b), pastOwnBand: c.related.some((r) => r.scope === p && r.key === s.key) };
  });
}

/** Up to three short quotes from answers that show the finding: different AIs and questions first. */
async function evidenceFor(
  db: PrismaClient,
  c: Candidate,
  before: Side,
  after: Side,
  beforeDate: string,
  afterDate: string,
  modelSwitch: { provider: string; oldModel: string; newModel: string } | null
): Promise<EvidenceQuote[]> {
  const s = c.swing;
  const [a, b] = common(before, after);
  // Show where it now is; for a drop, where it was.
  const fromAfter = s.kind !== "gone" && s.kind !== "fell";
  const pool = (fromAfter ? b : a).filter((x) => x.findings[s.metric].includes(s.key));
  const wanted = s.scope === "all" ? null : new Set<string>(c.providers.length ? c.providers : [s.scope]);
  const ranked = pool.filter((x) => !wanted || wanted.has(x.provider));
  const picked: AnswerFindings[] = [];
  const usedAi = new Set<string>();
  const usedQ = new Set<string>();
  for (const pass of [0, 1, 2]) {
    for (const x of ranked) {
      if (picked.length >= QUOTES_PER_ALERT * 2) break;
      if (picked.includes(x)) continue;
      if (pass === 0 && (usedAi.has(x.provider) || usedQ.has(x.questionId))) continue;
      if (pass === 1 && usedQ.has(x.questionId)) continue;
      picked.push(x);
      usedAi.add(x.provider);
      usedQ.add(x.questionId);
    }
  }
  if (!picked.length) return [];
  const rows = await db.answer.findMany({
    where: { id: { in: picked.map((x) => x.answerId) } },
    select: {
      id: true,
      answer: true,
      requestedModel: true,
      citations: { orderBy: { position: "asc" }, select: { url: true, title: true, domain: true, cited: true } },
      extraction: {
        select: {
          entities: { select: { name: true, canonicalName: true, canonicalEntityId: true, normalized: true, canonical: { select: { name: true } } } },
          themes: { select: { label: true, canonical: { select: { slug: true, name: true } }, normalized: true } },
        },
      },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const when = fromAfter ? afterDate : beforeDate;
  const quotes: EvidenceQuote[] = [];
  for (const x of picked) {
    if (quotes.length >= QUOTES_PER_ALERT) break;
    const r = byId.get(x.answerId);
    if (!r?.answer) continue;
    let terms: string[] = [];
    if (s.metric === "entity") {
      terms = (r.extraction?.entities ?? [])
        .filter((e) => (e.canonicalEntityId ? `c:${e.canonicalEntityId}` : `n:${e.normalized}`) === s.key)
        .flatMap((e) => [e.name, e.canonicalName ?? "", e.canonical?.name ?? ""]);
    } else if (s.metric === "theme") {
      const mentions = (r.extraction?.themes ?? []).filter((t) => (t.canonical ? `t:${t.canonical.slug}` : t.normalized) === s.key);
      terms = mentions.flatMap((t) => [t.label, t.canonical?.name ?? ""]);
      // Theme labels are paraphrases: fall back to their longer words.
      terms.push(...terms.flatMap((t) => t.split(/\s+/)).filter((w) => w.length >= 6));
    } else if (s.metric === "domain") {
      terms = [s.key.split(".")[0], ...r.citations.filter((ci) => ci.domain === s.key).map((ci) => ci.title ?? "")];
    }
    const opening = () => quoteFor(r.answer!, r.answer!.split(/\s+/).filter((w) => w.length >= 5).slice(0, 12));
    // Tone and lean: the answer's opening sets them. A source: the citation is the evidence, the sentence is context.
    const quote = terms.length ? (quoteFor(r.answer, terms) ?? (s.metric === "domain" ? opening() : null)) : opening();
    if (!quote) continue;
    const source = s.metric === "domain" ? r.citations.find((ci) => ci.domain === s.key) : r.citations.find((ci) => ci.cited !== false);
    const ai = modelSwitch ? `${aiName(x.provider)} (${fromAfter ? modelSwitch.newModel : modelSwitch.oldModel})` : `${aiName(x.provider)}, ${when}`;
    quotes.push({ ai, question: x.questionLabel, quote, ...(source ? { sourceUrl: source.url, ...(source.title ? { sourceTitle: source.title } : {}) } : {}) });
  }
  return quotes;
}
