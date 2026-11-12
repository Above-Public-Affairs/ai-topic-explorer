import { ImageResponse } from "next/og";
import { prisma } from "@/lib/db";

export const alt = "AI Topic Explorer results: how four AIs answer this topic";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const DOTS = ["#D97757", "#10a37f", "#4285f4", "#1f2937"];

/** The link preview for a results page: the topic, large, on the site's background. */
export default async function ResultsOGImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const analysis = await prisma.analysis.findUnique({ where: { id }, select: { topic: true } }).catch(() => null);
  const raw = analysis?.topic.trim() || "Compare how AI answers any topic";
  const topic = raw.charAt(0).toUpperCase() + raw.slice(1);
  // Long topics end at a word, not mid-word.
  const shown = topic.length > 110 ? `${topic.slice(0, 108).replace(/\s+\S*$/, "").replace(/[,;:]$/, "")}…` : topic;
  const fontSize = shown.length > 70 ? 54 : shown.length > 40 ? 64 : 76;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "linear-gradient(135deg, #F8F6F3 0%, #e8f4f8 35%, #f0e8f8 70%, #F8F6F3 100%)",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ display: "flex", gap: "10px" }}>
            {DOTS.map((c) => (
              <div key={c} style={{ width: "14px", height: "14px", borderRadius: "50%", background: c, display: "flex" }} />
            ))}
          </div>
          <div style={{ fontSize: "26px", fontWeight: 700, color: "#0e7490", display: "flex" }}>AI Topic Explorer</div>
        </div>

        <div
          style={{
            fontSize: `${fontSize}px`,
            fontWeight: 800,
            color: "#1a1a2e",
            lineHeight: 1.12,
            letterSpacing: "-0.02em",
            display: "flex",
            maxWidth: "1040px",
          }}
        >
          {shown}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: "28px", color: "#475569", fontWeight: 500, display: "flex" }}>
            How Claude, ChatGPT, Gemini and Grok answer it
          </div>
          <div style={{ fontSize: "22px", color: "#0891b2", fontWeight: 600, display: "flex" }}>aitopicexplorer.app</div>
        </div>
      </div>
    ),
    { ...size }
  );
}
