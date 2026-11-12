import { describe, expect, it } from "vitest";
import { findWordContext, isHeading } from "@/lib/analysis/word-context";

describe("isHeading", () => {
  it.each([
    "## Technical feasibility",
    "Technical feasibility",
    "**Technical Aspects**",
    "**Key Challenges:**",
    "Technical Aspects:",
    "- **Technical hurdles**",
  ])("treats %j as a heading", (line) => {
    expect(isHeading(line)).toBe(true);
  });

  it.each([
    "Technical hurdles remain significant.",
    "The technical challenges of mining asteroids are still large and unsolved",
    "- **Technical hurdles:** launch costs and robotics are not there yet.",
    "Is it technically possible?",
  ])("keeps %j", (line) => {
    expect(isHeading(line)).toBe(false);
  });
});

describe("findWordContext", () => {
  it("leaves answer headings out of the excerpts", () => {
    const text = [
      "## Technical feasibility",
      "Technical hurdles include propulsion and robotic mining at a distance.",
      "**Technical Aspects**",
      "Most technical work so far is on paper.",
    ].join("\n");
    const [match] = findWordContext("Technical hurdles", { claude: text });
    expect(match.excerpts).toEqual([
      "Technical hurdles include propulsion and robotic mining at a distance.",
      "Most technical work so far is on paper.",
    ]);
  });
});

describe("sentence splitting", () => {
  it("doesn't break after an abbreviation, so a heading with 'vs.' stays whole and is dropped", () => {
    const text = "**Spare Capacity vs. Demand**\nSpare capacity is thin in summer. Demand keeps rising.";
    const [match] = findWordContext("spare capacity", { gemini: text });
    expect(match.excerpts).toEqual(["Spare capacity is thin in summer."]);
  });
});

describe("numbered headings", () => {
  it("keeps '### 2. Heading' whole so it's dropped, and still splits after years", () => {
    const text = "### 2. Spare Capacity vs. Grid Stress\nSpare capacity shrank in 2025. Grid stress rose.";
    const [match] = findWordContext("grid stress", { grok: text });
    expect(match.excerpts).toEqual(["Grid stress rose."]);
  });
});
