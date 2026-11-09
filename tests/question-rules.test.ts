import { describe, expect, it } from "vitest";
import {
  ANCHOR_SIZE,
  MAX_ACTIVE_PROMOTED,
  MAX_PROMOTIONS_PER_SNAPSHOT,
  PROMOTION_MIN_SNAPSHOTS,
  PROMOTION_WINDOW,
  anchorPlan,
  checkSetShape,
  checkVoterVoice,
  findPromotions,
  mixTargets,
  normalizeConcern,
  selectQuestions,
  type Candidate,
  type FreshSetHistory,
  type Lean,
  type Style,
} from "@/lib/questions";

describe("checkVoterVoice (real-person voice)", () => {
  it("passes what real people type: lowercase, fragments, run-ons, first person, stances", () => {
    for (const t of [
      "why are data centers bad for texas",
      "is fracking contaminating water in new mexico",
      "ercot blackout risk this winter",
      "my electric bill went up is it the data centers",
      "are wind farms good for texas ranchers who lease their land",
      "Will data centers raise my electric bill?",
      "is the data center boom a scam on texas families",
      "why are greedy oil companies drilling near my town",
      "big batteries near me safe?",
    ]) {
      expect(checkVoterVoice(t), t).toEqual([]);
    }
  });

  it("still flags jargon, company names, talk about the AI, and more than one question", () => {
    expect(checkVoterVoice("what do stakeholders think about data centers in texas")[0]).toMatch(/jargon/);
    expect(checkVoterVoice("dispatchable generation shortfall texas")[0]).toMatch(/jargon/);
    expect(checkVoterVoice("is the google data center near midlothian using too much water")[0]).toMatch(/company/);
    expect(checkVoterVoice("does exxonmobil pay its fair share in new mexico")[0]).toMatch(/company/);
    expect(checkVoterVoice("as an AI what do you think about solar farms")).toContain("about the AI or the study, not the topic");
    expect(checkVoterVoice("what does chatgpt say about fracking")).toContain("about the AI or the study, not the topic");
    expect(checkVoterVoice("are data centers good? are they bad for texas?")).toContain("more than one question");
    expect(checkVoterVoice("wind farms\nsolar farms")).toContain("more than one question");
  });

  it("wants 2 to 25 words", () => {
    expect(checkVoterVoice("fracking")[0]).toMatch(/too short/);
    expect(checkVoterVoice(`is ${"it really true that ".repeat(7)}wind farms help`)[0]).toMatch(/too long/);
  });
});

describe("checkSetShape (balance and mix)", () => {
  const q = (lean: Lean, style: Style = "plain") => ({ lean, style });

  it("wants as many positive as negative leans", () => {
    expect(checkSetShape([q("negative"), q("positive"), q("neutral")])).toEqual([]);
    expect(checkSetShape([q("negative"), q("negative"), q("positive")])).toEqual(["1 more positive-leaning (to balance 2 negative)"]);
    expect(checkSetShape([q("positive")])).toEqual(["1 more negative-leaning (to balance 1 positive)"]);
  });

  it("never lets a stance be neutral", () => {
    expect(checkSetShape([q("neutral", "stance")])[0]).toMatch(/stance question\(s\) marked neutral/);
  });

  it("checks the anchor mix: about half plain, a quarter fragments, a quarter stances", () => {
    expect(mixTargets(8)).toEqual({ plain: 4, fragment: 2, stance: 2 });
    const good = [
      ...Array.from({ length: 2 }, () => q("neutral")),
      q("negative"),
      q("positive"),
      q("negative", "fragment"),
      q("positive", "fragment"),
      q("negative", "stance"),
      q("positive", "stance"),
    ];
    expect(checkSetShape(good, { mix: true })).toEqual([]);
    const allPlain = Array.from({ length: 8 }, (_, i) => q(i % 2 ? "negative" : "positive"));
    expect(checkSetShape(allPlain, { mix: true })).toEqual([
      "8 plain questions; aim for about 4",
      "0 fragment questions; aim for about 2",
      "0 stance questions; aim for about 2",
    ]);
    // Fresh sets don't check the mix.
    expect(checkSetShape(allPlain)).toEqual([]);
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

const c = (text: string, subTopic: string | null = null, concern = "c", lean: Lean = "neutral"): Candidate => ({ text, subTopic, concern, lean, style: "plain" });

describe("selectQuestions", () => {
  const subTopics = ["wind", "solar"];

  it("fills each sub-topic first, then overall, in the model's order", () => {
    const cands = [
      c("do wind farms lower my electric bill", "wind"),
      c("are solar farms good for rural texas counties", "solar"),
      c("who benefits from renewable energy in texas"),
      c("do wind farms hurt birds around here", "wind"),
      c("wind turbine noise near homes", "wind"),
      c("solar farms and cattle grazing texas", "solar"),
    ];
    const r = selectQuestions(cands, { size: 5, subTopics, perSubTopic: 2, overall: 1 });
    expect(r.kept.map((q) => q.text)).toEqual([
      "do wind farms lower my electric bill",
      "are solar farms good for rural texas counties",
      "who benefits from renewable energy in texas",
      "do wind farms hurt birds around here",
      "solar farms and cattle grazing texas",
    ]);
    expect(r.missing).toEqual([]);
    expect(r.shape).toEqual([]);
  });

  it("drops failing and duplicate entries, says what's missing, and reports the shape", () => {
    const r = selectQuestions(
      [
        c("do wind farms lower my electric bill", "wind", "bills", "negative"),
        c("Do wind farms lower my electric bill?", "wind"),
        c("what do stakeholders say about solar", "solar"),
        c("already asked every single week here"),
      ],
      { size: 4, subTopics, perSubTopic: 1, overall: 1, existing: ["Already asked every single week here?"] }
    );
    expect(r.kept).toHaveLength(1);
    expect(r.rejected.map((x) => x.issues[0])).toEqual(["duplicate", 'jargon: "stakeholders"', "duplicate"]);
    expect(r.missing).toEqual(["1 more about solar", "1 more about the topic overall"]);
    expect(r.shape).toEqual(["1 more positive-leaning (to balance 1 negative)"]);
  });

  it("normalizes concern labels", () => {
    const r = selectQuestions([c("will data centers raise my electric bill", null, "  Electric Bills! ")], { size: 1, subTopics: [] });
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
    expect(p).toEqual([{ concern: "bills", fromQuestionId: "q0-0", text: "Question about bills (week -0)?", subTopicId: null, lean: null, seenIn: 3 }]);
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
