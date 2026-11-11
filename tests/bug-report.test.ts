/** Task 6.6, security review L3: bug-report text is cleaned before it reaches the Error Reporter digest. */
import { describe, expect, it } from "vitest";
import { cleanBugReport, sitePageUrl, SITE_ORIGIN } from "@/lib/guards/bug-report";

const now = new Date("2026-11-11T12:00:00Z");

describe("cleanBugReport", () => {
  it("keeps only page URLs on this site", () => {
    expect(sitePageUrl(`${SITE_ORIGIN}/results/abc`, null)).toBe(`${SITE_ORIGIN}/results/abc`);
    expect(sitePageUrl("http://localhost:3000/", "http://localhost:3000")).toBe("http://localhost:3000/");
    expect(sitePageUrl("https://evil.example/login", SITE_ORIGIN)).toBeNull();
    expect(sitePageUrl("https://aitopicexplorer.app.evil.example/", SITE_ORIGIN)).toBeNull();
    expect(sitePageUrl("javascript:alert(1)", SITE_ORIGIN)).toBeNull();
    expect(sitePageUrl("not a url", SITE_ORIGIN)).toBeNull();
  });

  it("strips control and bidi-override characters but keeps line breaks", () => {
    const r = cleanBugReport({ description: "Line one\r\nLine\u0000 two ‮gnp.exe", userAgent: "UA\u0007\nx" }, null, now);
    expect(r).toMatchObject({ ok: true, report: { description: "Line one\nLine two gnp.exe", userAgent: "UA x" } });
  });

  it("uses the server's time unless the browser sent a real ISO timestamp", () => {
    const sent = cleanBugReport({ description: "x", timestamp: "2026-11-11T11:59:00.000Z" }, null, now);
    const junk = cleanBugReport({ description: "x", timestamp: "<a href=https://evil.example>click</a>" }, null, now);
    expect(sent.ok && sent.report.reportedAt).toBe("2026-11-11T11:59:00.000Z");
    expect(junk.ok && junk.report.reportedAt).toBe(now.toISOString());
  });

  it("refuses an empty or over-long description", () => {
    expect(cleanBugReport({ description: " \u0000 " }, null, now)).toEqual({ ok: false, error: "Description is required" });
    expect(cleanBugReport({ description: "x".repeat(2001) }, null, now)).toEqual({ ok: false, error: "Description too long" });
  });
});
