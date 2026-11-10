/**
 * The monthly report email, written for a general reader (Josh, 2026-11-10:
 * "more high level for average people to understand"). Per topic: where the
 * AIs were asked from, what changed (a few plain sentences), one chart, what
 * stayed on top, what was new, and what happened in the month. No tables,
 * noise bands or internal terms; the numbers behind it are in the database
 * and the connector (5.4).
 *
 * HTML uses table layout, inline styles and inline cid: images so Gmail and
 * Outlook render it the same; a plain-text twin goes with it.
 */
import { CHART_WIDTH, markGroups, type RenderedChart } from "./charts";
import { headlineChanges, newTopics, plainChange, plainMark, steadyLine } from "./plain";
import type { ItemReport, MonthlyReport, TimelineMark } from "./types";

const C = {
  bg: "#f8f6f3",
  card: "#ffffff",
  text: "#1a1a2e",
  secondary: "#475569",
  muted: "#5b6577",
  accent: "#0e7490",
  accentWash: "#e6f3f6",
  sampleBg: "#fef3c7",
  sampleText: "#92400e",
};
const FONT = "font-family:Inter,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const day = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export const NOTHING_CHANGED = "No big changes. The AIs said much the same thing as at the start of the month.";
export const HOW_IT_WORKS =
  "How this works: every week we ask Claude, ChatGPT, Gemini and Grok the same everyday questions about each topic, three times over, the way a regular person in that city would. Answers always shift a little from one try to the next, so we only report changes bigger than that normal shift. We also ask a few new questions each week about what's in the news.";

/** Marks numbered as on the chart, then any outside its range, unnumbered. */
export function numberedMarks(r: ItemReport): { n: number | null; mark: TimelineMark }[] {
  const pts = r.themeSeries.points;
  const groups = markGroups(r.marks, pts[0].at, pts.at(-1)!.at);
  const numbered = groups.flatMap((g, i) => g.marks.map((mark) => ({ n: (i + 1) as number | null, mark })));
  const inChart = new Set(numbered.map((x) => x.mark));
  // The old-vs-new model check is our own bookkeeping; readers only need the model change itself.
  return [...numbered, ...r.marks.filter((m) => !inChart.has(m)).map((mark) => ({ n: null, mark }))].filter((x) => x.mark.kind !== "model_switch");
}

function joinList(xs: string[]): string {
  return xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : (xs[0] ?? "");
}

export function newTopicsLine(r: ItemReport): string | null {
  const topics = newTopics(r);
  return topics.length ? `New questions about what's in the news also brought up ${joinList(topics)}.` : null;
}

// ── HTML ───────────────────────────────────────────────────────────────────

const h3 = (t: string, first = false) => `<h3 style="${FONT}margin:${first ? 0 : 20}px 0 8px;font-size:15px;line-height:1.4;font-weight:600;color:${C.text};">${esc(t)}</h3>`;
const p = (html: string, style = "") => `<p style="${FONT}text-wrap:pretty;margin:0 0 10px;font-size:15px;line-height:1.6;color:${C.secondary};${style}">${html}</p>`;
const img = (c: RenderedChart) =>
  `<img src="cid:${c.cid}" width="${CHART_WIDTH}" alt="${esc(c.alt)}" style="display:block;width:100%;max-width:${CHART_WIDTH}px;height:auto;border:1px solid rgba(0,0,0,0.1);border-radius:8px;margin:12px 0 14px;">`;

function list(items: string[]): string {
  if (!items.length) return "";
  return `<ul style="${FONT}margin:0 0 10px;padding-left:20px;font-size:15px;line-height:1.6;color:${C.text};">${items.map((i) => `<li style="margin:0 0 6px;">${i}</li>`).join("")}</ul>`;
}

function locationPill(line: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 14px;"><tr><td style="${FONT}background:${C.accentWash};color:${C.accent};font-size:13px;font-weight:600;padding:6px 12px;border-radius:999px;">${esc(line)}</td></tr></table>`;
}

function itemHtml(r: ItemReport, chart: RenderedChart): string {
  const changes = headlineChanges(r);
  const steady = steadyLine(r);
  const fresh = newTopicsLine(r);
  const marks = numberedMarks(r);
  return `<tr><td style="background:${C.card};border-radius:12px;padding:24px;">
<h2 style="${FONT}text-wrap:balance;margin:0;font-size:20px;line-height:1.3;font-weight:600;color:${C.text};">${esc(r.watchItem.name)}</h2>
${locationPill(r.locationLine)}
${h3("What changed", true)}
${changes.length ? list(changes.map((w) => esc(plainChange(w)))) : p(esc(NOTHING_CHANGED), `color:${C.text};`)}
${img(chart)}
${steady ? p(esc(steady)) : ""}
${fresh ? p(esc(fresh)) : ""}
${r.alerts.length ? `${h3("Alerts this month")}${list(r.alerts.map((a) => `A-${a.number}, ${day(a.createdAt)}: ${esc(a.subject)}`))}${r.alerts.every((a) => a.status === "suppressed") ? p("Alerts weren't being emailed yet, so these were recorded but not sent.", `color:${C.muted};font-size:13px;`) : ""}` : ""}
${marks.length ? `${h3("What happened this month")}${list(marks.map(({ n, mark }) => `${n != null ? `<strong style="color:${C.accent};">${n}</strong>&nbsp; ` : ""}${day(mark.at)}: ${esc(plainMark(mark))}`))}` : ""}
</td></tr>
<tr><td style="height:16px;line-height:16px;font-size:0;">&nbsp;</td></tr>`;
}

export function renderHtml(report: MonthlyReport, charts: { trend: RenderedChart }[]): string {
  const title = `What AI is saying: ${report.month.label}`;
  const sampleBanner = report.sample
    ? `<tr><td style="${FONT}background:${C.sampleBg};color:${C.sampleText};font-size:14px;font-weight:600;padding:12px 16px;border-radius:10px;">SAMPLE DATA. Every number in this report is made up, to test how the report looks. Nothing here describes real AI answers.</td></tr><tr><td style="height:16px;font-size:0;">&nbsp;</td></tr>`
    : "";
  const skipped = report.skipped.length ? p(`Not in this report yet: ${esc(joinList(report.skipped.map((s) => s.name)))} (not enough weeks of answers so far).`, `color:${C.muted};font-size:13px;`) : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:648px;">
${sampleBanner}
<tr><td style="padding:0 4px 16px;">
<div style="${FONT}font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${C.accent};">AI Topic Explorer · Monthly report</div>
<h1 style="${FONT}text-wrap:balance;margin:4px 0 0;font-size:26px;line-height:1.25;font-weight:600;color:${C.text};">What AI is saying: ${esc(report.month.label)}${report.sample ? " (sample)" : ""}</h1>
</td></tr>
<tr><td style="background:${C.card};border-radius:12px;padding:24px;">
${h3("The short version", true)}
${p(esc(report.summary.text), `color:${C.text};`)}
${skipped}
</td></tr>
<tr><td style="height:16px;font-size:0;">&nbsp;</td></tr>
${report.items.map((r, i) => itemHtml(r, charts[i].trend)).join("\n")}
<tr><td style="padding:4px 4px 24px;">
${p(esc(HOW_IT_WORKS), `color:${C.muted};font-size:12px;line-height:1.5;`)}
</td></tr>
</table></td></tr></table></body></html>`;
}

// ── Plain text ─────────────────────────────────────────────────────────────

export function renderText(report: MonthlyReport): string {
  const out: string[] = [];
  if (report.sample) out.push("SAMPLE DATA: every number in this report is made up.", "");
  out.push(`What AI is saying: ${report.month.label}`, "", report.summary.text);
  if (report.skipped.length) out.push("", `Not in this report yet: ${joinList(report.skipped.map((s) => s.name))} (not enough weeks of answers so far).`);
  for (const r of report.items) {
    out.push("", `== ${r.watchItem.name} ==`, r.locationLine, "", "What changed:");
    const changes = headlineChanges(r);
    out.push(...(changes.length ? changes.map((w) => `- ${plainChange(w)}`) : [`- ${NOTHING_CHANGED}`]));
    const steady = steadyLine(r);
    if (steady) out.push("", steady);
    const fresh = newTopicsLine(r);
    if (fresh) out.push(fresh);
    const marks = numberedMarks(r);
    if (r.alerts.length) out.push("", "Alerts this month:", ...r.alerts.map((a) => `- A-${a.number}, ${day(a.createdAt)}: ${a.subject}${a.status === "suppressed" ? " (recorded, not emailed)" : ""}`));
    if (marks.length) out.push("", "What happened this month:", ...marks.map(({ mark }) => `- ${day(mark.at)}: ${plainMark(mark)}`));
  }
  out.push("", HOW_IT_WORKS);
  return out.join("\n");
}
