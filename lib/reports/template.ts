/**
 * The monthly report email: HTML (table layout, inline styles, inline cid:
 * images, so Gmail and Outlook render it the same) and a plain-text twin.
 */
import { providerLabel } from "@/lib/providers";
import type { Swing } from "@/lib/snapshots";
import { CHART_WIDTH, markGroups, type RenderedChart } from "./charts";
import { describeFinding } from "./summary";
import type { FindingRow, ItemReport, MonthlyReport, TimelineMark } from "./types";

const C = {
  bg: "#f8f6f3",
  card: "#ffffff",
  text: "#1a1a2e",
  secondary: "#475569",
  muted: "#5b6577",
  rule: "#e7e5e0",
  accent: "#0e7490",
  accentWash: "#e6f3f6",
  sampleBg: "#fef3c7",
  sampleText: "#92400e",
};
const FONT = "font-family:Inter,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pct = (x: number) => `${Math.round(x * 100)}%`;
const day = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const scopeName = (s: Swing["scope"]) => (s === "all" ? "all AIs" : providerLabel(s));

export function changeSentence(w: Swing): string {
  const verb = w.kind === "new" ? "appeared" : w.kind === "gone" ? "dropped out" : w.after > w.before ? "rose" : "fell";
  const what = describeFinding(w);
  return `${what.charAt(0).toUpperCase()}${what.slice(1)} ${verb}: ${pct(w.before)} → ${pct(w.after)} of answers (${scopeName(w.scope)}; band ±${Math.round(w.threshold * 100)} pts)`;
}

function snapshotLine(r: ItemReport): string {
  const weekly = r.snapshots.filter((s) => s.kind === "weekly").length;
  const event = r.snapshots.length - weekly;
  const parts = [`${weekly} weekly snapshot${weekly === 1 ? "" : "s"}`, ...(event ? [`${event} event snapshot${event === 1 ? "" : "s"}`] : [])];
  return `${parts.join(" and ")}. Compared ${day(r.startAt)}${r.startIsBaseline ? " (last month's final snapshot)" : ""} with ${day(r.endAt)} on ${r.questionsCompared} locked questions.`;
}

/** Marks numbered as on the chart, then any outside its range, unnumbered. */
export function numberedMarks(r: ItemReport): { n: number | null; mark: TimelineMark }[] {
  const pts = r.themeSeries.points;
  const groups = markGroups(r.marks, pts[0].at, pts.at(-1)!.at);
  const numbered = groups.flatMap((g, i) => g.marks.map((mark) => ({ n: i + 1 as number | null, mark })));
  const inChart = new Set(numbered.map((x) => x.mark));
  return [...numbered, ...r.marks.filter((m) => !inChart.has(m)).map((mark) => ({ n: null, mark }))];
}

const markKind: Record<TimelineMark["kind"], string> = { new_model: "Model change", model_switch: "Model check", event: "Event" };

// ── HTML ───────────────────────────────────────────────────────────────────

const h2 = (t: string) => `<h2 style="${FONT}text-wrap:balance;margin:0 0 4px;font-size:20px;line-height:1.3;font-weight:600;color:${C.text};">${esc(t)}</h2>`;
const h3 = (t: string) => `<h3 style="${FONT}margin:24px 0 8px;font-size:15px;line-height:1.4;font-weight:600;color:${C.text};">${esc(t)}</h3>`;
const p = (html: string, style = "") => `<p style="${FONT}text-wrap:pretty;margin:0 0 10px;font-size:14px;line-height:1.55;color:${C.secondary};${style}">${html}</p>`;
const img = (c: RenderedChart) =>
  `<img src="cid:${c.cid}" width="${CHART_WIDTH}" alt="${esc(c.alt)}" style="display:block;width:100%;max-width:${CHART_WIDTH}px;height:auto;border:1px solid rgba(0,0,0,0.1);border-radius:8px;margin:8px 0 12px;">`;

function list(items: string[]): string {
  if (!items.length) return "";
  return `<ul style="${FONT}margin:0 0 10px;padding-left:20px;font-size:14px;line-height:1.55;color:${C.secondary};">${items.map((i) => `<li style="margin:0 0 4px;">${i}</li>`).join("")}</ul>`;
}

function findingTable(title: string, rows: FindingRow[]): string {
  if (!rows.length) return "";
  const cell = `${FONT}font-size:13px;line-height:1.4;padding:5px 0;border-top:1px solid ${C.rule};`;
  const body = rows
    .map(
      (r) => `<tr>
  <td style="${cell}color:${C.text};">${esc(r.label)}</td>
  <td align="right" style="${cell}color:${C.muted};white-space:nowrap;font-variant-numeric:tabular-nums;">${pct(r.start)} → <span style="color:${C.text};${r.real ? "font-weight:600;" : ""}">${pct(r.end)}</span>${r.real ? ` <span style="color:${C.accent};font-weight:600;">real</span>` : ""}</td>
</tr>`
    )
    .join("");
  return `<td valign="top" width="50%" style="padding:0 12px 0 0;">
<div style="${FONT}font-size:12px;font-weight:600;letter-spacing:.02em;text-transform:uppercase;color:${C.muted};margin:0 0 4px;">${esc(title)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${body}</table></td>`;
}

function pairTables(a: [string, FindingRow[]], b: [string, FindingRow[]]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:4px 0 8px;"><tr>${findingTable(...a)}${findingTable(...b)}</tr></table>`;
}

function locationPill(line: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 12px;"><tr><td style="${FONT}background:${C.accentWash};color:${C.accent};font-size:13px;font-weight:600;padding:6px 12px;border-radius:999px;">${esc(line)}</td></tr></table>`;
}

function itemHtml(r: ItemReport, charts: { trend: RenderedChart; citations: RenderedChart }): string {
  const depth = r.depthChanges.length
    ? list(r.depthChanges.slice(0, 8).map((w) => esc(changeSentence(w))))
    : p(`Nothing moved beyond the noise band. Bands at month end: entities ±${Math.round((r.band.entity ?? 0) * 100)}, themes ±${Math.round((r.band.theme ?? 0) * 100)}, tone ±${Math.round((r.band.tone ?? 0) * 100)} points.`);

  const fresh = r.breadth;
  const breadthIntro = fresh.freshAnswers
    ? `${fresh.freshQuestions} fresh questions (${fresh.freshAnswers} answers) this month. Of what they named, ${[
        fresh.newShare.entity != null ? `${pct(fresh.newShare.entity)} of names` : null,
        fresh.newShare.theme != null ? `${pct(fresh.newShare.theme)} of themes` : null,
        fresh.newShare.domain != null ? `${pct(fresh.newShare.domain)} of sources` : null,
      ]
        .filter(Boolean)
        .join(", ")} never came up in the locked questions.`
    : "No fresh questions were answered this month.";
  const breadthItems = [
    ...fresh.rows.theme.map((b) => `Theme <strong style="color:${C.text};">${esc(b.label)}</strong>: ${b.count} answers`),
    ...fresh.rows.entity.map((b) => `Named <strong style="color:${C.text};">${esc(b.label)}</strong>: ${b.count} answers`),
    ...fresh.rows.domain.map((b) => `Cited <strong style="color:${C.text};">${esc(b.label)}</strong>: ${b.count} answers`),
  ].slice(0, 8);

  const citations = r.citationChanges.length
    ? list(r.citationChanges.slice(0, 8).map((w) => esc(changeSentence(w))))
    : p("No source rose or fell beyond the noise band, across all AIs or for any one AI.");
  const perAi = Object.entries(r.topDomainsByAi)
    .map(([ai, rows]) => `<strong style="color:${C.text};">${esc(providerLabel(ai))}</strong>: ${rows!.map((d) => `${esc(d.label)} ${pct(d.start)} → ${pct(d.end)}${d.real ? " (real)" : ""}`).join(", ")}`);

  const marks = numberedMarks(r);
  const timeline = marks.length
    ? list(marks.map(({ n, mark }) => `${n != null ? `<strong style="color:${C.accent};">${n}</strong> ` : ""}${day(mark.at)}, ${markKind[mark.kind]}: ${esc(mark.label)}${mark.sourceUrl ? ` (<a href="${esc(mark.sourceUrl)}" style="color:${C.accent};">source</a>)` : ""}`))
    : p("No model changes or events this month.");

  return `<tr><td style="background:${C.card};border-radius:12px;padding:24px;">
${h2(r.watchItem.name)}
${locationPill(r.locationLine)}
${p(esc(snapshotLine(r)), `color:${C.muted};font-size:13px;`)}
${h3("Depth: the locked questions")}
${depth}
${img(charts.trend)}
${pairTables(["Themes", r.top.theme], ["Names", r.top.entity])}
${pairTables(["Tone", r.top.tone], ["Arguments", r.top.side])}
${h3("Breadth: what the fresh questions surfaced")}
${p(esc(breadthIntro))}
${list(breadthItems)}
${h3("Citation shifts")}
${citations}
${img(charts.citations)}
${p("Top sources per AI at month end:", `color:${C.muted};font-size:13px;margin-bottom:4px;`)}
${list(perAi)}
${h3("Model changes and events")}
${timeline}
</td></tr>
<tr><td style="height:16px;line-height:16px;font-size:0;">&nbsp;</td></tr>`;
}

export function renderHtml(report: MonthlyReport, charts: { trend: RenderedChart; citations: RenderedChart }[]): string {
  const title = `AI Topic Explorer: ${report.month.label} health report`;
  const sampleBanner = report.sample
    ? `<tr><td style="${FONT}background:${C.sampleBg};color:${C.sampleText};font-size:14px;font-weight:600;padding:12px 16px;border-radius:10px;">SAMPLE DATA. Every number in this report is synthetic, made to test the report's layout and math. Nothing here describes real AI answers.</td></tr><tr><td style="height:16px;font-size:0;">&nbsp;</td></tr>`
    : "";
  const skipped = report.skipped.length
    ? p(`Not in this report: ${report.skipped.map((s) => `${esc(s.name)} (${esc(s.reason)})`).join("; ")}.`, `color:${C.muted};font-size:13px;`)
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:648px;">
${sampleBanner}
<tr><td style="padding:0 4px 16px;">
<div style="${FONT}font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${C.accent};">AI Topic Explorer · Monthly health report</div>
<h1 style="${FONT}text-wrap:balance;margin:4px 0 0;font-size:26px;line-height:1.25;font-weight:600;color:${C.text};">${esc(report.month.label)}${report.sample ? " (sample)" : ""}</h1>
</td></tr>
<tr><td style="background:${C.card};border-radius:12px;padding:24px;">
${h3("The month in brief").replace("margin:24px", "margin:0")}
${p(esc(report.summary.text), `color:${C.text};font-size:15px;`)}
${p(`How the AIs were asked: ${report.items.map((r) => `<strong style="color:${C.text};">${esc(r.watchItem.name)}</strong>, ${esc(r.locationLine.replace(/^Asked as/, "as"))}`).join("; ")}.`, `font-size:13px;`)}
${p("Alerts this month: alerts aren't switched on yet, so none are listed.", `color:${C.muted};font-size:13px;`)}
${skipped}
</td></tr>
<tr><td style="height:16px;font-size:0;">&nbsp;</td></tr>
${report.items.map((r, i) => itemHtml(r, charts[i])).join("\n")}
<tr><td style="padding:4px 4px 24px;">
${p(`How to read this: each week the four AIs answer the same locked questions three times. How much the answers wobble between those repeats sets a noise band, and only a change bigger than that band is called real. Fresh questions are new each snapshot and show what's current. Percentages are shares of answers.${report.summary.source === "fallback" ? " Summary written from the numbers by code." : " Summary written by AI from the numbers above."}`, `color:${C.muted};font-size:12px;`)}
</td></tr>
</table></td></tr></table></body></html>`;
}

// ── Plain text ─────────────────────────────────────────────────────────────

export function renderText(report: MonthlyReport): string {
  const out: string[] = [];
  if (report.sample) out.push("SAMPLE DATA: every number in this report is synthetic.", "");
  out.push(`AI Topic Explorer: ${report.month.label} health report`, "", report.summary.text, "");
  out.push("Alerts this month: alerts aren't switched on yet, so none are listed.", "");
  for (const s of report.skipped) out.push(`Not in this report: ${s.name} (${s.reason})`);
  for (const r of report.items) {
    out.push("", `== ${r.watchItem.name} ==`, r.locationLine, snapshotLine(r), "", "Depth (locked questions):");
    out.push(...(r.depthChanges.length ? r.depthChanges.slice(0, 8).map((w) => `- ${changeSentence(w)}`) : ["- Nothing moved beyond the noise band."]));
    out.push("Top themes: " + r.top.theme.map((t) => `${t.label} ${pct(t.start)}→${pct(t.end)}${t.real ? " (real)" : ""}`).join(", "));
    out.push("Top names: " + r.top.entity.map((t) => `${t.label} ${pct(t.start)}→${pct(t.end)}${t.real ? " (real)" : ""}`).join(", "));
    out.push("", `Breadth: ${r.breadth.freshQuestions} fresh questions, ${r.breadth.freshAnswers} answers. Not in the locked answers:`);
    for (const b of [...r.breadth.rows.theme, ...r.breadth.rows.entity, ...r.breadth.rows.domain].slice(0, 8)) out.push(`- ${b.label}: ${b.count} answers`);
    out.push("", "Citation shifts:");
    out.push(...(r.citationChanges.length ? r.citationChanges.slice(0, 8).map((w) => `- ${changeSentence(w)}`) : ["- None beyond the noise band."]));
    out.push("Top sources: " + r.top.domain.map((d) => `${d.label} ${pct(d.start)}→${pct(d.end)}${d.real ? " (real)" : ""}`).join(", "));
    out.push("", "Model changes and events:");
    const marks = numberedMarks(r);
    out.push(...(marks.length ? marks.map(({ mark }) => `- ${day(mark.at)}, ${markKind[mark.kind]}: ${mark.label}`) : ["- None."]));
  }
  return out.join("\n");
}
