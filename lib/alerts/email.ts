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

/** The public site's palette (app/globals.css), so an alert looks like it came from AI Topic Explorer. */
const C = {
  page: "#F8F6F3",
  card: "#FFFFFF",
  ink: "#1a1a2e",
  text: "#475569",
  muted: "#5b6577",
  line: "#E7E3DE",
  cyan: "#0e7490",
  cyanSoft: "#E6F2F5",
  violet: "#6d28d9",
  violetSoft: "#F0EAFB",
  dotOff: "#E2E8F0",
  dotBefore: "#94A3B8",
  amberSoft: "#FFF6E5",
  amberInk: "#7A4B00",
};
const FONT = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

/** "50%" → 0.5. */
const shareOf = (pct: string) => Math.max(0, Math.min(1, (parseFloat(pct) || 0) / 100));

/**
 * One row of ten dots, filled for "N in 10": the picture of a share.
 * Table cells, not images, so it shows in every client with images off.
 */
function dotRow(label: string, share: number, fill: string, caption: string): string {
  const n = Math.round(share * 10);
  // A share under 1 in 10 still shows as a faint dot, so "fewer than 1 in 10" isn't drawn as none.
  const shown = share > 0 && n === 0 ? 1 : n;
  const dots = Array.from(
    { length: 10 },
    (_, i) =>
      `<td style="padding:0 5px 0 0"><div style="width:16px;height:16px;border-radius:8px;background:${i < shown ? (n === 0 ? "#CBD5E1" : fill) : C.dotOff};font-size:0;line-height:0">&nbsp;</div></td>`
  ).join("");
  return `<div style="padding:6px 0">
<div style="font-size:13px;color:${C.muted};margin:0 0 5px">${esc(label)} · <strong style="color:${C.ink}">${esc(caption)}</strong></div>
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${dots}</tr></table>
</div>`;
}

/** Small before/after bars per AI, when all four moved together. */
function perAiBars(a: AlertForEmail): string {
  if (a.facts.trigger === "model_switch" || a.facts.perAi.length < 2) return "";
  const bar = (share: number, color: string) =>
    `<div style="height:6px;border-radius:3px;background:${C.dotOff};width:100px"><div style="height:6px;border-radius:3px;background:${color};width:${Math.max(share > 0 ? 3 : 0, Math.round(share * 100))}px;font-size:0;line-height:0">&nbsp;</div></div>`;
  const rows = a.facts.perAi
    .map(
      (p) => `<tr>
<td style="padding:4px 12px 4px 0;font-size:13px;color:${C.text};white-space:nowrap">${esc(p.ai)}</td>
<td style="padding:4px 0;width:100px">${bar(shareOf(p.before), C.dotBefore)}<div style="height:3px;font-size:0;line-height:0">&nbsp;</div>${bar(shareOf(p.after), C.cyan)}</td>
<td style="padding:4px 0 4px 10px;font-size:12px;line-height:1.3;color:${C.muted}">${esc(plainShare(shareOf(p.before), false))} → ${esc(plainShare(shareOf(p.after), false))}</td>
</tr>`
    )
    .join("");
  return `<div style="font-size:12px;color:${C.muted};margin:14px 0 4px">By AI <span style="color:${C.dotBefore}">■</span> before <span style="color:${C.cyan}">■</span> now</div>
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows}</table>`;
}

const pill = (text: string, color: string, bg: string) =>
  `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${bg};color:${color};font-size:12px;font-weight:600;margin:0 6px 6px 0">${esc(text)}</span>`;

export function renderHtml(a: AlertForEmail): string {
  const f = a.facts;
  const isSwitch = f.trigger === "model_switch";
  const examples = f.evidence.slice(0, EXAMPLES);
  const quotes = examples
    .map(
      (q) =>
        `<tr><td style="padding:0 0 12px"><div style="border-left:3px solid ${C.cyan};padding:2px 0 2px 12px;color:${C.ink};font-size:15px;line-height:1.55">“${esc(q.quote)}”</div><div style="padding:4px 0 0 15px;font-size:12px;color:${C.muted}">${esc(exampleWho(q.ai))}${
          q.sourceUrl ? ` · <a href="${safeUrl(q.sourceUrl)}" style="color:${C.cyan};text-decoration:underline">${esc(q.sourceTitle || hostOf(q.sourceUrl))}</a>` : ""
        }</div></td></tr>`
    )
    .join("");
  const before = shareOf(f.finding.before);
  const after = shareOf(f.finding.after);
  const shortDate = (d: string) => d.replace(/, \d{4}.*$/, "");
  const labels = isSwitch ? ["Old model", "New model"] : [shortDate(f.dates.before), shortDate(f.dates.after)];
  const tags = [
    pill(f.watchItem, C.cyan, C.cyanSoft),
    isSwitch ? pill("Model change", C.amberInk, C.amberSoft) : f.plain.modelNote ? pill("New model involved", C.amberInk, C.amberSoft) : pill(f.trigger === "event" ? "After a news event" : "Weekly check", C.violet, C.violetSoft),
  ].join("");

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(alertSubject(a))}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:${C.page}">
<div style="display:none;max-height:0;overflow:hidden">${esc(f.plain.headline)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page}"><tr><td align="center" style="padding:20px 8px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;font-family:${FONT};-webkit-font-smoothing:antialiased">
<tr><td style="padding:0 4px 14px">
<span style="font-size:18px;font-weight:700;color:${C.ink};letter-spacing:-0.01em">AI <span style="color:${C.cyan}">Topic</span> <span style="color:${C.violet}">Explorer</span></span>
<span style="float:right;font-size:12px;color:${C.muted};line-height:26px">Alert ${esc(alertCode(a.number))}</span>
</td></tr>
<tr><td style="background:${C.card};border:1px solid ${C.line};border-radius:16px;overflow:hidden">
<div style="height:4px;background:${C.cyan};background-image:linear-gradient(90deg,${C.cyan},${C.violet});font-size:0;line-height:0">&nbsp;</div>
<div style="padding:22px 20px 8px">
<div>${tags}</div>
<h1 style="margin:10px 0 18px;font-size:22px;line-height:1.35;font-weight:700;color:${C.ink};text-wrap:balance">${esc(f.plain.headline)}</h1>
<div style="background:${C.page};border-radius:12px;padding:12px 16px;margin:0 0 18px">
${dotRow(labels[0], before, C.dotBefore, plainShare(before))}
${dotRow(labels[1], after, C.cyan, plainShare(after))}
<div style="font-size:12px;color:${C.muted};margin-top:4px">Each dot is 1 in 10 answers${isSwitch && f.modelSwitch ? ` from ${esc(f.modelSwitch.ai)}` : ""}.</div>
${perAiBars(a)}
</div>
${f.plain.modelNote ? `<div style="background:${C.amberSoft};border-radius:10px;padding:12px 14px;margin:0 0 16px;font-size:15px;line-height:1.5;color:${C.amberInk}"><strong>Why:</strong> ${esc(f.plain.modelNote)}</div>` : ""}
<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:${C.ink}"><strong>What it could mean:</strong> ${esc(a.why)}</p>
<p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:${C.text}">The AIs were asked ${esc(asWho(f.askedAs))}.${f.event ? ` Checked after: ${f.event.sourceUrl ? `<a href="${safeUrl(f.event.sourceUrl)}" style="color:${C.cyan}">${esc(f.event.title)}</a>` : esc(f.event.title)} (${esc(f.event.date)}).` : ""}</p>
${quotes ? `<div style="font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:${C.muted};margin:0 0 10px">For example</div><table role="presentation" cellpadding="0" cellspacing="0" width="100%">${quotes}</table>` : ""}
</div>
<div style="background:${C.cyanSoft};padding:18px 20px 20px;border-top:1px solid ${C.line}">
<div style="font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:${C.cyan};margin:0 0 8px">Ask Claude · copy and paste</div>
<pre style="white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.5;color:${C.ink};background:${C.card};border:1px solid #CFE3E9;border-radius:10px;padding:12px 14px;margin:0">${esc(claudePrompt(a))}</pre>
</div>
</td></tr>
<tr><td style="padding:14px 8px 0;font-size:12px;line-height:1.55;color:${C.muted};overflow-wrap:anywhere">
Details: ${esc(details(a))}${f.alsoChanged.length ? `<br>Also changed: ${esc(f.alsoChanged.join("; "))}.` : ""}
<br><br>Sent by AI Topic Explorer, Above's internal topic tracker. Replies go to Josh.
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
