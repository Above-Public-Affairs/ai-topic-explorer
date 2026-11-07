import { describe, expect, it } from "vitest";
import { cleanTitle, cleanUrl, orderByFirstLink, stripSearchPreamble, urlKey } from "@/lib/results/sources";

describe("source clean-up", () => {
  it("treats tracking and www variants as one source", () => {
    expect(urlKey("https://www.epelectric.com/communitysolar?utm_source=openai")).toBe(urlKey("https://epelectric.com/communitysolar"));
    expect(cleanUrl("https://gvec.org/sunhub/?utm_source=openai&id=2#top")).toBe("https://gvec.org/sunhub/?id=2");
    expect(cleanUrl("https://a.com")).toBe("https://a.com");
  });

  it("replaces junk titles with one made from the URL, then the domain", () => {
    const url = "https://austinio.com/texas-water-supply-stress.html";
    expect(cleanTitle("OCTOBER 2025", url, "austinio.com")).toBe("Texas water supply stress");
    expect(cleanTitle("austinio.com", url, "austinio.com")).toBe("Texas water supply stress");
    expect(cleanTitle("In Table 2, we estimate ".repeat(10), "https://x.org/a.pdf", "x.org")).toBe("x.org");
    expect(cleanTitle("© 2026 Center for the New Energy Economy 1 State Brief", "https://x.org/1532", "x.org")).toBe("x.org");
    expect(cleanTitle("ERCOT", "https://ercot.com", "ercot.com")).toBe("ERCOT");
    expect(cleanTitle("# Data centers use lots of water", url, "austinio.com")).toBe("Data centers use lots of water");
  });

  it("numbers sources in the order the answer links them", () => {
    const sources = [{ url: "https://a.com" }, { url: "https://b.com" }, { url: "https://c.com" }, { url: "https://d.com" }];
    const text = "One [[1]](https://www.c.com/) two [[2]](https://a.com?utm_source=x) again [[1]](https://c.com)";
    expect(orderByFirstLink(sources, text).map((s) => s.url)).toEqual(["https://c.com", "https://a.com", "https://b.com", "https://d.com"]);
  });

  it("drops the model narrating its search, and nothing else", () => {
    expect(stripSearchPreamble("I'll search for current information on this topic.\n\nTexas has no program.")).toBe("Texas has no program.");
    expect(stripSearchPreamble("Let me look that up.\nI'll also check recent news.\n\nAnswer.")).toBe("Answer.");
    expect(stripSearchPreamble("I'll be brief: Texas has no program.")).toBe("I'll be brief: Texas has no program.");
    expect(stripSearchPreamble("Texas has no program. I'll search for more.")).toBe("Texas has no program. I'll search for more.");
  });
});

describe("titles made from URLs", () => {
  it("drops ids and keeps acronyms", () => {
    expect(cleanTitle(null, "https://x.com/news/ai-data-center-texas-water-21307067.php", "x.com")).toBe("AI data center texas water");
    expect(cleanTitle(null, "https://x.com/269-7ddb60fe-0ff5-4622-91ed-caa6fc34119f", "x.com")).toBe("x.com");
  });
});
