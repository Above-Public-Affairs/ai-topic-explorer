import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QUESTIONS_DEFAULT, clearModelCache, getQuestionModel, setRegistryLoader, type ModelChoice } from "@/lib/answers/registry";
import { priceFor } from "@/lib/answers/prices";
import {
  WATCH_ITEMS,
  anchorMigrationSql,
  anchorPlan,
  checkVoterVoice,
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
const q = (text: string, subTopic: string | null, concern = "x", why: string | null = null) => ({ text, subTopic, concern, why });

const DC_ANCHOR = [
  q("Will data centers in Texas lead to more power plants being built?", "power generation", "new power plants"),
  q("Can Texas make enough electricity for data centers and everyone else?", "Power Generation", "enough power"),
  q("How much water do data centers use, and where does it come from?", "water use", "water supply"),
  q("Could data centers make water shortages worse for Texas towns?", "water use", "water shortages"),
  q("How loud are data centers for people who live nearby?", "noise", "noise near homes"),
  q("What can neighbors do if a data center is too loud at night?", "noise", "noise complaints"),
  q("Will data centers raise electric bills for people in Texas?", null, "electric bills"),
  q("What do Texas towns gain from having data centers nearby?", null, "local benefits"),
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
    expect(req.instructions).toContain("Never name a company");
    expect(set.questions).toHaveLength(8);
    // Sub-topic names are matched to the stored ones, case ignored.
    expect(set.questions[1].subTopic).toBe("power generation");
    expect(set.missing).toEqual([]);
    expect(set).toMatchObject({ kind: "anchor", modelRegistryId: "reg-q", model: "gpt-6-luna-2026-10-01", calls: 1, searches: 0 });
    // 1000 in × $0.10/M + 500 out × $0.50/M.
    expect(set.costUsd).toBeCloseTo(0.00035, 8);
  });

  it("retries once for a sub-topic left short, and keeps what passed", async () => {
    const first = DC_ANCHOR.filter((x) => x.subTopic !== "noise").concat(q("Is the data center boom a scam on Texas?", null));
    const { client, create } = fakeClient(reply(first), reply(DC_ANCHOR.filter((x) => x.subTopic === "noise")));
    const set = await generateSet("anchor", { item, subTopics: DC.subTopics, client, settings });
    expect(create).toHaveBeenCalledTimes(2);
    const retryInput: string = create.mock.calls[1][0].input;
    expect(retryInput).toContain("2 more about noise");
    expect(retryInput).toContain('loaded word: "scam"');
    expect(set.questions.filter((x) => x.subTopic === "noise")).toHaveLength(2);
    expect(set.questions).toHaveLength(8);
    expect(set.calls).toBe(2);
  });

  it("writes a fresh set with web search from the watch item's location, without repeating locked questions", async () => {
    const fresh = [
      q("What could a pause on new data centers mean for projects already planned in Texas?", null, "project approvals", "Election news"),
      q("Will data centers raise electric bills for people in Texas?", null, "electric bills", "Repeat of a locked one"),
      q("What does the new study say about data center water use in Texas by 2040?", "water use", "future water demand", "A study"),
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
    expect(req.instructions).toContain("- Will data centers raise electric bills for people in Texas?");
    expect(req.instructions).toContain("- project approvals");
    expect(set.questions.map((x) => x.text)).toEqual([fresh[0].text, fresh[2].text]);
    expect(set.questions[0].why).toBe("Election news");
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
    expect(parseCandidates([{ text: "A b c d e?", subTopic: " ", concern: "x", why: "" }, { text: 1 }, null, "x"])).toEqual([
      { text: "A b c d e?", subTopic: null, concern: "x", why: null },
    ]);
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
    for (const file of ["20261107230000_question_sets", "20261107230100_seed_watch_items"]) {
      const m = readFileSync(`prisma/migrations/${file}/migration.sql`, "utf8");
      expect(m).not.toMatch(/\bDROP\b|\bRENAME\b|\bDELETE FROM\b|\bUPDATE\s+"/);
    }
    expect(sql).not.toMatch(/"QuestionSet"|"Question"/);
  });
});

describe("the reviewed anchor sets file", () => {
  const file = JSON.parse(readFileSync("scripts/anchor-sets/2026-11-07.json", "utf8")) as ReviewedFile;

  it("has 8 questions per watch item, each in a voter's voice, covering every sub-topic", () => {
    expect(file.items.map((i) => i.watchItem)).toEqual(WATCH_ITEMS.map((w) => w.name));
    for (const it of file.items) {
      const w = WATCH_ITEMS.find((x) => x.name === it.watchItem)!;
      expect(it.questions).toHaveLength(8);
      expect(it.questions.map((x) => x.label)).toEqual(["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8"]);
      for (const x of it.questions) expect(checkVoterVoice(x.text), x.text).toEqual([]);
      const plan = anchorPlan(w.subTopics);
      for (const sub of w.subTopics) expect(it.questions.filter((x) => x.subTopic === sub)).toHaveLength(plan.perSubTopic);
    }
  });

  it("turns into an additive migration that inserts each set locked, word for word", () => {
    const sql = anchorMigrationSql(file, "2026-11-10");
    expect(sql).toContain("approved on 2026-11-10");
    expect(sql.match(/INSERT INTO "QuestionSet"/g)).toHaveLength(3);
    expect(sql.match(/INSERT INTO "Question" /g)).toHaveLength(24);
    expect(sql).toContain(`'anchor'::"QuestionSetKind", 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP`);
    for (const it of file.items) for (const x of it.questions) expect(sql).toContain(`'${x.text.replace(/'/g, "''")}'`);
    expect(sql).not.toMatch(/\bDROP\b|\bDELETE\b|\bUPDATE\b/);
  });
});
