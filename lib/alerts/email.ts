/**
 * The alert email (task 5.2), written for anyone to read in a few seconds:
 * one plain sentence saying what changed, one on what it could mean, how the
 * AIs were asked, a couple of examples, and a ready-made Claude prompt. The
 * percentages and the "bigger than chance" test sit in a small details line
 * at the bottom. Plain text plus simple inline-styled HTML (Outlook, Gmail).
 */
import type { AlertFacts } from "./facts";

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

export function renderHtml(a: AlertForEmail): string {
  const ink = "#1a1a1a";
  const muted = "#5f6368";
  const rule = "#e3e3e3";
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
  const examples = a.facts.evidence.slice(0, EXAMPLES);
  const quotes = examples
    .map(
      (q) =>
        `<p style="margin:0 0 10px;padding:0 0 0 12px;border-left:3px solid ${rule}">“${esc(q.quote)}”<br><span style="font-size:13px;color:${muted}">${esc(exampleWho(q.ai))}${
          q.sourceUrl ? ` · <a href="${safeUrl(q.sourceUrl)}" style="color:${muted}">${esc(q.sourceTitle || hostOf(q.sourceUrl))}</a>` : ""
        }</span></p>`
    )
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(alertSubject(a))}</title></head><body style="margin:0;padding:0;background:#f6f6f4">
<div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:${font};font-size:16px;line-height:1.55;color:${ink};-webkit-font-smoothing:antialiased;text-wrap:pretty">
<div style="font-size:13px;color:${muted};margin-bottom:8px">AI Topic Explorer · ${esc(a.facts.watchItem)}</div>
<div style="background:#fff;border:1px solid ${rule};border-radius:12px;padding:24px">
<h1 style="font-size:21px;line-height:1.35;margin:0 0 16px;font-weight:600;text-wrap:balance">${esc(a.facts.plain.headline)}</h1>
${a.facts.plain.modelNote ? `<p style="margin:0 0 16px;background:#fff6e5;border-radius:8px;padding:10px 12px;font-size:15px"><strong>Why:</strong> ${esc(a.facts.plain.modelNote)}</p>` : ""}
<p style="margin:0 0 16px"><strong>What it could mean:</strong> ${esc(a.why)}</p>
<p style="margin:0 0 20px;font-size:15px;color:${muted}">The AIs were asked ${esc(asWho(a.facts.askedAs))}.${a.facts.event ? ` Checked after: ${a.facts.event.sourceUrl ? `<a href="${safeUrl(a.facts.event.sourceUrl)}" style="color:${muted}">${esc(a.facts.event.title)}</a>` : esc(a.facts.event.title)} (${esc(a.facts.event.date)}).` : ""}</p>
${quotes ? `<div style="font-size:13px;color:${muted};margin:0 0 8px">For example</div>${quotes}` : ""}
<div style="border-top:1px solid ${rule};padding-top:16px;margin-top:20px">
<div style="font-size:13px;color:${muted};margin:0 0 8px">Ask Claude (copy and paste)</div>
<pre style="white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.5;background:#f6f6f4;border-radius:8px;padding:12px;margin:0">${esc(claudePrompt(a))}</pre>
</div>
</div>
<p style="font-size:12px;line-height:1.5;color:${muted};margin:12px 4px 0">Details: ${esc(details(a))}${a.facts.alsoChanged.length ? `<br>Also changed: ${esc(a.facts.alsoChanged.join("; "))}.` : ""}<br>Alert ${esc(alertCode(a.number))} from AI Topic Explorer, Above's internal topic tracker. Replies go to Josh.</p>
</div></body></html>`;
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
