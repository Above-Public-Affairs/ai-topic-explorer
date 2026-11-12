import { describe, expect, it } from "vitest";
import { groupNearDuplicates, themeCore, topicCoreWords } from "@/lib/results/theme-merge";

const labels = (groups: string[][]) => groups.map((g) => g.join(" | "));

describe("near-duplicate themes", () => {
  it("folds the 7.1 asteroid-mining duplicates into one theme each", () => {
    const themes = [
      "Technical hurdles",
      "Economic viability",
      "Technical progress and hurdles",
      "Commercial viability",
      "Legal framework",
      "Technical challenges",
      "Commercial economics",
      "Economic barriers",
      "Space law and property rights",
    ];
    const groups = groupNearDuplicates(themes, (t) => t, "Asteroid mining feasibility");
    expect(labels(groups)).toEqual([
      "Technical hurdles | Technical progress and hurdles | Technical challenges",
      "Economic viability | Commercial viability | Commercial economics | Economic barriers",
      "Legal framework",
      "Space law and property rights",
    ]);
  });

  it("folds the 7.1 water-scarcity duplicates and keeps distinct ideas apart", () => {
    const themes = ["Water supply", "Efficiency and conservation", "Supply expansion", "Water efficiency", "Agricultural efficiency", "Desalination costs", "Groundwater depletion"];
    const groups = groupNearDuplicates(themes, (t) => t, "Water scarcity solutions");
    expect(labels(groups)).toEqual([
      "Water supply | Supply expansion",
      "Efficiency and conservation | Water efficiency | Agricultural efficiency",
      "Desalination costs",
      "Groundwater depletion",
    ]);
  });

  it("never merges themes that are all filler or topic words", () => {
    const groups = groupNearDuplicates(["Challenges", "Key concerns", "Data centers"], (t) => t, "data centers in Texas");
    expect(groups).toHaveLength(3);
  });

  it("keeps the lead (best-ranked) label", () => {
    const [group] = groupNearDuplicates(["Grid strain", "Grid strain concerns"], (t) => t, "Texas data centers");
    expect(group[0]).toBe("Grid strain");
  });

  it("drops topic words, filler and facet nouns from a theme's core", () => {
    expect([...themeCore("Technical progress and hurdles", topicCoreWords("Asteroid mining"))]).toEqual(["technical"]);
    expect([...themeCore("Commercial economics", new Set())]).toEqual(["economic"]);
  });
});
