import { ImageResponse } from "next/og";

export const alt = "AI Topic Explorer – See what AI knows about any topic";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background:
            "linear-gradient(135deg, #F8F6F3 0%, #e8f4f8 30%, #f0e8f8 60%, #F8F6F3 100%)",
          fontFamily: "system-ui, -apple-system, sans-serif",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Decorative gradient blobs */}
        <div
          style={{
            position: "absolute",
            top: "-80px",
            left: "-80px",
            width: "400px",
            height: "400px",
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(8,145,178,0.18) 0%, transparent 70%)",
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "-60px",
            right: "-60px",
            width: "350px",
            height: "350px",
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(124,58,237,0.16) 0%, transparent 70%)",
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "100px",
            right: "200px",
            width: "200px",
            height: "200px",
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(6,182,212,0.12) 0%, transparent 70%)",
            display: "flex",
          }}
        />

        {/* Main content */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "24px",
            zIndex: 1,
          }}
        >
          {/* AI model dots */}
          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            <div
              style={{
                width: "14px",
                height: "14px",
                borderRadius: "50%",
                background: "#D97757",
                boxShadow: "0 0 12px rgba(217,119,87,0.5)",
                display: "flex",
              }}
            />
            <div
              style={{
                width: "14px",
                height: "14px",
                borderRadius: "50%",
                background: "#10a37f",
                boxShadow: "0 0 12px rgba(16,163,127,0.5)",
                display: "flex",
              }}
            />
            <div
              style={{
                width: "14px",
                height: "14px",
                borderRadius: "50%",
                background: "#4285f4",
                boxShadow: "0 0 12px rgba(66,133,244,0.5)",
                display: "flex",
              }}
            />
            <div
              style={{
                width: "14px",
                height: "14px",
                borderRadius: "50%",
                background: "#1CB8B8",
                boxShadow: "0 0 12px rgba(28,184,184,0.5)",
                display: "flex",
              }}
            />
            <div
              style={{
                width: "14px",
                height: "14px",
                borderRadius: "50%",
                background: "#E5243F",
                boxShadow: "0 0 12px rgba(229,36,63,0.5)",
                display: "flex",
              }}
            />
          </div>

          {/* Title */}
          <div
            style={{
              fontSize: "72px",
              fontWeight: 800,
              background: "linear-gradient(135deg, #0e7490, #6d28d9)",
              backgroundClip: "text",
              color: "transparent",
              lineHeight: 1.1,
              display: "flex",
            }}
          >
            AI Topic Explorer
          </div>

          {/* Tagline */}
          <div
            style={{
              fontSize: "28px",
              color: "#64748b",
              fontWeight: 500,
              maxWidth: "700px",
              textAlign: "center",
              lineHeight: 1.4,
              display: "flex",
            }}
          >
            See what 5 leading AI systems collectively know about any topic
          </div>

          {/* URL pill */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginTop: "16px",
              padding: "10px 24px",
              borderRadius: "999px",
              background: "rgba(255,255,255,0.7)",
              border: "1px solid rgba(0,0,0,0.08)",
              fontSize: "20px",
              color: "#0891b2",
              fontWeight: 600,
            }}
          >
            aitopicexplorer.app
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
