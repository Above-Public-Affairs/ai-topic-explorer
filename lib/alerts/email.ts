/**
 * The alert email (task 5.2), written for anyone to read in a few seconds:
 * one plain sentence saying what changed, one on what it could mean, how the
 * AIs were asked, a couple of examples, and a ready-made Claude prompt. The
 * percentages and the "bigger than chance" test sit in a small details line
 * at the bottom. Plain text plus simple inline-styled HTML (Outlook, Gmail).
 */
import type { AlertFacts } from "./facts";
import { plainShare } from "./plain";

export const alertCode = (number: number) => `A-${number}`;

/** Quotes shown in the email; Alert.facts keeps up to three. */
const EXAMPLES = 2;

export interface AlertForEmail {
  number: number;
  facts: AlertFacts;
  summary: string;
  why: string;
}

/** "Data centers in Texas: Gemini's new model cites reddit.com less (model change) · A-2". */
export function alertSubject(a: { number: number; facts: AlertFacts }): string {
  return `${a.facts.watchItem}: ${a.facts.plain.short} · ${alertCode(a.number)}`;
}

/** "Asked as a user in Austin, Texas" → "as a user in Austin, Texas". */
const asWho = (askedAs: string) => askedAs.replace(/^Asked /, "");

/**
 * The prompt to paste into Claude. With the AI Topic Explorer connector
 * (task 5.4) the first line is enough; without it, the rest is the context.
 */
export function claudePrompt(a: AlertForEmail): string {
  return [
    `Using AI Topic Explorer, explain alert ${alertCode(a.number)}.`,
    "",
    `If you can't reach AI Topic Explorer, here's the alert: ${a.facts.plain.headline}${a.facts.plain.modelNote ? ` ${a.facts.plain.modelNote}` : ""} Topic: ${a.facts.watchItem}. The AIs were asked ${asWho(a.facts.askedAs)}. What could explain this, and is it worth acting on?`,
  ].join("\n");
}

/** The small print: the real counts and why this counts as more than chance. */
function details(a: AlertForEmail): string {
  const f = a.facts.finding;
  const when = a.facts.trigger === "model_switch" ? "old model → new model" : `${a.facts.dates.before} → ${a.facts.dates.after}`;
  const perAi = a.facts.perAi.length ? ` By AI: ${a.facts.perAi.map((p) => `${p.ai} ${p.before} → ${p.after}`).join(", ")}.` : "";
  return `${f.before} → ${f.after} of answers (${f.answersBefore} → ${f.answersAfter}), ${when}.${perAi} Asking the same questions again moves this by up to about ${f.usualWobble} by chance; this moved ${f.moved}, so it counts as a real change.`;
}

export function renderText(a: AlertForEmail): string {
  const lines = [a.facts.plain.headline, ""];
  if (a.facts.plain.modelNote) lines.push(`Why: ${a.facts.plain.modelNote}`, "");
  lines.push(`What it could mean: ${a.why}`, "", `How the AIs were asked: ${asWho(a.facts.askedAs)}.`);
  if (a.facts.event) lines.push(`Checked after: ${a.facts.event.title} (${a.facts.event.date}).`);
  const examples = a.facts.evidence.slice(0, EXAMPLES);
  if (examples.length) {
    lines.push("", "For example:");
    for (const q of examples) lines.push(`- ${exampleWho(q.ai)}: "${q.quote}"${q.sourceUrl ? ` (source: ${q.sourceUrl})` : ""}`);
  }
  lines.push("", "Ask Claude (copy and paste):", claudePrompt(a));
  lines.push("", `Details: ${details(a)}`);
  if (a.facts.alsoChanged.length) lines.push(`Also changed: ${a.facts.alsoChanged.join("; ")}.`);
  lines.push("", `AI Topic Explorer · ${a.facts.watchItem} · alert ${alertCode(a.number)}`);
  return lines.join("\n");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const safeUrl = (u: string) => (/^https?:\/\//i.test(u) ? esc(u) : "#");

/**
 * The public site's ink and accent (app/globals.css), set like a short letter:
 * no card, pills or tinted boxes. Hierarchy comes from type and space; the
 * one picture is the row of dots.
 */
const C = {
  page: "#FFFFFF",
  ink: "#1a1a2e",
  text: "#3d4656",
  muted: "#5b6577",
  rule: "#E7E3DE",
  cyan: "#0e7490",
  violet: "#6d28d9",
  dotOff: "#E5E7EB",
  dotBefore: "#9AA3B2",
  dotFaint: "#CBD5E1",
  amberInk: "#8A4B00",
  promptBg: "#F8F6F3",
};
const FONT = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

/** "50%" → 0.5. */
const shareOf = (pct: string) => Math.max(0, Math.min(1, (parseFloat(pct) || 0) / 100));

/** Ten dots, filled for "N in 10". Table cells, not images, so it shows with images off. */
function dots(share: number, fill: string, size = 13): string {
  const n = Math.round(share * 10);
  // Under 1 in 10 still shows one faint dot, so "fewer than 1 in 10" isn't drawn as none.
  const shown = share > 0 && n === 0 ? 1 : n;
  const r = size / 2;
  return Array.from(
    { length: 10 },
    (_, i) =>
      `<td style="padding:0 ${i === 4 ? 8 : 3}px 0 0"><div style="width:${size}px;height:${size}px;border-radius:${r}px;background:${i < shown ? (n === 0 ? C.dotFaint : fill) : C.dotOff};font-size:0;line-height:0">&nbsp;</div></td>`
  ).join("");
}

/** Two aligned rows: label, ten dots, "N in 10". The gap after five dots makes counting easy. */
function chart(rows: Array<{ label: string; share: number; fill: string; strong: boolean }>): string {
  const tr = rows
    .map(
      (r) => `<tr>
<td style="padding:5px 12px 5px 0;font-size:13px;line-height:1.3;color:${C.muted};white-space:nowrap;vertical-align:middle">${esc(r.label)}</td>
<td style="padding:5px 0;vertical-align:middle"><table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${dots(r.share, r.fill)}</tr></table></td>
<td style="padding:5px 0 5px 8px;font-size:13px;line-height:1.3;vertical-align:middle;font-variant-numeric:tabular-nums;color:${r.strong ? C.ink : C.muted};${r.strong ? "font-weight:600" : ""}">${esc(plainShare(r.share, false))}</td>
</tr>`
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 6px">${tr}</table>`;
}

/** Per-AI rows when several AIs moved together: name, then "before → now" in words. */
function perAiRows(a: AlertForEmail, labels: [string, string]): string {
  if (a.facts.trigger === "model_switch" || a.facts.perAi.length < 2) return "";
  const rows = a.facts.perAi
    .map(
      (p) => `<tr>
<td style="padding:3px 14px 3px 0;font-size:13px;color:${C.text};white-space:nowrap">${esc(p.ai)}</td>
<td style="padding:3px 0;font-size:13px;color:${C.muted};font-variant-numeric:tabular-nums">${esc(plainShare(shareOf(p.before), false))} <span style="color:${C.dotBefore}">→</span> <span style="color:${C.ink}">${esc(plainShare(shareOf(p.after), false))}</span></td>
</tr>`
    )
    .join("");
  return `<p style="margin:16px 0 4px;font-size:13px;color:${C.muted}">Each AI, ${esc(labels[0])} → ${esc(labels[1])}:</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows}</table>`;
}

const h2 = (text: string) => `<h2 style="margin:28px 0 8px;font-size:15px;line-height:1.4;font-weight:600;color:${C.ink}">${esc(text)}</h2>`;

export function renderHtml(a: AlertForEmail): string {
  const f = a.facts;
  const isSwitch = f.trigger === "model_switch";
  const examples = f.evidence.slice(0, EXAMPLES);
  const quotes = examples
    .map(
      (q) =>
        `<p style="margin:0 0 4px;font-size:15px;line-height:1.6;color:${C.ink}">“${esc(q.quote)}”</p><p style="margin:0 0 16px;font-size:13px;color:${C.muted}">${esc(exampleWho(q.ai))}${
          q.sourceUrl ? `, citing <a href="${safeUrl(q.sourceUrl)}" style="color:${C.cyan};text-decoration:underline;text-underline-offset:2px">${esc(q.sourceTitle || hostOf(q.sourceUrl))}</a>` : ""
        }</p>`
    )
    .join("");
  const before = shareOf(f.finding.before);
  const after = shareOf(f.finding.after);
  // "Nov 9, 2026" → "Nov 9"; two snapshots on one day keep their times ("Nov 9, 4:13 PM").
  const day = (d: string) => d.replace(/, \d{4}.*$/, "");
  const sameDay = day(f.dates.before) === day(f.dates.after);
  const shortDate = (d: string) => (sameDay ? d.replace(/, \d{4}/, "").replace(/ [A-Z]{2,4}T?$/, "") : day(d));
  const labels: [string, string] = isSwitch ? ["Old model", "New model"] : [shortDate(f.dates.before), shortDate(f.dates.after)];
  const kind = isSwitch
    ? `<span style="color:${C.amberInk}">Model change</span>`
    : f.trigger === "event"
      ? "After a news event"
      : "Weekly check";
  const of = isSwitch && f.modelSwitch ? ` from ${esc(f.modelSwitch.ai)}` : "";

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(alertSubject(a))}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:${C.page}">
<div style="display:none;max-height:0;overflow:hidden">${esc(f.plain.headline)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page}"><tr><td align="center" style="padding:28px 20px 36px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:${FONT};-webkit-font-smoothing:antialiased;text-align:left">
<tr><td style="padding:0 0 12px;border-bottom:1px solid ${C.rule}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font-size:15px;font-weight:700;color:${C.ink};letter-spacing:-0.01em">AI <span style="color:${C.cyan}">Topic</span> <span style="color:${C.violet}">Explorer</span></td>
<td align="right" style="font-size:13px;color:${C.muted};font-variant-numeric:tabular-nums">Alert ${esc(alertCode(a.number))}</td>
</tr></table>
</td></tr>
<tr><td style="padding:24px 0 0">
<p style="margin:0 0 8px;font-size:14px;color:${C.muted}">${esc(f.watchItem)} · ${kind}</p>
<h1 style="margin:0 0 ${f.plain.modelNote ? 12 : 22}px;font-size:23px;line-height:1.3;font-weight:700;letter-spacing:-0.015em;color:${C.ink};text-wrap:balance">${esc(f.plain.headline)}</h1>
${f.plain.modelNote ? `<p style="margin:0 0 22px;font-size:15px;line-height:1.55;color:${C.amberInk}">${esc(f.plain.modelNote)}</p>` : ""}
${chart([
  { label: labels[0], share: before, fill: C.dotBefore, strong: false },
  { label: labels[1], share: after, fill: C.cyan, strong: true },
])}
<p style="margin:0;font-size:12px;color:${C.muted}">Each dot is one in ten answers${of}.</p>
${perAiRows(a, labels)}
${h2("What it could mean")}
<p style="margin:0;font-size:16px;line-height:1.6;color:${C.text};text-wrap:pretty">${esc(a.why)}</p>
<p style="margin:12px 0 0;font-size:14px;line-height:1.55;color:${C.muted}">The AIs were asked ${esc(asWho(f.askedAs))}.${f.event ? ` Checked after ${f.event.sourceUrl ? `<a href="${safeUrl(f.event.sourceUrl)}" style="color:${C.cyan};text-underline-offset:2px">${esc(f.event.title)}</a>` : esc(f.event.title)} (${esc(f.event.date)}).` : ""}</p>
${quotes ? `${h2(examples.length > 1 ? "What they said" : "What one said")}${quotes}` : ""}
${h2("Ask Claude about it")}
<p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:${C.muted}">Copy this into Claude:</p>
<div style="background:${C.promptBg};border-radius:8px;padding:14px 16px;font-size:14px;line-height:1.55;color:${C.ink};white-space:pre-wrap">${esc(claudePrompt(a))}</div>
</td></tr>
<tr><td style="padding:28px 0 0">
<div style="border-top:1px solid ${C.rule};padding-top:14px;font-size:12px;line-height:1.6;color:${C.muted};overflow-wrap:anywhere">
${esc(details(a))}${f.alsoChanged.length ? `<br>Also changed: ${esc(f.alsoChanged.join("; "))}.` : ""}
<br><br>AI Topic Explorer is Above's internal topic tracker. Reply to this email to reach Josh.
</div>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

/** "Gemini, Nov 16, 2026" → "Gemini"; "Gemini, old model" stays. */
function exampleWho(ai: string): string {
  return /, (old|new) model$/.test(ai) ? ai : ai.split(",")[0];
}

function hostOf(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
}
