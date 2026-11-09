import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QUESTIONS_DEFAULT, clearModelCache, getQuestionModel, setRegistryLoader, type ModelChoice } from "@/lib/answers/registry";
import { priceFor } from "@/lib/answers/prices";
import {
  WATCH_ITEMS,
  anchorMigrationSql,
  anchorPlan,
  checkSetShape,
  checkVoterVoice,
  cleanWhy,
  generateSet,
  parseCandidates,
  type ResponsesClient,
  type ReviewedFile,
} from "@/lib/questions";

const settings: ModelChoice = { ...QUESTIONS_DEFAULT, registryId: "reg-q", source: "registry" };
const DC = WATCH_ITEMS[0];
const item = { ...DC };

function reply(questions: unknown[], extras: Record<string, unknown> = {}) {
  return {
    model: "gpt-6-luna-2026-10-01",
    status: "completed",
    output_text: JSON.stringify({ questions }),
    output: [],
    usage: { input_tokens: 1000, output_tokens: 500, input_tokens_details: { cached_tokens: 0 } },
    ...extras,
  };
}
function fakeClient(...replies: unknown[]) {
  const create = vi.fn();
  replies.forEach((r) => create.mockResolvedValueOnce(r));
  return { client: { responses: { create } } as unknown as ResponsesClient, create };
}
const q = (text: string, subTopic: string | null, concern = "x", lean = "neutral", style = "plain", why: string | null = null) => ({
  text,
  subTopic,
  concern,
  lean,
  style,
  why,
});

const DC_ANCHOR = [
  q("data centers straining the ercot grid", "power generation", "electricity supply", "negative", "fragment"),
  q("can all these data centers make the texas grid stronger", "Power Generation", "electricity supply", "positive"),
  q("is it a bad idea to build more data centers when they use so much water", "water use", "water supply", "negative", "stance"),
  q("data centers using recycled water instead of drinking water", "water use", "water supply", "positive", "fragment"),
  q("will a data center near my neighborhood keep me up at night", "noise", "noise near homes"),
  q("can data centers be built quiet enough that neighbors don't notice", "noise", "noise near homes"),
  q("why are data centers a bad deal for people in texas", null, "community impact", "negative", "stance"),
  q("could data centers bring good jobs to my part of texas", null, "jobs", "positive"),
];

afterEach(() => {
  setRegistryLoader();
  vi.restoreAllMocks();
});

describe("generateSet", () => {
  it("writes the anchor set without web search, covering every sub-topic", async () => {
    const { client, create } = fakeClient(reply(DC_ANCHOR));
    const set = await generateSet("anchor", { item, subTopics: DC.subTopics, client, settings });
    expect(create).toHaveBeenCalledTimes(1);
    const req = create.mock.calls[0][0];
    expect(req.tools).toBeUndefined();
    expect(req.model).toBe("gpt-6-luna");
    expect(req.reasoning).toEqual({ effort: "low" });
    expect(req.text.format).toMatchObject({ type: "json_schema", strict: true });
    expect(req.instructions).toContain("Write 2 about each sub-topic listed");
    expect(req.instructions).toContain("Mix: about 4 plain, 2 fragments and 2 stances");
    expect(req.instructions).toContain("ChatGPT or Gemini");
    expect(req.instructions).toContain("Never name a company");
    expect(req.text.format.schema.properties.questions.items.required).toEqual(["text", "subTopic", "concern", "lean", "style", "why"]);
    expect(set.questions).toHaveLength(8);
    // Sub-topic names are matched to the stored ones, case ignored.
    expect(set.questions[1].subTopic).toBe("power generation");
    expect(set.missing).toEqual([]);
    expect(set.shape).toEqual([]);
    expect(set.questions.map((x) => x.lean)).toEqual(["negative", "positive", "negative", "positive", "neutral", "neutral", "negative", "positive"]);
    expect(set).toMatchObject({ kind: "anchor", modelRegistryId: "reg-q", model: "gpt-6-luna-2026-10-01", calls: 1, searches: 0 });
    // 1000 in × $0.10/M + 500 out × $0.50/M.
    expect(set.costUsd).toBeCloseTo(0.00035, 8);
  });

  it("asks once for the whole set again when a sub-topic is short or the leans don't balance", async () => {
    const first = DC_ANCHOR.filter((x) => x.subTopic !== "noise").concat(q("why are data centers ruining texas", null, "harm", "negative", "stance"));
    const { client, create } = fakeClient(reply(first), reply(DC_ANCHOR));
    const set = await generateSet("anchor", { item, subTopics: DC.subTopics, client, settings });
    expect(create).toHaveBeenCalledTimes(2);
    const retryInput: string = create.mock.calls[1][0].input;
    expect(retryInput).toContain("2 more about noise");
    expect(retryInput).toContain("more positive-leaning");
    expect(retryInput).toContain("[overall; stance; negative]");
    expect(retryInput).toContain("Write the whole set of 8 again");
    expect(set.questions.map((x) => x.text)).toEqual(DC_ANCHOR.map((x) => x.text));
    expect(set.calls).toBe(2);
  });

  it("keeps the first attempt when the retry is worse", async () => {
    const unbalanced = DC_ANCHOR.map((x) => (x.lean === "positive" ? { ...x, lean: "neutral" } : x));
    const { client } = fakeClient(reply(unbalanced), reply([]));
    const set = await generateSet("anchor", { item, subTopics: DC.subTopics, client, settings });
    expect(set.questions).toHaveLength(8);
    expect(set.shape).toEqual(["3 more positive-leaning (to balance 3 negative)"]);
  });

  it("writes a fresh set with web search from the watch item's location, without repeating locked questions", async () => {
    const fresh = [
      q("what does the data center pause mean for projects already planned", null, "project approvals", "neutral", "plain", "Election news ([texastribune.org](https://www.texastribune.org/x?utm_source=openai))"),
      q("Will data centers raise electric bills for people in Texas?", null, "electric bills", "negative", "plain", "Repeat of a locked one"),
      q("new study data center water use texas 2040", "water use", "future water demand", "neutral", "fragment", "A study"),
    ];
    const { client, create } = fakeClient(
      reply(fresh, {
        output: [
          { type: "web_search_call", action: { type: "search", query: "texas data centers news", sources: [{ type: "url", url: "https://example.org/a" }] } },
          { type: "web_search_call", action: { type: "search", queries: ["austin data center vote"] } },
        ],
      })
    );
    const set = await generateSet("fresh", {
      item,
      subTopics: DC.subTopics,
      client,
      settings,
      size: 2,
      locked: [{ text: "Will data centers raise electric bills for people in Texas?", concern: "electric bills" }],
      recentConcerns: ["project approvals"],
      today: new Date("2026-11-07T12:00:00Z"),
    });
    const req = create.mock.calls[0][0];
    expect(req.tools).toEqual([
      { type: "web_search", user_location: { type: "approximate", city: "Austin", region: "Texas", country: "US", timezone: "America/Chicago" } },
    ]);
    expect(req.instructions).toContain("Today is 2026-11-07");
    expect(req.text.format.schema).toBeDefined();
    expect(req.instructions).toContain("- Will data centers raise electric bills for people in Texas?");
    expect(req.instructions).toContain("- project approvals");
    expect(set.questions.map((x) => x.text)).toEqual([fresh[0].text, fresh[2].text]);
    expect(set.questions[0].why).toBe("Election news");
    expect(set.shape).toEqual([]);
    expect(set.rejected[0].issues).toEqual(["duplicate"]);
    expect(set.searches).toBe(2);
    expect(set.searchQueries).toEqual(["texas data centers news", "austin data center vote"]);
    expect(set.sources).toEqual(["https://example.org/a"]);
    // Two searches at $0.01 plus tokens.
    expect(set.costUsd).toBeCloseTo(0.02035, 8);
  });

  it("throws on an incomplete response", async () => {
    const { client } = fakeClient({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] });
    await expect(generateSet("anchor", { item, subTopics: [], client, settings })).rejects.toThrow(/incomplete: max_output_tokens/);
  });

  it("parses only well-formed candidates", () => {
    expect(parseCandidates([{ text: "A b c d e?", subTopic: " ", concern: "x", lean: "sideways", style: "rant", why: "" }, { text: 1 }, null, "x"])).toEqual([
      { text: "A b c d e?", subTopic: null, concern: "x", lean: "neutral", style: "plain", why: null },
    ]);
    expect(cleanWhy("ERCOT set a deadline. ([ercot.com](https://www.ercot.com/a?utm_source=openai))")).toBe("ERCOT set a deadline.");
    expect(cleanWhy("Per [the Tribune](https://t.org/x), prices rose")).toBe("Per the Tribune, prices rose");
    expect(parseCandidates(undefined)).toEqual([]);
  });
});

describe("the question model in the model list", () => {
  it("is its own role, falling back to QUESTIONS_DEFAULT", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setRegistryLoader(async () => []);
    expect(await getQuestionModel()).toEqual({ ...QUESTIONS_DEFAULT, registryId: null, source: "fallback" });
    setRegistryLoader(async () => [
      { ...QUESTIONS_DEFAULT, role: "questions", id: "q1", model: "other" },
      { ...QUESTIONS_DEFAULT, role: "extraction", id: "x1" },
    ]);
    clearModelCache();
    expect(await getQuestionModel()).toMatchObject({ registryId: "q1", model: "other", source: "registry" });
  });

  it("has a price and is seeded by migration with exactly QUESTIONS_DEFAULT", () => {
    expect(() => priceFor(QUESTIONS_DEFAULT.provider, QUESTIONS_DEFAULT.model, "input")).not.toThrow();
    const sql = readFileSync("prisma/migrations/20261107230100_seed_watch_items/migration.sql", "utf8");
    const s = (v: string | null) => (v === null ? "NULL" : `'${v.replace(/'/g, "''")}'`);
    const d = QUESTIONS_DEFAULT;
    expect(sql).toContain(
      `'questions'::"ModelRole", '${d.provider}'::"AiProvider", ${s(d.model)}, ${s(d.effortLevel)}, ${s(d.searchSetting)}, '${d.locationMode}'::"LocationMode", '${d.confirmedAt.toISOString()}'::timestamp, ${d.isGuess}, ${s(d.sourceUrl)},`
    );
    expect(sql).toContain(s(d.note));
  });
});

describe("watch item seed migration", () => {
  const sql = readFileSync("prisma/migrations/20261107230100_seed_watch_items/migration.sql", "utf8");
  const s = (v: string | null) => (v === null ? "NULL" : `'${v.replace(/'/g, "''")}'`);

  it("seeds exactly WATCH_ITEMS, each with its location and sub-topics", () => {
    expect(WATCH_ITEMS.map((w) => [w.name, w.askCity, w.subTopics])).toEqual([
      ["Data centers in Texas", "Austin", ["power generation", "water use", "noise"]],
      ["Oil and gas in New Mexico", "Albuquerque", []],
      ["Renewables in Texas", "Austin", ["wind", "solar", "BESS"]],
    ]);
    for (const w of WATCH_ITEMS) {
      expect(sql).toContain(
        `SELECT gen_random_uuid()::text, ${s(w.name)}, ${s(w.topic)}, ${s(w.geography)}, ${s(w.askCity)}, ${s(w.askRegion)}, ${s(w.askCountry)}, ${s(w.askTimezone)},`
      );
      for (const sub of w.subTopics) expect(sql).toContain(`${s(sub)} FROM "WatchItem" w WHERE w."name" = ${s(w.name)}`);
    }
    expect(sql.match(/INSERT INTO "WatchItem"/g)).toHaveLength(WATCH_ITEMS.length);
    expect(sql.match(/INSERT INTO "SubTopic"/g)).toHaveLength(WATCH_ITEMS.flatMap((w) => w.subTopics).length);
  });

  it("is additive and writes no question sets (anchor sets wait for Josh)", () => {
    for (const file of ["20261107230000_question_sets", "20261107230100_seed_watch_items", "20261109120000_question_lean"]) {
      const m = readFileSync(`prisma/migrations/${file}/migration.sql`, "utf8");
      expect(m).not.toMatch(/\bDROP\b|\bRENAME\b|\bDELETE FROM\b|\bUPDATE\s+"/);
    }
    expect(sql).not.toMatch(/"QuestionSet"|"Question"/);
  });
});

describe("the reviewed anchor sets file", () => {
  const file = JSON.parse(readFileSync("scripts/anchor-sets/2026-11-09.json", "utf8")) as ReviewedFile;

  it("has 8 entries per watch item in a real person's voice, covering every sub-topic, balanced and mixed", () => {
    expect(file.items.map((i) => i.watchItem)).toEqual(WATCH_ITEMS.map((w) => w.name));
    for (const it of file.items) {
      const w = WATCH_ITEMS.find((x) => x.name === it.watchItem)!;
      expect(it.questions).toHaveLength(8);
      expect(it.questions.map((x) => x.label)).toEqual(["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8"]);
      for (const x of it.questions) expect(checkVoterVoice(x.text), x.text).toEqual([]);
      const plan = anchorPlan(w.subTopics);
      for (const sub of w.subTopics) expect(it.questions.filter((x) => x.subTopic === sub)).toHaveLength(plan.perSubTopic);
      expect(it.questions.filter((x) => x.subTopic === null)).toHaveLength(plan.overall);
      expect(checkSetShape(it.questions.map((x) => ({ lean: x.lean, style: x.style ?? "plain" })), { mix: true }), it.watchItem).toEqual([]);
    }
    // Josh's notes: solar covers land and property values, not water.
    const solar = file.items[2].questions.filter((x) => x.subTopic === "solar");
    expect(solar.map((x) => x.concern)).toEqual(["land and property values", "landowner income"]);
  });

  it("turns into an additive migration that inserts each set locked, word for word", () => {
    const sql = anchorMigrationSql(file, "2026-11-10");
    expect(sql).toContain("approved on 2026-11-10");
    expect(sql.match(/INSERT INTO "QuestionSet"/g)).toHaveLength(3);
    expect(sql.match(/INSERT INTO "Question" /g)).toHaveLength(24);
    expect(sql).toContain(`'anchor'::"QuestionSetKind", 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP`);
    for (const it of file.items) for (const x of it.questions) expect(sql).toContain(`'${x.text.replace(/'/g, "''")}'`);
    expect(sql.match(/'negative'::"QuestionLean"/g)).toHaveLength(12);
    expect(sql.match(/'positive'::"QuestionLean"/g)).toHaveLength(12);
    expect(sql).not.toMatch(/\bDROP\b|\bDELETE\b|\bUPDATE\b/);
  });
});
