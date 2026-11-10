/**
 * Charts for the monthly report email: SVG drawn here, rendered to PNG with
 * resvg, attached inline (cid:) so Gmail and Outlook show them with no
 * JavaScript and no remote images. Light mode only: email clients don't
 * give images a dark-mode variant we can trust.
 *
 * Design (dataviz skill): one axis, 2px lines, ≥8px end dots with a 2px
 * surface ring, hairline solid grid, text in text colors (never the series
 * color), a legend for every multi-series chart plus direct end labels. One
 * chart per item keeps the email light and easy to read. Series colors are the
 * validated categorical order, assigned by fixed slot, never by rank.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import type { ItemReport, TimelineMark } from "./types";

export const CHART_WIDTH = 600;
/** Rendered at 2x for sharp text on retina screens; shown at CHART_WIDTH. */
const SCALE = 2;

export const COLORS = {
  surface: "#ffffff",
  text: "#1a1a2e",
  textSecondary: "#475569",
  textMuted: "#5b6577",
  grid: "#e7e5e0",
  axis: "#cfccc6",
  /** Categorical slots 1–4 (validated order: blue, orange, aqua, yellow). */
  series: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"],
  /** Above accent (the site's cyan) for marks on the timeline. */
  accent: "#0e7490",
};

const FONT_DIR = path.join(process.cwd(), "lib", "reports", "fonts");
let fontFiles: string[] | null = null;
function fonts(): string[] {
  return (fontFiles ??= ["Inter_400Regular.ttf", "Inter_600SemiBold.ttf"].map((f) => path.join(FONT_DIR, f)));
}

export function svgToPng(svg: string): Buffer {
  // Fail early with a clear message if the fonts aren't where we expect (resvg would silently draw no text).
  for (const f of fonts()) if (!existsSync(f)) throw new Error(`Report font missing: ${f}`);
  const r = new Resvg(svg, {
    fitTo: { mode: "zoom", value: SCALE },
    font: { fontFiles: fonts(), loadSystemFonts: false, defaultFontFamily: "Inter" },
    background: COLORS.surface,
  });
  return r.render().asPng();
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pct = (x: number) => `${Math.round(x * 100)}%`;
const shortDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Rough Inter width at a size, for keeping labels inside the chart. */
export function textWidth(s: string, size: number): number {
  return s.length * size * 0.56;
}

function truncate(s: string, size: number, max: number): string {
  if (textWidth(s, size) <= max) return s;
  let out = s;
  while (out.length > 1 && textWidth(`${out}…`, size) > max) out = out.slice(0, -1);
  return `${out.trimEnd()}…`;
}

function niceMax(x: number): number {
  for (const step of [0.2, 0.4, 0.5, 0.6, 0.8, 1]) if (x <= step) return step;
  return 1;
}

function svgDoc(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Inter">
<rect width="${width}" height="${height}" fill="${COLORS.surface}"/>
${body}
</svg>`;
}

function sampleStamp(width: number, sample: boolean): string {
  return sample ? `<text x="${width - 12}" y="18" text-anchor="end" font-size="11" font-weight="600" fill="#b45309">SAMPLE DATA</text>` : "";
}

/**
 * Depth chart: the month's top themes, share of locked answers at each
 * snapshot, with model changes and events marked on the timeline.
 */
export function themeTrendSvg(report: ItemReport, sample = false): string {
  const { keys, labels, points } = report.themeSeries;
  const W = CHART_WIDTH;
  const legendRows = Math.ceil(keys.length / 2);
  const top = 30 + legendRows * 20 + 14;
  const plotH = 170;
  const H = top + plotH + 40;
  const left = 44;
  const right = W - 168;
  const t0 = points[0].at.getTime();
  const t1 = Math.max(points.at(-1)!.at.getTime(), t0 + 1);
  const x = (d: Date) => left + ((d.getTime() - t0) / (t1 - t0)) * (right - left);
  const maxShare = niceMax(Math.max(0.2, ...points.flatMap((p) => keys.map((k) => p.shares[k] ?? 0))));
  const y = (s: number) => top + plotH - (s / maxShare) * plotH;

  const parts: string[] = [];
  parts.push(`<text x="12" y="20" font-size="13" font-weight="600" fill="${COLORS.text}">What the AIs talk about most</text>`);
  parts.push(sampleStamp(W, sample));
  // Legend, two per row.
  keys.forEach((k, i) => {
    const lx = 12 + (i % 2) * 290;
    const ly = 40 + Math.floor(i / 2) * 20;
    parts.push(`<line x1="${lx}" y1="${ly - 4}" x2="${lx + 16}" y2="${ly - 4}" stroke="${COLORS.series[i]}" stroke-width="2" stroke-linecap="round"/>`);
    parts.push(`<circle cx="${lx + 8}" cy="${ly - 4}" r="3.5" fill="${COLORS.series[i]}"/>`);
    parts.push(`<text x="${lx + 22}" y="${ly}" font-size="12" fill="${COLORS.textSecondary}">${esc(truncate(labels[k] ?? k, 12, 255))}</text>`);
  });
  // Grid and y ticks.
  for (let s = 0; s <= maxShare + 1e-9; s += maxShare / 4) {
    parts.push(`<line x1="${left}" x2="${right}" y1="${y(s)}" y2="${y(s)}" stroke="${s === 0 ? COLORS.axis : COLORS.grid}" stroke-width="1"/>`);
    parts.push(`<text x="${left - 8}" y="${y(s) + 4}" text-anchor="end" font-size="11" fill="${COLORS.textMuted}" font-feature-settings="tnum">${pct(s)}</text>`);
  }
  // Marks on the timeline, numbered to match the list under the chart.
  markGroups(report.marks, points[0].at, points.at(-1)!.at).forEach((g, i) => {
    const mx = x(g.at);
    parts.push(`<line x1="${mx}" x2="${mx}" y1="${top - 6}" y2="${top + plotH}" stroke="${COLORS.accent}" stroke-width="1" stroke-opacity="0.6"/>`);
    parts.push(`<rect x="${mx - 8}" y="${top - 14}" width="16" height="16" rx="8" fill="${COLORS.accent}"/>`);
    parts.push(`<text x="${mx}" y="${top - 2}" text-anchor="middle" font-size="10" font-weight="600" fill="#ffffff">${i + 1}</text>`);
  });
  // Lines, then dots (event snapshots hollow), then end labels.
  const ends: { y: number; text: string; color: string }[] = [];
  keys.forEach((k, i) => {
    const c = COLORS.series[i];
    const d = points.map((p, j) => `${j ? "L" : "M"}${x(p.at).toFixed(1)},${y(p.shares[k] ?? 0).toFixed(1)}`).join(" ");
    parts.push(`<path d="${d}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
    for (const p of points) {
      const cx = x(p.at);
      const cy = y(p.shares[k] ?? 0);
      parts.push(`<circle cx="${cx}" cy="${cy}" r="4" fill="${c}" stroke="${COLORS.surface}" stroke-width="2"/>`);
    }
    const last = points.at(-1)!.shares[k] ?? 0;
    ends.push({ y: y(last), text: `${pct(last)} ${labels[k] ?? k}`, color: c });
  });
  // End labels with leader lines when they would collide.
  ends.sort((a, b) => a.y - b.y);
  let prev = -Infinity;
  for (const e of ends) {
    const ly = Math.max(e.y, prev + 15);
    prev = ly;
    if (Math.abs(ly - e.y) > 1) parts.push(`<line x1="${right + 6}" y1="${e.y}" x2="${right + 14}" y2="${ly}" stroke="${COLORS.axis}" stroke-width="1"/>`);
    parts.push(`<text x="${right + 16}" y="${ly + 4}" font-size="11" fill="${COLORS.textSecondary}">${esc(truncate(e.text, 11, W - right - 22))}</text>`);
  }
  // X axis: each snapshot's date.
  let lastLabelX = -Infinity;
  for (const p of points) {
    const px = x(p.at);
    if (px - lastLabelX < 46) continue;
    lastLabelX = px;
    parts.push(`<text x="${px}" y="${top + plotH + 18}" text-anchor="middle" font-size="11" fill="${COLORS.textMuted}">${shortDate(p.at)}</text>`);
  }
  parts.push(`<text x="12" y="${H - 8}" font-size="11" fill="${COLORS.textMuted}">Share of answers that bring up each topic, all four AIs. Numbered lines: see "What happened this month".</text>`);
  return svgDoc(W, H, parts.join("\n"));
}

/** Marks close together share one number on the chart. */
export function markGroups(marks: TimelineMark[], from: Date, to: Date): { at: Date; marks: TimelineMark[] }[] {
  const inRange = marks.filter((m) => m.at >= from && m.at <= to);
  const groups: { at: Date; marks: TimelineMark[] }[] = [];
  const day = 24 * 60 * 60 * 1000;
  for (const m of inRange) {
    const g = groups.at(-1);
    if (g && m.at.getTime() - g.at.getTime() < day) g.marks.push(m);
    else groups.push({ at: m.at, marks: [m] });
  }
  return groups;
}

export interface RenderedChart {
  cid: string;
  filename: string;
  alt: string;
  png: Buffer;
  width: number;
}

export function itemCharts(report: ItemReport, index: number, sample = false): { trend: RenderedChart } {
  const slug = `item${index + 1}`;
  return {
    trend: { cid: `${slug}-themes`, filename: `${slug}-themes.png`, alt: `${report.watchItem.name}: what the AIs talk about most, through the month`, png: svgToPng(themeTrendSvg(report, sample)), width: CHART_WIDTH },
  };
}
