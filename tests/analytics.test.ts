import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANALYTICS_EVENT_NAMES,
  gaBootstrapScript,
  linkDomain,
  resetPageViewMemory,
  trackEvent,
  trackPageView,
} from "@/lib/analytics";

const ROOT = join(import.meta.dirname, "..");

/** A minimal browser: just what lib/analytics touches. */
function fakeBrowser(href: string, referrer = "") {
  const gtag = vi.fn();
  const location = { href };
  vi.stubGlobal("window", { gtag, location });
  vi.stubGlobal("document", { title: "AI Topic Explorer", referrer });
  return {
    gtag,
    navigate(to: string, title = "AI Topic Explorer") {
      location.href = to;
      (globalThis.document as { title: string }).title = title;
    },
  };
}

beforeEach(() => resetPageViewMemory());
afterEach(() => vi.unstubAllGlobals());

describe("trackEvent", () => {
  it("does nothing on the server or without gtag", () => {
    expect(() => trackEvent("bug_report_sent")).not.toThrow();
    vi.stubGlobal("window", {});
    expect(() => trackEvent("share", { method: "copy_link", content_type: "results", item_id: "a1", placement: "sidebar" })).not.toThrow();
  });

  it("sends the event name and its params", () => {
    const { gtag } = fakeBrowser("https://aitopicexplorer.app/");
    trackEvent("analysis_completed", { duration_sec: 42, ais_answered: 4, ais_asked: 4 });
    trackEvent("bug_report_sent");
    expect(gtag.mock.calls).toEqual([
      ["event", "analysis_completed", { duration_sec: 42, ais_answered: 4, ais_asked: 4 }],
      ["event", "bug_report_sent", {}],
    ]);
  });
});

describe("page views on route changes", () => {
  it("sends one page view per URL, with the previous page as referrer", () => {
    const browser = fakeBrowser("https://aitopicexplorer.app/", "https://www.google.com/");
    trackPageView();
    trackPageView(); // React's double effect, or a re-render: not counted again
    browser.navigate("https://aitopicexplorer.app/results/abc", "Housing – AI Topic Explorer");
    trackPageView();
    browser.navigate("https://aitopicexplorer.app/");
    trackPageView();

    expect(browser.gtag.mock.calls).toEqual([
      ["event", "page_view", { page_location: "https://aitopicexplorer.app/", page_referrer: "https://www.google.com/", page_title: "AI Topic Explorer" }],
      ["event", "page_view", { page_location: "https://aitopicexplorer.app/results/abc", page_referrer: "https://aitopicexplorer.app/", page_title: "Housing – AI Topic Explorer" }],
      ["event", "page_view", { page_location: "https://aitopicexplorer.app/", page_referrer: "https://aitopicexplorer.app/results/abc", page_title: "AI Topic Explorer" }],
    ]);
  });
});

describe("gaBootstrapScript", () => {
  function run(search: string, forceDebug = false) {
    const store = new Map<string, string>();
    const ctx: Record<string, unknown> = {
      location: { search },
      sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
    };
    ctx.window = ctx;
    runInNewContext(gaBootstrapScript("G-TEST123", forceDebug), ctx);
    // Arguments objects → plain arrays, for comparing.
    const dataLayer = (ctx.dataLayer as ArrayLike<unknown>[]).map((args) => Array.from(args));
    return { ctx, dataLayer, store };
  }

  it("configures the property with no automatic page view and no ad signals", () => {
    const { dataLayer } = run("");
    expect(dataLayer[0][0]).toBe("js");
    expect(dataLayer[1]).toEqual([
      "config",
      "G-TEST123",
      { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false },
    ]);
  });

  it("queues events fired before gtag.js loads", () => {
    const { ctx, dataLayer } = run("");
    (ctx.gtag as (...a: unknown[]) => void)("event", "analysis_started", { topic_length: 7 });
    const queued = (ctx.dataLayer as ArrayLike<unknown>[]).map((args) => Array.from(args));
    expect(queued).toHaveLength(dataLayer.length + 1);
    expect(queued.at(-1)).toEqual(["event", "analysis_started", { topic_length: 7 }]);
  });

  it("turns on DebugView only when asked, and remembers it for the session", () => {
    expect((run("").dataLayer[1][2] as object)).not.toHaveProperty("debug_mode");
    const debug = run("?topic=x&ga_debug=1");
    expect(debug.dataLayer[1][2]).toHaveProperty("debug_mode", true);
    expect(debug.store.get("ga_debug")).toBe("1");
    expect(run("", true).dataLayer[1][2]).toHaveProperty("debug_mode", true);
  });
});

describe("linkDomain", () => {
  it("keeps only the host", () => {
    expect(linkDomain("https://www.nytimes.com/2026/11/01/story.html?utm_source=x#top")).toBe("nytimes.com");
    expect(linkDomain("http://news.example.org/a")).toBe("news.example.org");
    expect(linkDomain("mailto:someone@example.com")).toBeNull();
    expect(linkDomain("not a url")).toBeNull();
  });
});

describe("the event catalog is the only source of event names", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === "generated" ? [] : sourceFiles(path);
      return /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
  }
  const files = ["app", "components", "lib"].flatMap((d) => sourceFiles(join(ROOT, d)));

  it("every trackEvent call names a catalog event", () => {
    const used = new Set<string>();
    for (const file of files) {
      for (const m of readFileSync(file, "utf8").matchAll(/trackEvent\(\s*"([a-z_]+)"/g)) used.add(m[1]);
    }
    for (const name of used) expect(ANALYTICS_EVENT_NAMES).toContain(name);
    // And nothing in the catalog is dead.
    for (const name of ANALYTICS_EVENT_NAMES) expect(used).toContain(name);
  });

  it("nothing calls gtag directly outside lib/analytics", () => {
    const offenders = files
      .filter((f) => !f.endsWith(join("lib", "analytics.ts")))
      .filter((f) => /\bgtag\(\s*["']event/.test(readFileSync(f, "utf8")))
      .map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it("the old GA property ID appears nowhere in the code", () => {
    const oldId = ["G", "3E8GKHF8ZK"].join("-");
    const hits = files.filter((f) => readFileSync(f, "utf8").includes(oldId)).map((f) => relative(ROOT, f));
    expect(hits).toEqual([]);
  });
});
