/**
 * The alert email (task 5.2): one finding, its summary, the evidence, how
 * the AIs were asked, and a ready-made Claude prompt. Plain text plus simple
 * inline-styled HTML that renders the same in Outlook and Gmail.
 */
import type { AlertFacts } from "./facts";

export const alertCode = (number: number) => `A-${number}`;

export interface AlertForEmail {
  number: number;
  facts: AlertFacts;
  summary: string;
  why: string;
}

export function alertSubject(a: { number: number; facts: AlertFacts }): string {
  const f = a.facts.finding;
  const tag = a.facts.trigger === "model_switch" ? "Model change" : a.facts.modelCaveat ? "Change (model may explain it)" : "Change";
  const what =
    f.direction === "new"
      ? `${cap(f.label)} newly shows up`
      : f.direction === "gone"
        ? `${cap(f.label)} drops out`
        : `${cap(f.label)} ${f.direction === "rose" ? "up" : "down"} ${f.before} → ${f.after}`;
  return `${alertCode(a.number)} · ${a.facts.watchItem}: ${what} (${tag})`;
}

/** Capitalized for a heading; domains ("reddit.com") stay as written. */
const cap = (s: string) => (!s || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : s[0].toUpperCase() + s.slice(1));

/**
 * The prompt to paste into Claude. With the AI Topic Explorer connector
 * (task 5.4) the first line is enough; without it, the context below lets
 * Claude still help.
 */
export function claudePrompt(a: AlertForEmail): string {
  const f = a.facts.finding;
  const code = alertCode(a.number);
  return [
    `Using AI Topic Explorer, explain alert ${code}: what changed, what might explain it, and what I could check next.`,
    "",
    `If the AI Topic Explorer connector isn't available, use this context from the alert:`,
    `- Watch item: ${a.facts.watchItem} (${a.facts.askedAs}).`,
    `- Compared: ${a.facts.comparedAs}.`,
    `- Finding (${f.kind}): ${f.label}, ${f.who}: ${f.before} of answers before, ${f.after} after.`,
    ...(a.facts.modelCaveat ? [`- Note: ${a.facts.modelCaveat}`] : []),
    ...(a.facts.event ? [`- The snapshot ran after: ${a.facts.event.title} (${a.facts.event.date}).`] : []),
    `- Summary: ${a.summary} ${a.why}`,
  ].join("\n");
}

export function renderText(a: AlertForEmail): string {
  const f = a.facts.finding;
  const lines = [
    alertSubject(a),
    "",
    a.summary,
    "",
    `Why it might matter: ${a.why}`,
    "",
    `HOW THE AIS WERE ASKED: ${a.facts.askedAs}.`,
    "",
    "EVIDENCE",
    `${cap(f.kind)}: ${f.label}`,
    `${cap(f.who)}: ${f.before} of answers (${f.answersBefore}) → ${f.after} (${f.answersAfter}), ${a.facts.dates.before} → ${a.facts.dates.after}.`,
    `Moved ${f.moved}; the usual wobble between repeated asks is about ${f.usualWobble}.`,
    ...(a.facts.perAi.length ? ["By AI: " + a.facts.perAi.map((p) => `${p.ai} ${p.before} → ${p.after}${p.pastOwnBand ? " *" : ""}`).join("; ")] : []),
    ...(a.facts.perAi.some((p) => p.pastOwnBand) ? ["* moved past that AI's own usual wobble"] : []),
    ...(a.facts.modelCaveat ? ["", `NOTE: ${a.facts.modelCaveat}`] : []),
    ...(a.facts.event ? ["", `Snapshot ran after: ${a.facts.event.title} (${a.facts.event.date})${a.facts.event.sourceUrl ? ` ${a.facts.event.sourceUrl}` : ""}`] : []),
  ];
  if (a.facts.evidence.length) {
    lines.push("", "What the AIs said:");
    for (const q of a.facts.evidence) {
      lines.push(`- "${q.quote}" (${q.ai}, question ${q.question}${q.sourceUrl ? `; source: ${q.sourceTitle ? `${q.sourceTitle}, ` : ""}${q.sourceUrl}` : ""})`);
    }
  }
  lines.push("", "ASK CLAUDE (copy and paste):", claudePrompt(a));
  if (a.facts.alsoChanged.length) lines.push("", `Also changed this snapshot (no alert of their own): ${a.facts.alsoChanged.join("; ")}.`);
  lines.push("", `AI Topic Explorer · alert ${alertCode(a.number)} · ${a.facts.watchItem}`);
  return lines.join("\n");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const safeUrl = (u: string) => (/^https?:\/\//i.test(u) ? esc(u) : "#");

export function renderHtml(a: AlertForEmail): string {
  const f = a.facts.finding;
  const ink = "#1a1a1a";
  const muted = "#5f6368";
  const rule = "#e3e3e3";
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
  const label = (t: string) => `<div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${muted};margin:0 0 6px">${esc(t)}</div>`;
  const tag = { model_switch: "Model change", event: "Event snapshot", weekly: "Weekly snapshot", manual: "Snapshot" }[a.facts.trigger];

  const perAi = a.facts.perAi.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:12px 0 0;font-size:14px">${a.facts.perAi
        .map(
          (p) =>
            `<tr><td style="padding:3px 16px 3px 0;color:${muted}">${esc(p.ai)}</td><td style="padding:3px 0;font-variant-numeric:tabular-nums">${esc(p.before)} → ${esc(p.after)}${p.pastOwnBand ? ` <span style="color:${muted}">(past its own wobble)</span>` : ""}</td></tr>`
        )
        .join("")}</table>`
    : "";

  const quotes = a.facts.evidence
    .map(
      (q) =>
        `<blockquote style="margin:12px 0 0;padding:0 0 0 12px;border-left:3px solid ${rule};color:${ink}">“${esc(q.quote)}”<div style="font-size:13px;color:${muted};margin-top:4px">${esc(q.ai)}, question ${esc(q.question)}${
          q.sourceUrl ? ` · <a href="${safeUrl(q.sourceUrl)}" style="color:${muted}">${esc(q.sourceTitle || hostOf(q.sourceUrl))}</a>` : ""
        }</div></blockquote>`
    )
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(alertSubject(a))}</title></head><body style="margin:0;padding:0;background:#f6f6f4">
<div style="max-width:600px;margin:0 auto;padding:24px 16px;font-family:${font};font-size:15px;line-height:1.55;color:${ink};-webkit-font-smoothing:antialiased;text-wrap:pretty">
<div style="font-size:13px;color:${muted};margin-bottom:8px">AI Topic Explorer · ${esc(tag)} · Alert ${esc(alertCode(a.number))}</div>
<div style="background:#fff;border:1px solid ${rule};border-radius:12px;padding:24px">
<h1 style="font-size:20px;line-height:1.3;margin:0 0 4px;font-weight:600;text-wrap:balance;font-variant-numeric:tabular-nums">${esc(cap(f.label))}: ${esc(f.before)} → ${esc(f.after)} of answers</h1>
<div style="font-size:14px;color:${muted};margin:0 0 16px">${esc(a.facts.watchItem)} · ${esc(f.who)} · ${esc(a.facts.dates.before)} → ${esc(a.facts.dates.after)}</div>
<div style="background:#eef4ff;border-radius:8px;padding:10px 12px;margin:0 0 16px;font-size:14px"><strong>How the AIs were asked:</strong> ${esc(a.facts.askedAs)}.</div>
${a.facts.modelCaveat ? `<div style="background:#fff6e5;border-radius:8px;padding:10px 12px;margin:0 0 16px;font-size:14px"><strong>${a.facts.trigger === "model_switch" ? "Model change, not real-world change." : "A model change may explain part of this."}</strong> ${esc(a.facts.modelCaveat)}</div>` : ""}
<p style="margin:0 0 12px">${esc(a.summary)}</p>
<p style="margin:0 0 20px"><strong>Why it might matter:</strong> ${esc(a.why)}</p>
<div style="border-top:1px solid ${rule};padding-top:16px;margin-top:4px">
${label("Evidence")}
<div style="font-size:14px">${esc(cap(f.kind))}: <strong>${esc(f.label)}</strong><br>${esc(cap(f.who))}: ${esc(f.before)} (${esc(f.answersBefore)}) → ${esc(f.after)} (${esc(f.answersAfter)}). Moved ${esc(f.moved)}; the usual wobble between repeated asks is about ${esc(f.usualWobble)}.</div>
${perAi}
${a.facts.event ? `<div style="font-size:14px;margin-top:12px">Snapshot ran after: ${a.facts.event.sourceUrl ? `<a href="${safeUrl(a.facts.event.sourceUrl)}" style="color:${ink}">${esc(a.facts.event.title)}</a>` : esc(a.facts.event.title)} (${esc(a.facts.event.date)})</div>` : ""}
${quotes}
</div>
<div style="border-top:1px solid ${rule};padding-top:16px;margin-top:20px">
${label("Ask Claude (copy and paste)")}
<pre style="white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.5;background:#f6f6f4;border-radius:8px;padding:12px;margin:0">${esc(claudePrompt(a))}</pre>
</div>
${a.facts.alsoChanged.length ? `<div style="border-top:1px solid ${rule};padding-top:16px;margin-top:20px;font-size:13px;color:${muted}"><strong style="color:${ink}">Also changed this snapshot</strong> (no alert of their own): ${esc(a.facts.alsoChanged.join("; "))}.</div>` : ""}
</div>
<div style="font-size:12px;color:${muted};margin-top:12px">Sent by AI Topic Explorer, Above's internal topic tracker. Replies go to Josh.</div>
</div></body></html>`;
}

function hostOf(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
}
