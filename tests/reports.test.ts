import { afterEach, describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@/app/generated/prisma/client";
import { buildItemReport, locationLine } from "@/lib/reports/aggregate";
import { svgToPng, themeTrendSvg } from "@/lib/reports/charts";
import { headlineChanges, inTen, plainChange } from "@/lib/reports/plain";
import { historySkipReason, monthFromKey, previousMonth, reportJobKey } from "@/lib/reports/month";
import { buildReport, enabledFromEnv, recipientsFromEnv, runMonthlyReport, SENDING_NOTE, UNKNOWN_OUTCOME_NOTE } from "@/lib/reports/monthly";
import { SAMPLE_MONTH, sampleMonth } from "@/lib/reports/sample";
import { fallbackSummary, numbersAreGrounded, writeSummary, type SummaryClient } from "@/lib/reports/summary";
import { sendEmail } from "@/lib/email/send";
import { EXTRACTION_DEFAULT, type ModelChoice } from "@/lib/answers/registry";

const settings = EXTRACTION_DEFAULT as ModelChoice;

describe("report month", () => {
  it("covers the month before the run", () => {
    expect(previousMonth(new Date("2026-12-01T14:00:00Z")).key).toBe("2026-11");
    expect(previousMonth(new Date("2027-01-01T14:00:00Z"))).toMatchObject({ key: "2026-12", label: "December 2026" });
    const m = monthFromKey("2026-12");
    expect(m.start.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(m.end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(reportJobKey(m)).toBe("report:monthly:2026-12");
    expect(() => monthFromKey("2026-13")).toThrow();
  });

  it("waits for 4 weekly snapshots", () => {
    expect(historySkipReason(0, 0)).toMatch(/^not enough history yet: 0 of 4/);
    expect(historySkipReason(3, 3)).toMatch(/^not enough history yet: 3 of 4/);
    expect(historySkipReason(4, 0)).toBe("no snapshots this month");
    expect(historySkipReason(4, 1)).toBeNull();
  });

  it("first real report: November (3 Mondays from Nov 10) waits, December goes out", () => {
    const mondays = ["2026-11-10", "2026-11-17", "2026-11-24", "2026-12-01", "2026-12-08"].map((d) => new Date(`${d}T05:15:00Z`));
    const through = (key: string) => mondays.filter((d) => d < monthFromKey(key).end).length;
    expect(historySkipReason(through("2026-11"), 3)).toMatch(/not enough history/);
    expect(historySkipReason(through("2026-12"), 2)).toBeNull();
  });
});

describe("aggregation (sample data)", () => {
  const inputs = sampleMonth();
  const reports = inputs.map(buildItemReport);

  it("finds the injected changes, and only those", () => {
    const [dc, og, re] = reports;
    const key = (w: { scope: string; metric: string; key: string }) => `${w.scope}|${w.metric}|${w.key}`;
    expect(dc.depthChanges.map(key)).toEqual(["all|theme|t:water-consumption"]);
    expect(dc.citationChanges.map(key).sort()).toEqual(["all|domain|reddit.com", "gemini|domain|reddit.com", "openai|domain|texastribune.org"]);
    expect(og.depthChanges.map(key)).toEqual(["all|theme|t:methane-emissions"]);
    expect(og.citationChanges).toEqual([]);
    expect(re.depthChanges).toEqual([]);
    expect(re.citationChanges.map(key)).toContain("all|domain|eia.gov");
  });

  it("an A/A month (no change in rates) shows no all-AI swings and almost no per-AI ones", () => {
    // The synthetic repeats agree less than real ones do, so one per-AI false swing in the
    // hundreds tested is tolerated here; task 4.3's real A/A test had none.
    let perAi = 0;
    for (const input of inputs) {
      const before = input.baseline!;
      const after = input.snapshots.find((s) => s.kind === "weekly")!; // Dec 7, before any injected change
      const r = buildItemReport({ ...input, baseline: before, snapshots: [after] });
      const swings = [...r.depthChanges, ...r.citationChanges];
      expect(swings.filter((w) => w.scope === "all")).toEqual([]);
      perAi += swings.length;
    }
    expect(perAi).toBeLessThanOrEqual(1);
  });

  it("compares from last month's final snapshot and marks real rows", () => {
    const dc = reports[0];
    expect(dc.startIsBaseline).toBe(true);
    expect(dc.startAt.toISOString().slice(0, 10)).toBe("2026-11-30");
    expect(dc.questionsCompared).toBe(8);
    const water = dc.top.theme.find((t) => t.key === "t:water-consumption")!;
    expect(water.real).toBe(true);
    expect(water.end).toBeGreaterThan(water.start);
    expect(dc.top.theme.filter((t) => t.real)).toHaveLength(1);
    expect(dc.topDomainsByAi.gemini?.find((d) => d.key === "reddit.com")?.real).toBe(true);
  });

  it("breadth lists what only the fresh questions named", () => {
    const dc = reports[0];
    expect(dc.breadth.freshAnswers).toBe(5 * 32);
    expect(dc.breadth.rows.theme.map((r) => r.key)).toEqual(["t:drought-planning"]);
    expect(dc.breadth.rows.entity.map((r) => r.key).sort()).toEqual(["c:hood-county", "c:lcra"]);
    expect(dc.breadth.rows.domain.every((r) => !dc.top.domain.some((t) => t.key === r.key))).toBe(true);
  });

  it("states where the AIs were asked from", () => {
    expect(reports.map((r) => r.locationLine)).toEqual([
      "Asked as a user in Austin, Texas",
      "Asked as a user in Albuquerque, New Mexico",
      "Asked as a user in Austin, Texas",
    ]);
    const city = (c: string) => ({ city: c, region: "Texas", country: "US" });
    expect(locationLine([city("Austin"), city("austin"), city("Houston")])).toBe("Asked as a user in Austin, Texas and Houston, Texas");
    expect(locationLine([null])).toBe("Asked location not recorded");
  });

  it("theme series covers every snapshot with the month's top themes", () => {
    const dc = reports[0];
    expect(dc.themeSeries.points).toHaveLength(1 + inputs[0].snapshots.length);
    expect(dc.themeSeries.keys).toHaveLength(4);
    expect(dc.themeSeries.keys).toContain("t:water-consumption");
  });
});

describe("charts", () => {
  const r = buildItemReport(sampleMonth()[0]);
  it("render to PNG and carry the sample stamp", () => {
    const svg = themeTrendSvg(r, true);
    expect(svg).toContain("SAMPLE DATA");
    expect(themeTrendSvg(r, false)).not.toContain("SAMPLE DATA");
    const png = svgToPng(svg);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(1200); // 600px at 2x
  });
});

describe("summary", () => {
  const items = sampleMonth().map(buildItemReport);
  const reply = (text: string): SummaryClient => ({
    responses: { create: vi.fn(async () => ({ output_text: text, usage: { input_tokens: 1000, output_tokens: 100 } })) } as unknown as SummaryClient["responses"],
  });

  it("only allows numbers that are in the facts", () => {
    expect(numbersAreGrounded("rose from 39% to 60%", { a: "39%", b: "60%" }).ok).toBe(true);
    expect(numbersAreGrounded("rose 21 points", { a: "39%", b: "60%" })).toEqual({ ok: false, unknown: ["21"] });
  });

  it("uses the model's text when every number checks out", async () => {
    const s = await writeSummary(items, [], "December 2026", { client: reply("The AIs talk about water use more: about 6 in 10 answers now, up from about 4 in 10."), settings });
    expect(s.source).toBe("model");
  });

  it("falls back to code when the model invents a figure or fails", async () => {
    const invented = await writeSummary(items, [], "December 2026", { client: reply("Water use rose by 21 points."), settings });
    expect(invented).toMatchObject({ source: "fallback", note: expect.stringContaining("21") });
    expect(invented.text).toBe(fallbackSummary(items, []));
    const failing: SummaryClient = { responses: { create: vi.fn(async () => { throw new Error("boom"); }) } as unknown as SummaryClient["responses"] };
    expect(await writeSummary(items, [], "December 2026", { client: failing, settings })).toMatchObject({ source: "fallback", note: expect.stringContaining("boom") });
  });

  it("fallback names each item in plain words", () => {
    const text = fallbackSummary(items, []);
    expect(text).toContain("Data centers in Texas: The AIs talk about water use more: 6 in 10 answers now, up from about 4 in 10.");
    expect(text).not.toMatch(/%|noise band|citation/i);
  });
});

describe("plain wording", () => {
  const [dc, , re] = sampleMonth().map(buildItemReport);
  it("says shares as N in 10", () => {
    expect([0, 0.02, 0.39, 0.6, 0.97].map(inTen)).toEqual(["none", "fewer than 1 in 10", "about 4 in 10", "6 in 10", "almost all"]);
  });
  it("leads with all-AI changes and says each finding once", () => {
    const lines = headlineChanges(dc).map(plainChange);
    expect(lines).toEqual([
      "The AIs talk about water use more: 6 in 10 answers now, up from about 4 in 10.",
      "The AIs point to reddit.com as a source more: about 2 in 10 answers now, up from about 1 in 10.",
      "ChatGPT points to texastribune.org as a source less: about 1 in 10 answers now, down from about 5 in 10.",
    ]);
    expect(headlineChanges(re).map(plainChange)[0]).toBe("The AIs point to eia.gov as a source more: about 5 in 10 answers now, up from about 2 in 10.");
  });
});

describe("built report", () => {
  it("is marked sample, plain, has the location line and one inline chart per topic", async () => {
    const built = await buildReport(monthFromKey(SAMPLE_MONTH), sampleMonth(), [], {
      sample: true,
      summarize: async (items, skipped) => ({ text: fallbackSummary(items, skipped), source: "fallback", costUsd: 0 }),
    });
    expect(built.subject).toMatch(/^\[SAMPLE DATA\]/);
    expect(built.html).toContain("SAMPLE DATA.");
    expect(built.html).toContain("Asked as a user in Albuquerque, New Mexico");
    expect(built.text).toContain("Asked as a user in Austin, Texas");
    expect(built.attachments).toHaveLength(3);
    for (const a of built.attachments) expect(built.html).toContain(`cid:${a.contentId}`);
    expect(built.html).toContain("A-901, Dec 14: Sample alert");
    expect(built.text).toContain("A-904, Dec 21: Sample alert: fewer AI answers about New Mexico oil and gas mention methane (recorded, not emailed)");
    expect(built.html).not.toMatch(/<script/i);
    // Task 6.6 (security review L2): recurring new questions are listed for a person, never added automatically.
    expect(built.text).toContain("Questions that keep coming up:");
    expect(built.text).toContain('- "Sample question: are data centers to blame for higher power bills in Texas?" (in 3 of the last 4 weeks)');
    expect(built.html).toContain("unless someone reviews it and adds it");
    for (const jargon of [/noise band/i, /locked question/i, /entit(y|ies)/i, /citation/i, /snapshot/i, /\bband\b/i])
      expect(built.text.replace(/SAMPLE DATA.*\n/, "")).not.toMatch(jargon);
  });
});

describe("env", () => {
  it("is off unless REPORTS_ENABLED is true, and defaults recipients to Josh", () => {
    expect(enabledFromEnv(undefined)).toBe(false);
    expect(enabledFromEnv("false")).toBe(false);
    expect(enabledFromEnv(" TRUE ")).toBe(true);
    expect(recipientsFromEnv(undefined)).toEqual(["joshua@abovepublicaffairs.com"]);
    expect(recipientsFromEnv("a@x.com, b@y.org")).toEqual(["a@x.com", "b@y.org"]);
    expect(() => recipientsFromEnv("nope")).toThrow();
  });
});

describe("runMonthlyReport waits for history", () => {
  function fakeDb(weekly: number) {
    const db = {
      watchItem: { findMany: vi.fn(async () => [{ id: "w1", name: "Data centers in Texas" }]) },
      run: { count: vi.fn(async (args: { where: { kind: unknown } }) => (args.where.kind === "weekly" ? weekly : 1)) },
      watcherJob: { create: vi.fn() },
    };
    return db;
  }

  it("skips with a logged note before claiming the month or sending", async () => {
    const db = fakeDb(1);
    const send = vi.fn();
    const lines: string[] = [];
    const out = await runMonthlyReport(db as unknown as PrismaClient, { now: new Date("2026-12-01T14:00:00Z"), enabled: true, recipients: ["x@y.com"], send, log: (l) => lines.push(l) });
    expect(out).toMatchObject({ outcome: "skipped", reason: "not enough history yet" });
    expect(lines.at(-1)).toBe("Monthly report for November 2026: skipped, not enough history yet.");
    expect(lines[0]).toContain("1 of 4 weekly snapshots");
    expect(send).not.toHaveBeenCalled();
    expect(db.watcherJob.create).not.toHaveBeenCalled();
  });

  it("builds and sends nothing while REPORTS_ENABLED is off", async () => {
    const db = fakeDb(5);
    const send = vi.fn();
    const out = await runMonthlyReport(db as unknown as PrismaClient, { now: new Date("2027-01-01T14:00:00Z"), enabled: false, recipients: ["x@y.com"], send });
    expect(out).toMatchObject({ outcome: "disabled", ready: ["Data centers in Texas"] });
    expect(send).not.toHaveBeenCalled();
    expect(db.watcherJob.create).not.toHaveBeenCalled();
  });
});

// Task 6.6, code review L3: a run killed mid-send must not lead to a second send.
describe("runMonthlyReport after a run stopped mid-send", () => {
  type Job = { key: string; kind: string; status: string; attempts: number; startedAt: Date; note: string | null };
  function fakeDb(job: Job | null) {
    const jobs = new Map<string, Job>(job ? [[job.key, job]] : []);
    return {
      jobs,
      db: {
        watchItem: { findMany: async () => [{ id: "w1", name: "Data centers in Texas" }] },
        run: { count: async () => 5 },
        watcherJob: {
          create: async ({ data }: { data: Job }) => {
            if (jobs.has(data.key)) throw new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" });
            jobs.set(data.key, { ...data, attempts: 1, note: null });
          },
          findUnique: async ({ where }: { where: { key: string } }) => jobs.get(where.key) ?? null,
          updateMany: async ({ where, data }: { where: Partial<Job>; data: Partial<Job> & { attempts?: unknown } }) => {
            const j = jobs.get(where.key!);
            const ok = j && (where.status === undefined || j.status === where.status) && (where.note === undefined || j.note === where.note) && (where.attempts === undefined || j.attempts === where.attempts);
            if (!ok) return { count: 0 };
            Object.assign(j, { ...data, attempts: data.attempts ? j.attempts + 1 : j.attempts });
            return { count: 1 };
          },
          update: async ({ where, data }: { where: { key: string }; data: Partial<Job> }) => Object.assign(jobs.get(where.key)!, data),
        },
      } as unknown as PrismaClient,
    };
  }

  it("doesn't resend once the stale job says it was sending", async () => {
    // Stopped 2 hours ago after handing the email to SendGrid; the job is stale, so a plain claim would retry it.
    const { db, jobs } = fakeDb({ key: "report:monthly:2026-11", kind: "monthly_report", status: "running", attempts: 1, startedAt: new Date("2026-12-01T12:00:00Z"), note: SENDING_NOTE });
    const send = vi.fn();
    const out = await runMonthlyReport(db, { now: new Date("2026-12-01T14:00:00Z"), month: monthFromKey("2026-11"), enabled: true, recipients: ["x@y.com"], send });
    expect(send).not.toHaveBeenCalled();
    expect(out).toMatchObject({ outcome: "skipped" });
    expect(jobs.get("report:monthly:2026-11")).toMatchObject({ status: "complete", note: UNKNOWN_OUTCOME_NOTE });
  });
});

describe("sendEmail inline images", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("sends cid attachments inline", async () => {
    process.env.SENDGRID_API_KEY = "test";
    process.env.SENDGRID_FROM = "from@example.com";
    const fetchMock = vi.fn(async () => new Response(null, { status: 202, headers: { "x-message-id": "m1" } }));
    vi.stubGlobal("fetch", fetchMock);
    await sendEmail({ to: "a@b.com", subject: "s", text: "t", html: "<img src='cid:c1'>", attachments: [{ filename: "c1.png", type: "image/png", content: Buffer.from("png"), contentId: "c1" }] });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.attachments).toEqual([{ content: Buffer.from("png").toString("base64"), type: "image/png", filename: "c1.png", disposition: "inline", content_id: "c1" }]);
    delete process.env.SENDGRID_API_KEY;
    delete process.env.SENDGRID_FROM;
  });
});
