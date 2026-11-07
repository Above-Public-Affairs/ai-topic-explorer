import { describe, expect, it } from "vitest";
import {
  ANCHOR_SIZE,
  MAX_ACTIVE_PROMOTED,
  MAX_PROMOTIONS_PER_SNAPSHOT,
  PROMOTION_MIN_SNAPSHOTS,
  PROMOTION_WINDOW,
  anchorPlan,
  checkVoterVoice,
  findPromotions,
  normalizeConcern,
  selectQuestions,
  type Candidate,
  type FreshSetHistory,
} from "@/lib/questions";

describe("checkVoterVoice", () => {
  it("passes plain questions a voter would type", () => {
    for (const t of [
      "Will data centers raise my electric bill?",
      "How much water do data centers use, and where does that water come from?",
      "Can big batteries help keep the Texas grid reliable when wind and solar output changes?",
      "Who decides where oil and gas can be produced in New Mexico, and how can residents have a say?",
      "Is the water downstream from the new plant safe to drink?",
    ]) {
      expect(checkVoterVoice(t), t).toEqual([]);
    }
  });

  it("flags jargon, loaded words, company names and talk about the AI", () => {
    expect(checkVoterVoice("How will BESS deployment affect ERCOT prices for families?")).toContain('jargon: "BESS"');
    expect(checkVoterVoice("What do stakeholders think about data centers in Texas?")[0]).toMatch(/jargon/);
    expect(checkVoterVoice("Is the data center boom a scam on Texas families?")[0]).toMatch(/loaded/);
    expect(checkVoterVoice("Why are greedy oil companies drilling near my town?")[0]).toMatch(/loaded/);
    expect(checkVoterVoice("Is the Google data center near Midlothian using too much water?")[0]).toMatch(/company/);
    expect(checkVoterVoice("Does ExxonMobil pay its fair share in New Mexico taxes?")[0]).toMatch(/company/);
    expect(checkVoterVoice("As an AI, what do you think about solar farms in Texas?")).toContain("about the AI or the study, not the topic");
  });

  it("wants one short question ending in a question mark", () => {
    expect(checkVoterVoice("Data centers are raising bills in Texas.")).toContain("not a question");
    expect(checkVoterVoice("Are data centers good? Are they bad for Texas?")).toContain("more than one question");
    expect(checkVoterVoice("Wind?")[0]).toMatch(/too short/);
    expect(checkVoterVoice(`Is ${"it really true that ".repeat(8)}wind farms help?`)[0]).toMatch(/too long/);
  });
});

describe("anchorPlan", () => {
  it("covers every sub-topic and keeps two overall questions", () => {
    expect(anchorPlan(["power generation", "water use", "noise"])).toEqual({ perSubTopic: 2, overall: 2 });
    expect(anchorPlan([])).toEqual({ perSubTopic: 0, overall: ANCHOR_SIZE });
    expect(anchorPlan(["a", "b"])).toEqual({ perSubTopic: 3, overall: 2 });
    // More sub-topics than room: still one each, nothing overall.
    expect(anchorPlan(["a", "b", "c", "d", "e", "f", "g", "h", "i"])).toEqual({ perSubTopic: 1, overall: 0 });
  });
});

const c = (text: string, subTopic: string | null = null, concern = "c"): Candidate => ({ text, subTopic, concern });

describe("selectQuestions", () => {
  const subTopics = ["wind", "solar"];

  it("fills each sub-topic first, then overall, in the model's order", () => {
    const cands = [
      c("Do wind farms lower my electric bill in Texas?", "wind"),
      c("Are solar farms good for rural Texas counties?", "solar"),
      c("Who benefits from renewable energy in Texas?"),
      c("Do wind farms hurt birds and other wildlife here?", "wind"),
      c("Do wind turbines make noise for people living nearby?", "wind"),
      c("Can solar farms share land with cattle in Texas?", "solar"),
    ];
    const r = selectQuestions(cands, { size: 5, subTopics, perSubTopic: 2, overall: 1 });
    expect(r.kept.map((q) => q.text)).toEqual([
      "Do wind farms lower my electric bill in Texas?",
      "Are solar farms good for rural Texas counties?",
      "Who benefits from renewable energy in Texas?",
      "Do wind farms hurt birds and other wildlife here?",
      "Can solar farms share land with cattle in Texas?",
    ]);
    expect(r.missing).toEqual([]);
  });

  it("drops failing and duplicate questions and says what's missing", () => {
    const r = selectQuestions(
      [
        c("Do wind farms lower my electric bill in Texas?", "wind"),
        c("do wind farms lower my electric bill in texas", "wind"),
        c("Is BESS safe for neighbors in rural Texas?", "solar"),
        c("Already asked every single week here?"),
      ],
      { size: 4, subTopics, perSubTopic: 1, overall: 1, existing: ["Already asked every single week here?"] }
    );
    expect(r.kept).toHaveLength(1);
    expect(r.rejected.map((x) => x.issues[0])).toEqual(["not a question", 'jargon: "BESS"', "duplicate"]);
    expect(r.missing).toEqual(["1 more about solar", "1 more about the topic overall"]);
  });

  it("normalizes concern labels", () => {
    const r = selectQuestions([c("Will data centers raise my electric bill?", null, "  Electric Bills! ")], { size: 1, subTopics: [] });
    expect(r.kept[0].concern).toBe("electric bills");
    expect(normalizeConcern("Jobs & local taxes")).toBe("jobs local taxes");
  });
});

/** Fresh sets, newest first, one per week, each with the given concerns. */
function history(concernsPerSet: string[][]): FreshSetHistory[] {
  return concernsPerSet.map((concerns, i) => ({
    setId: `s${i}`,
    startedAt: new Date(Date.UTC(2026, 10, 30 - i * 7)),
    questions: concerns.map((concern, j) => ({ id: `q${i}-${j}`, text: `Question about ${concern} (week -${i})?`, concern, subTopicId: null })),
  }));
}

describe("findPromotions (the promotion rule)", () => {
  it("is 3 of the last 4 fresh sets, at most 2 a snapshot, at most 4 active", () => {
    expect([PROMOTION_MIN_SNAPSHOTS, PROMOTION_WINDOW, MAX_PROMOTIONS_PER_SNAPSHOT, MAX_ACTIVE_PROMOTED]).toEqual([3, 4, 2, 4]);
  });

  it("promotes a concern seen in 3 of the last 4 sets, with its latest wording", () => {
    const p = findPromotions(history([["bills"], ["water"], ["bills"], ["bills", "noise"]]), [], 0);
    expect(p).toEqual([{ concern: "bills", fromQuestionId: "q0-0", text: "Question about bills (week -0)?", subTopicId: null, seenIn: 3 }]);
  });

  it("doesn't promote at 2 of 4, or what only recurred before the window", () => {
    expect(findPromotions(history([["bills"], ["water"], ["bills"], ["noise"]]), [], 0)).toEqual([]);
    // Seen in 3 sets, but only 2 of them are among the last 4.
    expect(findPromotions(history([["a"], ["b"], ["bills"], ["bills"], ["bills"]]), [], 0)).toEqual([]);
  });

  it("counts a concern once per set, however many questions share it", () => {
    expect(findPromotions(history([["bills", "bills", "bills"], ["water"], ["noise"], ["x"]]), [], 0)).toEqual([]);
  });

  it("skips concerns a locked question already asks about", () => {
    expect(findPromotions(history([["bills"], ["bills"], ["bills"]]), ["Bills"], 0)).toEqual([]);
  });

  it("caps promotions per snapshot and active promoted questions, preferring the most frequent then most recent", () => {
    const sets = history([
      ["a", "b", "c"],
      ["a", "b", "c"],
      ["a", "c"],
      ["a", "b", "c"],
    ]);
    expect(findPromotions(sets, [], 0).map((p) => p.concern)).toEqual(["a", "c"]);
    expect(findPromotions(sets, [], 3).map((p) => p.concern)).toEqual(["a"]);
    expect(findPromotions(sets, [], MAX_ACTIVE_PROMOTED)).toEqual([]);
  });

  it("matches concern labels however they're written", () => {
    const p = findPromotions(history([["Electric bills"], ["electric  bills!"], ["ELECTRIC BILLS"]]), [], 0);
    expect(p.map((x) => [x.concern, x.seenIn])).toEqual([["electric bills", 3]]);
  });
});
