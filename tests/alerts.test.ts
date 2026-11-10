import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import type { Swing } from "@/lib/snapshots";
import {
  MAX_ALERTS_PER_SNAPSHOT,
  afterSnapshot,
  alertRecipients,
  alertsEnabled,
  askedAs,
  buildFacts,
  checkWritten,
  claudePrompt,
  inventedNumbers,
  quoteFor,
  renderHtml,
  renderText,
  selectAlerts,
  templateSummary,
  writeSummary,
  type AlertFacts,
  type Candidate,
  type WriterClient,
} from "@/lib/alerts";
import type { ModelChoice } from "@/lib/answers/registry";

function swing(p: Partial<Swing> & Pick<Swing, "key">): Swing {
  const before = p.before ?? 0.1;
  const after = p.after ?? 0.3;
  return {
    scope: "all",
    metric: "entity",
    label: p.key,
    before,
    after,
    change: after - before,
    threshold: 0.1,
    countBefore: Math.round(before * 96),
    countAfter: Math.round(after * 96),
    kind: before === 0 ? "new" : after === 0 ? "gone" : after > before ? "rose" : "fell",
    ...p,
  };
}

describe("selectAlerts", () => {
  it("makes one finding of a change seen across all AIs and for some AIs on their own", () => {
    const sel = selectAlerts(
      [swing({ key: "c:ercot" }), swing({ key: "c:ercot", scope: "grok", threshold: 0.18 }), swing({ key: "c:ercot", scope: "claude", threshold: 0.15 })],
      { trigger: "weekly" }
    );
    expect(sel.alerts).toHaveLength(1);
    expect(sel.alerts[0].swing.scope).toBe("all");
    expect(sel.alerts[0].providers).toEqual(["claude", "grok"]);
    expect(sel.alerts[0].related).toHaveLength(3);
  });

  it("ranks by how far past the band, lifting all-AI changes over one AI's", () => {
    const sel = selectAlerts(
      [
        swing({ key: "c:one-ai", scope: "gemini", before: 0.1, after: 0.4, threshold: 0.2 }), // 1.5× band
        swing({ key: "c:all", before: 0.1, after: 0.22, threshold: 0.1 }), // 1.2× band, ×1.5 lift = 1.8
      ],
      { trigger: "weekly" }
    );
    expect(sel.alerts.map((a) => a.swing.key)).toEqual(["c:all", "c:one-ai"]);
    expect(sel.alerts.map((a) => a.rank)).toEqual([1, 2]);
  });

  it("caps alerts per snapshot and rolls the rest into one also-changed line", () => {
    const swings = Array.from({ length: 6 }, (_, i) => swing({ key: `c:e${i}`, label: `Entity ${i}`, after: 0.3 + i * 0.05 }));
    const sel = selectAlerts(swings, { trigger: "weekly" });
    expect(sel.alerts).toHaveLength(MAX_ALERTS_PER_SNAPSHOT);
    expect(sel.alerts.map((a) => a.swing.key)).toEqual(["c:e5", "c:e4", "c:e3"]);
    expect(sel.rest).toHaveLength(3);
    expect(sel.alsoChanged).toEqual(["Entity 2 (name) rose 10% → 40%", "Entity 1 (name) rose 10% → 35%", "Entity 0 (name) rose 10% → 30%"]);
  });

  it("treats tone (one value per answer) as one finding", () => {
    const sel = selectAlerts(
      [swing({ key: "critical", metric: "tone", before: 0.2, after: 0.5 }), swing({ key: "positive", metric: "tone", before: 0.5, after: 0.2 })],
      { trigger: "weekly" }
    );
    expect(sel.alerts).toHaveLength(1);
    expect(sel.rest).toHaveLength(0);
  });

  it("labels a model-switch finding as a model change and sends only one", () => {
    const sel = selectAlerts([swing({ key: "reddit.com", metric: "domain", scope: "gemini" }), swing({ key: "c:x", scope: "gemini" })], {
      trigger: "model_switch",
      modelChanged: ["gemini"],
    });
    expect(sel.alerts).toHaveLength(1);
    expect(sel.alerts[0].modelChange).toBe(true);
    expect(sel.alsoChanged[0]).toMatch(/\[model change\]$/);
  });

  it("marks and ranks down a weekly change made only by an AI whose model changed", () => {
    const sel = selectAlerts(
      [swing({ key: "c:model", scope: "gemini", before: 0.1, after: 0.5, threshold: 0.2 }), swing({ key: "c:world", scope: "grok", before: 0.1, after: 0.4, threshold: 0.2 })],
      { trigger: "weekly", modelChanged: ["gemini"] }
    );
    expect(sel.alerts.map((a) => [a.swing.key, a.modelChange])).toEqual([
      ["c:world", false],
      ["c:model", true],
    ]);
  });

  it("lifts something never seen before in the watch item", () => {
    const sel = selectAlerts([swing({ key: "c:old", before: 0.1, after: 0.3 }), swing({ key: "c:brand-new", before: 0, after: 0.18 })], {
      trigger: "weekly",
      firstSeen: new Set(["entity:c:brand-new"]),
    });
    expect(sel.alerts[0].swing.key).toBe("c:brand-new");
    expect(sel.alerts[0].firstSeen).toBe(true);
  });

  it("returns nothing for no swings", () => {
    expect(selectAlerts([], { trigger: "weekly" }).alerts).toEqual([]);
  });
});

function candidate(s: Swing, providers: string[] = []): Candidate {
  return { swing: s, providers: providers as never, related: [s], modelChange: false, firstSeen: false, score: 1, rank: 1 };
}

function facts(overrides: Partial<Parameters<typeof buildFacts>[0]> = {}): AlertFacts {
  return buildFacts({
    candidate: candidate(swing({ key: "c:puc", label: "Public Utility Commission of Texas", before: 0.04, after: 0.21, countBefore: 4, countAfter: 20, threshold: 0.11 })),
    watchItem: { name: "Data centers in Texas", topic: "Data centers in Texas" },
    run: { askCity: "Austin", askRegion: "Texas", askCountry: "US", startedAt: new Date("2026-11-16T05:30:00Z") },
    beforeRun: { startedAt: new Date("2026-11-10T05:30:00Z") },
    trigger: "weekly",
    providersInRun: ["claude", "gemini", "grok", "openai"],
    perAi: [
      { provider: "claude", before: 0, after: 0.25, pastOwnBand: true },
      { provider: "openai", before: 0.08, after: 0.17, pastOwnBand: false },
    ],
    modelChanged: [],
    evidence: [{ ai: "Claude, Nov 16, 2026", question: "1.3", quote: "The Public Utility Commission of Texas is weighing new rules.", sourceUrl: "https://www.texastribune.org/x" }],
    alsoChanged: ["Microsoft (name) fell 16% → 2%"],
    ...overrides,
  });
}

describe("facts", () => {
  it("says how the AIs were asked", () => {
    expect(askedAs({ askCity: "Austin", askRegion: "Texas", askCountry: "US" })).toBe("Asked as a user in Austin, Texas");
    expect(askedAs({ askCity: "Albuquerque", askRegion: "New Mexico", askCountry: "US" })).toBe("Asked as a user in Albuquerque, New Mexico");
    expect(askedAs({ askCity: null, askRegion: null, askCountry: null })).toBe("Asked with no user location");
  });

  it("puts the finding in plain numbers", () => {
    const f = facts();
    expect(f.askedAs).toBe("Asked as a user in Austin, Texas");
    expect(f.finding).toMatchObject({ before: "4%", after: "21%", moved: "17 points", usualWobble: "11 points", who: "all four AIs together", kind: "name" });
    expect(f.dates).toEqual({ before: "Nov 9, 2026", after: "Nov 15, 2026" }); // 05:30 UTC is the night before in Central time
    expect(f.comparedAs).toBe("the Nov 15, 2026 snapshot against the one from Nov 9, 2026");
  });

  it("adds a model caveat when an AI that moved changed model", () => {
    const f = facts({ candidate: candidate(swing({ key: "c:x", scope: "gemini" }), ["gemini"]), modelChanged: ["gemini"] });
    expect(f.modelCaveat).toMatch(/Gemini answered with a different model/);
    expect(facts({ modelChanged: [] }).modelCaveat).toBeUndefined();
  });

  it("quotes the sentence that names the finding", () => {
    const text = "Data centers are growing fast. **ERCOT** says [demand](https://x.com) could double by 2030, straining the grid. Other things happen.";
    expect(quoteFor(text, ["ERCOT"])).toBe("ERCOT says demand could double by 2030, straining the grid.");
    expect(quoteFor(text, ["nothing here"])).toBeNull();
  });
});

describe("no invented numbers", () => {
  const f = facts();

  it("finds numbers and number words the facts don't have", () => {
    expect(inventedNumbers("Mentions rose from 4% to 21%, up 17 points.", f)).toEqual([]);
    expect(inventedNumbers("Mentions rose to 35%, nearly doubled.", f)).toEqual(["35", "doubled"]);
    expect(inventedNumbers("All four AIs, on Nov 15, 2026.", f)).toEqual([]);
  });

  it("rejects jargon, invented numbers and a missing model caveat", () => {
    expect(checkWritten({ summary: "It rose from 4% to 21%.", why: "It may matter." }, f)).toBeNull();
    expect(checkWritten({ summary: "It rose from 4% to 30%.", why: "It may matter." }, f)).toMatch(/30/);
    expect(checkWritten({ summary: "It rose past the noise band.", why: "It may matter." }, f)).toBe("statistics jargon");
    expect(checkWritten({ summary: "", why: "x" }, f)).toBe("empty text");
    const withCaveat = facts({ candidate: candidate(swing({ key: "c:x", scope: "gemini" }), ["gemini"]), modelChanged: ["gemini"] });
    expect(checkWritten({ summary: "It rose from 10% to 30%.", why: "It may matter." }, withCaveat)).toBe("left out the model change");
  });

  it("writes a template that passes its own check, for every kind of finding", () => {
    const shapes: Swing[] = [
      swing({ key: "c:a", label: "ERCOT" }),
      swing({ key: "t:water", metric: "theme", label: "Water use", before: 0.3, after: 0.1 }),
      swing({ key: "texastribune.org", metric: "domain", before: 0, after: 0.2 }),
      swing({ key: "critical", metric: "tone", before: 0.4, after: 0 }),
      swing({ key: "leans against", metric: "side" }),
    ];
    for (const s of shapes) {
      const ff = facts({ candidate: candidate(s) });
      expect(checkWritten(templateSummary(ff), ff), s.key).toBeNull();
    }
    const ms = facts({ trigger: "model_switch", modelSwitch: { provider: "gemini", oldModel: "gemini-3.5-flash-lite", newModel: "gemini-3.6-flash" }, modelChanged: ["gemini"] });
    expect(checkWritten(templateSummary(ms), ms)).toBeNull();
  });

  const settings = { provider: "openai", model: "gpt-6-luna", effortLevel: "none" } as ModelChoice;
  const client = (text: string | Error): WriterClient =>
    ({
      responses: {
        create: async () => {
          if (text instanceof Error) throw text;
          return { output_text: text, usage: { input_tokens: 1500, output_tokens: 150, input_tokens_details: { cached_tokens: 0 } } };
        },
      },
    }) as unknown as WriterClient;

  it("uses the model's text when it passes", async () => {
    const out = await writeSummary(f, { settings, client: client(JSON.stringify({ summary: "Mentions rose from 4% to 21%.", why: "Voters may hear more about the regulator." })) });
    expect(out.writer).toBe("gpt-6-luna");
    expect(out.summary).toBe("Mentions rose from 4% to 21%.");
    expect(out.costUsd).toBeGreaterThan(0);
    expect(out.costUsd).toBeLessThan(0.02);
  });

  it("falls back to the template when the model invents a number", async () => {
    const out = await writeSummary(f, { settings, client: client(JSON.stringify({ summary: "Mentions tripled to 63%.", why: "It may matter." })) });
    expect(out.writer).toBe("template");
    expect(out.rejected).toMatch(/63/);
    expect(inventedNumbers(`${out.summary} ${out.why}`, f)).toEqual([]);
  });

  it("falls back to the template when the call fails", async () => {
    const out = await writeSummary(f, { settings, client: client(new Error("timeout")) });
    expect(out.writer).toBe("template");
    expect(out.rejected).toMatch(/timeout/);
  });
});

describe("email", () => {
  const a = { number: 12, facts: facts(), summary: "Mentions rose from 4% to 21%.", why: "Voters may hear more about the regulator." };

  it("carries the summary, how the AIs were asked, and the Claude prompt", () => {
    const text = renderText(a);
    expect(text).toContain("Mentions rose from 4% to 21%.");
    expect(text).toContain("HOW THE AIS WERE ASKED: Asked as a user in Austin, Texas.");
    expect(text).toContain("Using AI Topic Explorer, explain alert A-12");
    expect(text).toContain('"The Public Utility Commission of Texas is weighing new rules." (Claude, Nov 16, 2026, question 1.3; source: https://www.texastribune.org/x)');
    expect(text).toContain("Also changed this snapshot (no alert of their own): Microsoft (name) fell 16% → 2%.");
    const html = renderHtml(a);
    expect(html).toContain("<strong>How the AIs were asked:</strong> Asked as a user in Austin, Texas.");
    expect(html).toContain("explain alert A-12");
  });

  it("makes a prompt that works pasted into Claude without the connector", () => {
    const p = claudePrompt(a);
    expect(p.split("\n")[0]).toBe("Using AI Topic Explorer, explain alert A-12: what changed, what might explain it, and what I could check next.");
    expect(p).toContain("Asked as a user in Austin, Texas");
    expect(p).toContain("Summary: Mentions rose from 4% to 21%.");
  });

  it("escapes HTML from answers", () => {
    const html = renderHtml({ ...a, facts: facts({ evidence: [{ ai: "Grok", question: "1.1", quote: "<script>x</script>", sourceUrl: "javascript:alert(1)" }] }) });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("javascript:");
  });
});

describe("config", () => {
  it("is off unless ALERTS_ENABLED is true", () => {
    expect(alertsEnabled({})).toBe(false);
    expect(alertsEnabled({ ALERTS_ENABLED: "false" })).toBe(false);
    expect(alertsEnabled({ ALERTS_ENABLED: "true" })).toBe(true);
  });

  it("sends to Josh unless ALERT_RECIPIENTS says otherwise", () => {
    expect(alertRecipients({})).toEqual(["joshua@abovepublicaffairs.com"]);
    expect(alertRecipients({ ALERT_RECIPIENTS: "a@x.com, b@x.com" })).toEqual(["a@x.com", "b@x.com"]);
  });
});

/** A run that already has its alerts: afterSnapshot only delivers. */
function fakeDb(alerts: { id: string; number: number; status: string }[], options: { stealClaim?: boolean } = {}) {
  const rows = alerts.map((a) => ({ ...a, runId: "r1", rank: a.number, subject: `A-${a.number}`, summary: "It rose.\n\nIt may matter.", facts: facts() }));
  const db = {
    alert: {
      count: async () => rows.length,
      findMany: async ({ where }: { where: { status?: string } }) => rows.filter((r) => !where.status || r.status === where.status),
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: { status: string } }) => {
        const r = rows.find((x) => x.id === where.id && x.status === where.status);
        if (!r || options.stealClaim) return { count: 0 };
        r.status = data.status;
        return { count: 1 };
      },
      update: async ({ where, data }: { where: { id: string }; data: { status: string } }) => Object.assign(rows.find((x) => x.id === where.id)!, data),
    },
  };
  return { db: db as unknown as PrismaClient, rows };
}

describe("afterSnapshot delivery", () => {
  const sent: string[] = [];
  const send = async (e: { subject: string }) => {
    sent.push(e.subject);
    return { messageId: "m", sentAt: new Date() };
  };

  it("sends each pending alert once, and nothing on a re-run", async () => {
    sent.length = 0;
    const { db, rows } = fakeDb([{ id: "a", number: 1, status: "pending" }, { id: "b", number: 2, status: "pending" }]);
    const first = await afterSnapshot(db, "r1", { enabled: true, send });
    expect(first).toMatchObject({ existing: 2, created: 0, sent: 2, failed: 0 });
    expect(rows.map((r) => r.status)).toEqual(["sent", "sent"]);
    const again = await afterSnapshot(db, "r1", { enabled: true, send });
    expect(again.sent).toBe(0);
    expect(sent).toHaveLength(2);
  });

  it("never sends suppressed alerts, even once sending is switched on", async () => {
    sent.length = 0;
    const { db } = fakeDb([{ id: "a", number: 1, status: "suppressed" }]);
    expect((await afterSnapshot(db, "r1", { enabled: false, send })).sent).toBe(0);
    expect((await afterSnapshot(db, "r1", { enabled: true, send })).sent).toBe(0);
    expect(sent).toEqual([]);
  });

  it("skips an alert another process claimed first", async () => {
    sent.length = 0;
    const { db } = fakeDb([{ id: "a", number: 1, status: "pending" }], { stealClaim: true });
    expect((await afterSnapshot(db, "r1", { enabled: true, send })).sent).toBe(0);
    expect(sent).toEqual([]);
  });

  it("marks a failed send and doesn't throw", async () => {
    const { db, rows } = fakeDb([{ id: "a", number: 1, status: "pending" }]);
    const r = await afterSnapshot(db, "r1", {
      enabled: true,
      send: async () => {
        throw new Error("SendGrid send failed: 400");
      },
    });
    expect(r).toMatchObject({ sent: 0, failed: 1 });
    expect(rows[0].status).toBe("failed");
  });

  it("never throws into the snapshot that called it", async () => {
    const broken = { alert: { count: async () => Promise.reject(new Error("db down")) } } as unknown as PrismaClient;
    const r = await afterSnapshot(broken, "r1", { enabled: true, send });
    expect(String(r.error)).toMatch(/db down/);
  });
});
