import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ openaiCreate: vi.fn(), grokCreate: vi.fn() }));

// OpenAI and Grok share the openai SDK; Grok's client sets xAI's baseURL.
vi.mock("openai", () => ({
  default: class {
    responses: { create: typeof sdk.openaiCreate };
    constructor(opts: { baseURL?: string } = {}) {
      this.responses = { create: opts.baseURL?.includes("x.ai") ? sdk.grokCreate : sdk.openaiCreate };
    }
  },
}));

import { PROVIDERS, TEXAS_LOCATION } from "@/lib/answers";
import { geminiThinking } from "@/lib/answers/gemini";
import { priceFor } from "@/lib/answers/prices";
import {
  CACHE_MS,
  FREE_TIER_DEFAULTS,
  PROVIDER_IDS,
  clearModelCache,
  getModel,
  getModels,
  setRegistryLoader,
  type ModelChoice,
  type RegistryRow,
} from "@/lib/answers/registry";
import { planLocation } from "@/lib/answers/shared";

function row(over: Partial<RegistryRow> & Pick<RegistryRow, "provider">): RegistryRow {
  const d = FREE_TIER_DEFAULTS[over.provider];
  return {
    id: `row-${over.provider}`,
    model: d.model,
    effortLevel: d.effortLevel,
    searchSetting: d.searchSetting,
    locationMode: d.locationMode,
    confirmedAt: d.confirmedAt,
    isGuess: d.isGuess,
    sourceUrl: d.sourceUrl,
    note: d.note,
    ...over,
  };
}

/** A minimal Responses API reply, as the OpenAI SDK returns it. */
function responsesReply(model: string, extras: Record<string, unknown> = {}) {
  return {
    model,
    status: "completed",
    output_text: "An answer.",
    output: [],
    usage: { input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
    ...extras,
  };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  sdk.openaiCreate.mockReset();
  sdk.grokCreate.mockReset();
});

afterEach(() => {
  setRegistryLoader();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("FREE_TIER_DEFAULTS (the seed list)", () => {
  it("names a model for every provider, with the date confirmed and whether it's a guess", () => {
    for (const id of PROVIDER_IDS) {
      const d = FREE_TIER_DEFAULTS[id];
      expect(d.provider).toBe(id);
      expect(d.model).toMatch(/\S/);
      expect(d.confirmedAt.getTime()).not.toBeNaN();
      expect(typeof d.isGuess).toBe("boolean");
      expect(d.sourceUrl).toMatch(/^https:\/\//);
      expect(d.note).toMatch(/\S/);
    }
  });

  it("marks Grok a guess (xAI publishes no free-tier model) and sends its location by prompt", () => {
    expect(FREE_TIER_DEFAULTS.grok.isGuess).toBe(true);
    expect(FREE_TIER_DEFAULTS.grok.locationMode).toBe("by_prompt");
    expect(FREE_TIER_DEFAULTS.grok.note).toMatch(/Guess/);
  });

  it("never picks a flagship tier", () => {
    const models = PROVIDER_IDS.map((id) => FREE_TIER_DEFAULTS[id].model).join(" ");
    expect(models).not.toMatch(/opus|fable|mythos|-sol\b|astra|terra|-pro\b|argon|grok-4\.7/);
  });

  it("has a price for every default model, so its cost can be computed", () => {
    for (const id of ["claude", "openai", "gemini"] as const) {
      const { model } = FREE_TIER_DEFAULTS[id];
      expect(() => priceFor(id, model, "input")).not.toThrow();
      expect(() => priceFor(id, model, "output")).not.toThrow();
      expect(() => priceFor(id, model, "search")).not.toThrow();
    }
  });
});

describe("getModel / getModels", () => {
  it("reads each provider's current row", async () => {
    setRegistryLoader(async () => PROVIDER_IDS.map((provider) => row({ provider })));
    const models = await getModels();
    for (const id of PROVIDER_IDS) {
      expect(models[id]).toMatchObject({ provider: id, registryId: `row-${id}`, source: "registry" });
    }
  });

  it("uses the registry's values over the built-in defaults", async () => {
    setRegistryLoader(async () => [row({ provider: "grok", id: "g2", model: "grok-4.5", effortLevel: "medium", isGuess: false })]);
    expect(await getModel("grok")).toMatchObject({ model: "grok-4.5", effortLevel: "medium", isGuess: false, registryId: "g2" });
  });

  it("falls back to the built-in default for a provider with no current row", async () => {
    setRegistryLoader(async () => [row({ provider: "claude" })]);
    const models = await getModels();
    expect(models.claude.source).toBe("registry");
    expect(models.gemini).toEqual({ ...FREE_TIER_DEFAULTS.gemini, registryId: null, source: "fallback" });
  });

  it("falls back for every provider when the table can't be read, and says so", async () => {
    setRegistryLoader(async () => {
      throw new Error("connection refused");
    });
    const models = await getModels();
    for (const id of PROVIDER_IDS) expect(models[id].source).toBe("fallback");
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("connection refused"));
  });

  it("takes the first row when a provider has two current rows (the loader sorts newest first)", async () => {
    setRegistryLoader(async () => [
      row({ provider: "openai", id: "newer", model: "gpt-6.1-luna" }),
      row({ provider: "openai", id: "older" }),
    ]);
    expect((await getModel("openai")).registryId).toBe("newer");
  });

  it("caches a successful read for CACHE_MS, then reads again", async () => {
    vi.useFakeTimers();
    const loader = vi.fn(async () => [row({ provider: "claude" })]);
    setRegistryLoader(loader);
    await getModel("claude");
    await getModel("openai");
    expect(loader).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(CACHE_MS + 1);
    await getModel("claude");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("caches an empty table, but not a failed read", async () => {
    const empty = vi.fn(async () => []);
    setRegistryLoader(empty);
    await getModels();
    await getModels();
    expect(empty).toHaveBeenCalledTimes(1);

    const failing = vi.fn(async (): Promise<RegistryRow[]> => {
      throw new Error("down");
    });
    setRegistryLoader(failing);
    await getModels();
    await getModels();
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("shares one read between concurrent lookups", async () => {
    const loader = vi.fn(async () => [row({ provider: "claude" })]);
    setRegistryLoader(loader);
    await Promise.all(PROVIDER_IDS.map((id) => getModel(id)));
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("re-reads after clearModelCache", async () => {
    const loader = vi.fn(async () => [row({ provider: "claude" })]);
    setRegistryLoader(loader);
    await getModels();
    clearModelCache();
    await getModels();
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

describe("planLocation", () => {
  it("sends no location when there is none, whatever the mode", () => {
    expect(planLocation(undefined, "parameter", true)).toEqual({ mode: "none", parameter: null, systemMessage: null });
  });

  it("uses the parameter where the provider has one", () => {
    expect(planLocation(TEXAS_LOCATION, "parameter", true)).toMatchObject({ mode: "parameter", parameter: TEXAS_LOCATION, systemMessage: null });
  });

  it("puts it in the prompt for by_prompt, and when the provider has no parameter", () => {
    for (const plan of [planLocation(TEXAS_LOCATION, "by_prompt", true), planLocation(TEXAS_LOCATION, "parameter", false)]) {
      expect(plan.mode).toBe("by_prompt");
      expect(plan.parameter).toBeNull();
      expect(plan.systemMessage).toContain("Austin, Texas, US");
    }
  });

  it("drops it for mode none", () => {
    expect(planLocation(TEXAS_LOCATION, "none", true).mode).toBe("none");
  });
});

describe("geminiThinking", () => {
  it.each([
    ["low", { thinkingLevel: "LOW" }],
    ["minimal", { thinkingLevel: "MINIMAL" }],
    ["high", { thinkingLevel: "HIGH" }],
    ["none", { thinkingBudget: 0 }],
  ])("%s → %j", (effort, config) => {
    expect(geminiThinking(effort)).toEqual(config);
  });

  it("sends nothing for null and rejects an unknown level", () => {
    expect(geminiThinking(null)).toBeUndefined();
    expect(() => geminiThinking("turbo")).toThrow(/Unknown Gemini effort level "turbo"/);
  });
});

describe("providers read their model from the registry", () => {
  it("asks with the registry row's model and effort, and reports the row", async () => {
    setRegistryLoader(async () => [row({ provider: "grok", id: "grok-row", model: "grok-4.5", effortLevel: "medium" })]);
    sdk.grokCreate.mockResolvedValueOnce(responsesReply("grok-4.5", { usage: { input_tokens: 1, output_tokens: 1, cost_in_usd_ticks: 1e7 } }));

    const r = await PROVIDERS.grok.ask("Q?", { location: TEXAS_LOCATION });

    const request = sdk.grokCreate.mock.calls[0][0];
    expect(request.model).toBe("grok-4.5");
    expect(request.reasoning).toEqual({ effort: "medium" });
    expect(request.input[0]).toMatchObject({ role: "system", content: expect.stringContaining("Austin") });
    expect(r).toMatchObject({ requestedModel: "grok-4.5", modelRegistryId: "grok-row", effortLevel: "medium", locationMode: "by_prompt" });
  });

  it("uses settings passed in over the registry", async () => {
    const loader = vi.fn(async () => []);
    setRegistryLoader(loader);
    const settings: ModelChoice = { ...FREE_TIER_DEFAULTS.openai, registryId: "passed", source: "registry" };
    sdk.openaiCreate.mockResolvedValueOnce(responsesReply("gpt-6-luna"));

    const r = await PROVIDERS.openai.ask("Q?", { location: TEXAS_LOCATION, settings });

    expect(loader).not.toHaveBeenCalled();
    const request = sdk.openaiCreate.mock.calls[0][0];
    expect(request.model).toBe("gpt-6-luna");
    expect(request.reasoning).toEqual({ effort: "none" });
    expect(request.tools[0].user_location).toMatchObject({ city: "Austin", region: "Texas" });
    expect(r).toMatchObject({ modelRegistryId: "passed", locationMode: "parameter" });
  });

  it("follows a by_prompt location mode on a provider that has a parameter", async () => {
    const settings: ModelChoice = { ...FREE_TIER_DEFAULTS.openai, locationMode: "by_prompt", registryId: null, source: "fallback" };
    sdk.openaiCreate.mockResolvedValueOnce(responsesReply("gpt-6-luna"));

    const r = await PROVIDERS.openai.ask("Q?", { location: TEXAS_LOCATION, settings });

    const request = sdk.openaiCreate.mock.calls[0][0];
    expect(request.tools[0].user_location).toEqual({ type: "approximate" });
    expect(request.input[0]).toMatchObject({ role: "system" });
    expect(r.locationMode).toBe("by_prompt");
  });

  it("still answers on the built-in default when the registry can't be read", async () => {
    setRegistryLoader(async () => {
      throw new Error("no database");
    });
    sdk.openaiCreate.mockResolvedValueOnce(responsesReply("gpt-6-luna"));

    const r = await PROVIDERS.openai.ask("Q?");

    expect(sdk.openaiCreate.mock.calls[0][0].model).toBe(FREE_TIER_DEFAULTS.openai.model);
    expect(r).toMatchObject({ modelRegistryId: null, location: null, locationMode: "none" });
  });
});

describe("seed migration", () => {
  it("inserts exactly FREE_TIER_DEFAULTS", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("prisma/migrations/20261107180000_seed_model_registry/migration.sql", "utf8");
    const q = (v: string | null) => (v === null ? "NULL" : `'${v.replace(/'/g, "''")}'`);
    for (const id of PROVIDER_IDS) {
      const d = FREE_TIER_DEFAULTS[id];
      expect(sql).toContain(
        `'${id}'::"AiProvider", ${q(d.model)}, ${q(d.effortLevel)}, ${q(d.searchSetting)}, '${d.locationMode}'::"LocationMode", '${d.confirmedAt.toISOString()}'::timestamp, ${d.isGuess}, ${q(d.sourceUrl)},`
      );
      expect(sql).toContain(q(d.note));
    }
    expect(sql.match(/INSERT INTO "ModelRegistry"/g)).toHaveLength(PROVIDER_IDS.length);
  });
});
