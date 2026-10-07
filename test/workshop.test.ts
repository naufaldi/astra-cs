import { describe, expect, it, vi } from "vitest";
import { emptyDraft, type HandoffRecord, type SessionDraft } from "../src/domain.js";
import type { HandoffDb } from "../src/agent/handoff.js";
import { openWorkshopDb, seedTenant } from "./sqlite-db.js";
import { handleVisitorMessage } from "../src/agent/handle-request.js";
import { handleFetch, type AppBindings } from "../src/routes.js";
import { readPriceTable } from "../src/mcp/read-table.js";
import { namedTenantFrom, outOfCreditsReply, tenantIdFrom, tenantNotFoundReply } from "../src/workshop/credits.js";
import { projectMonthly } from "../src/workshop/cost-projection.js";
import { readEstimateFlags, resolveSample } from "../scripts/cost-estimate.js";
import { isPeakUtc, priceTokens, readTokenUsage, zeroUsage } from "../src/workshop/token-usage.js";

const offPeak = new Date("2026-10-06T12:30:00.000Z");
const peak = new Date("2026-10-06T03:00:00.000Z");

async function ask(
  text: string,
  options: { apiKey?: string; creditsRemaining?: number; now?: Date; draft?: SessionDraft } = {},
) {
  const fetchImpl = vi.fn<typeof fetch>();
  const claimed: HandoffRecord[] = [];
  const result = await handleVisitorMessage({
    text,
    draft: options.draft ?? emptyDraft(),
    readTable: (commodityId, dateToken) => readPriceTable({ source: "mock", commodityId, dateToken }),
    writeHandoff: async (row) => {
      claimed.push(row);
    },
    apiKey: options.apiKey,
    fetchImpl,
    creditsRemaining: options.creditsRemaining,
    now: options.now ?? offPeak,
    requestId: "req-workshop",
  });
  return { result, fetchImpl, claimed };
}

function completion(usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }) {
  return Response.json({
    choices: [{ message: { content: "Pada tanggal perdagangan 2026-10-05, harga Beras di DKI Jakarta adalah Rp16.950 per kg." } }],
    usage,
  });
}

describe("token usage", () => {
  it("prices the catalog windows and keeps the API total", () => {
    expect(isPeakUtc(peak)).toBe(true);
    expect(isPeakUtc(new Date("2026-10-06T01:00:00.000Z"))).toBe(true);
    expect(isPeakUtc(new Date("2026-10-06T06:00:00.000Z"))).toBe(true);
    expect(isPeakUtc(new Date("2026-10-06T04:00:00.000Z"))).toBe(false);
    expect(isPeakUtc(new Date("2026-10-06T10:00:00.000Z"))).toBe(false);
    expect(isPeakUtc(offPeak)).toBe(false);

    const body = { usage: { prompt_tokens: 180, completion_tokens: 60, total_tokens: 240 } };
    expect(readTokenUsage(body, offPeak)).toEqual({
      promptTokens: 180,
      completionTokens: 60,
      totalTokens: 240,
      reasoningTokens: 0,
      estCostUsd: 0.00006006,
      estCostIdr: 1,
    });
    expect(readTokenUsage(body, peak)).toEqual({
      promptTokens: 180,
      completionTokens: 60,
      totalTokens: 240,
      reasoningTokens: 0,
      estCostUsd: 0.00012012,
      estCostIdr: 2,
    });
    const withReasoning = {
      usage: {
        prompt_tokens: 180,
        completion_tokens: 850,
        total_tokens: 1030,
        completion_tokens_details: { reasoning_tokens: 822 },
      },
    };
    const priced = readTokenUsage(withReasoning, offPeak);
    expect(priced.reasoningTokens).toBe(822);
    expect(priced.totalTokens).toBe(1030);
    expect(readTokenUsage({ usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 99 } }, offPeak).totalTokens).toBe(99);
    expect(readTokenUsage({})).toEqual(zeroUsage());
    expect(priceTokens(1_000_000, 0, 1_000_000, offPeak).estCostUsd).toBe(0.143);
  });

  it("stores zero tokens on a refusal and on a casual claim", async () => {
    const refused = await ask("How do I cook rice?", { creditsRemaining: 0, apiKey: "test-key" });
    expect(refused.result.outcome).toBe("refusal");
    expect(refused.result.usage).toEqual(zeroUsage());
    expect(refused.result.modelCalled).toBe(false);
    expect(refused.fetchImpl).not.toHaveBeenCalled();

    const claimed = await ask("Di pasar dekat rumah saya beras cuma 10 ribu", { creditsRemaining: 0, apiKey: "test-key" });
    expect(claimed.result.outcome).toBe("handoff");
    expect(claimed.result.usage).toEqual(zeroUsage());
    expect(claimed.result.modelCalled).toBe(false);
    expect(claimed.fetchImpl).not.toHaveBeenCalled();
    expect(claimed.claimed[0]?.claimedPrice).toBe(10000);
  });

  it("reads usage from a model reply", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => completion({ prompt_tokens: 180, completion_tokens: 60, total_tokens: 240 }));
    const result = await handleVisitorMessage({
      text: "harga beras di Jakarta",
      draft: emptyDraft(),
      readTable: (commodityId, dateToken) => readPriceTable({ source: "mock", commodityId, dateToken }),
      writeHandoff: async () => undefined,
      apiKey: "test-key",
      fetchImpl,
      creditsRemaining: 5_000,
      now: offPeak,
      requestId: "req-usage",
    });
    expect(result.modelCalled).toBe(true);
    expect(result.usage).toMatchObject({
      promptTokens: 180,
      completionTokens: 60,
      totalTokens: 240,
      estCostUsd: 0.00006006,
      estCostIdr: 1,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe("tenant credits", () => {
  it("uses the demo tenant unless the header is a short slug", () => {
    expect(tenantIdFrom(new Request("http://local/chat"))).toBe("demo");
    expect(tenantIdFrom(new Request("http://local/chat", { headers: { "x-tenant-id": "ACME_1" } }))).toBe("acme_1");
    expect(tenantIdFrom(new Request("http://local/chat", { headers: { "x-tenant-id": "../etc" } }))).toBe("demo");
    expect(namedTenantFrom(new Request("http://local/chat"))).toBeNull();
    expect(namedTenantFrom(new Request("http://local/chat", { headers: { "x-tenant-id": "Sim-Day" } }))).toBe("sim-day");
    expect(namedTenantFrom(new Request("http://local/chat", { headers: { "x-tenant-id": "../etc" } }))).toBeNull();
  });

  it("refuses a price question in the visitor's language and does not call the model", async () => {
    const indonesian = await ask("harga beras di Jakarta", { apiKey: "test-key", creditsRemaining: 0 });
    expect(indonesian.result.outcome).toBe("402");
    expect(indonesian.result.log.errorClass).toBe("out_of_credits");
    expect(indonesian.result.log.wordingMs).toBe(0);
    expect(indonesian.result.reply).toBe(outOfCreditsReply("id"));
    expect(indonesian.result.usage).toEqual(zeroUsage());
    expect(indonesian.fetchImpl).not.toHaveBeenCalled();

    const english = await ask("What's the price of rice in Jakarta?", { apiKey: "test-key", creditsRemaining: 0 });
    expect(english.result.reply).toBe(outOfCreditsReply("en"));
    expect(english.fetchImpl).not.toHaveBeenCalled();
  });

  it("still answers from the template when no API key is configured", async () => {
    const { result, fetchImpl } = await ask("harga beras di Jakarta", { creditsRemaining: 0 });
    expect(result.outcome).toBe("answered");
    expect(result.reply).toContain("Rp16.950");
    expect(result.modelCalled).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("cost projection", () => {
  it("prints 1,000, 10,000, and 100,000 chats and says refusals are free", () => {
    const text = projectMonthly({ promptTokens: 1_000_000, completionTokens: 0, modelShare: 1 });
    expect(text).toContain("1,000");
    expect(text).toContain("10,000");
    expect(text).toContain("100,000");
    expect(text).toContain("Refusals and claims are free.");
    expect(text).toContain("not a live FX quote");
    expect(text).toContain("$143.00");
    expect(text).toContain("Rp2,359,500");
  });

  it("reads CLI flags without touching D1", () => {
    expect(readEstimateFlags(["--prompt", "180", "--completion", "60", "--share", "0.4"])).toEqual({
      prompt: 180,
      completion: 60,
      share: 0.4,
    });
    const sample = resolveSample({ prompt: 180, completion: 60 });
    expect(sample.note).toContain("CLI flags");
    expect(sample.modelShare).toBe(0.4);
    expect(() => resolveSample({ prompt: 10 })).toThrow(/both/);
  });
});

function app(db: HandoffDb, extra: Partial<AppBindings> = {}): AppBindings {
  return {
    PRICE_SOURCE: "mock",
    DB: db,
    ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
    WORKSHOP_KEY: "workshop-test-key",
    ...extra,
  };
}

async function postChat(env: AppBindings, text: string, headers: Record<string, string> = {}) {
  return handleFetch(
    new Request("http://local/chat", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ text }),
    }),
    env,
    async () => new Response("mcp unused", { status: 500 }),
  );
}

describe("chat route", () => {
  it("keeps an empty message free of the database", async () => {
    const env = {
      PRICE_SOURCE: "mock",
      DB: { prepare: () => { throw new Error("unused"); } },
      ASSETS: { fetch: async () => new Response() },
    } as unknown as AppBindings;
    const response = await handleFetch(
      new Request("http://local/chat", { method: "POST", body: JSON.stringify({ text: " " }) }),
      env,
      async () => new Response(),
    );
    expect(response.status).toBe(400);
  });

  it("logs a free refusal and serves tokens plus credits only with the workshop key", async () => {
    const { db, sqlite } = openWorkshopDb();
    const env = app(db);
    const response = await postChat(env, "How do I cook rice?");
    expect(response.status).toBe(200);
    const body = await response.json() as { reply: string; outcome: string };
    expect(body.outcome).toBe("refusal");
    expect(body).not.toHaveProperty("usage");
    expect(body).not.toHaveProperty("credits");
    expect(body).not.toHaveProperty("balance_tokens");
    expect(sqlite.prepare("SELECT balance FROM tenant_credit WHERE tenant_id = 'demo'").get()).toMatchObject({ balance: 50_000 });
    expect(JSON.stringify(sqlite.prepare("SELECT * FROM request_usage").all())).not.toContain("cook");

    const hidden = await handleFetch(new Request("http://local/credits"), env, async () => new Response());
    expect(hidden.status).toBe(401);
    const shown = await handleFetch(
      new Request("http://local/credits", { headers: { "x-workshop-key": "workshop-test-key" } }),
      env,
      async () => new Response(),
    );
    expect(shown.status).toBe(200);
    const listed = await shown.json() as { credits: { tenantId: string; tokens: number; credits: number }[] };
    expect(listed.credits).toEqual([{ tenantId: "demo", tokens: 50_000, credits: 50 }]);
  });

  it("deducts the actual tokens, then returns 402 under two credits without a model call", async () => {
    const { db, sqlite } = openWorkshopDb();
    seedTenant(sqlite, "low", 5_000);
    seedTenant(sqlite, "thin", 1_000);
    const env = app(db, { ASTRAFLOW_API_KEY: "test-key" });
    const fetchImpl = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("api-sg.umodelverse.ai")) {
        return Promise.resolve(completion({ prompt_tokens: 180, completion_tokens: 60, total_tokens: 240 }));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    try {
      const first = await postChat(env, "harga beras di Jakarta", { "x-tenant-id": "low" });
      expect(first.status).toBe(200);
      const answered = await first.json() as { reply: string; outcome: string };
      expect(answered.outcome).toBe("answered");
      expect(answered).not.toHaveProperty("usage");
      expect(answered).not.toHaveProperty("credits_left");
      expect(sqlite.prepare("SELECT balance FROM tenant_credit WHERE tenant_id = 'low'").get()).toMatchObject({ balance: 4_760 });
      expect(sqlite.prepare("SELECT total_tokens, est_cost_usd FROM request_usage WHERE tenant_id = 'low'").get()).toMatchObject({
        total_tokens: 240,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      const refused = await postChat(env, "How do I cook rice?", { "x-tenant-id": "low" });
      expect(refused.status).toBe(200);
      expect(sqlite.prepare("SELECT balance FROM tenant_credit WHERE tenant_id = 'low'").get()).toMatchObject({ balance: 4_760 });

      const blocked = await postChat(env, "What's the price of rice in Jakarta?", { "x-tenant-id": "thin" });
      expect(blocked.status).toBe(402);
      const body = await blocked.json() as { outcome: string; reply: string };
      expect(body.outcome).toBe("402");
      expect(body.reply).toBe(outOfCreditsReply("en"));
      expect(body.reply.toLowerCase()).not.toContain("kredit");
      expect(body.reply.toLowerCase()).not.toContain("credit");
      expect(body.reply.toLowerCase()).not.toContain("admin");
      expect(sqlite.prepare("SELECT balance FROM tenant_credit WHERE tenant_id = 'thin'").get()).toMatchObject({ balance: 1_000 });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const stored = JSON.stringify(sqlite.prepare("SELECT * FROM request_usage").all());
      expect(stored).not.toContain("Jakarta");
      expect(stored).toContain("180");
      expect(stored).toContain("402");
    } finally {
      fetchImpl.mockRestore();
    }
  });

  it("returns not-found for a named tenant that does not exist and creates nothing", async () => {
    const { db, sqlite } = openWorkshopDb();
    const env = app(db, { ASTRAFLOW_API_KEY: "test-key" });
    const fetchImpl = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = input instanceof Request ? input.url : String(input);
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    try {
      const before = sqlite.prepare("SELECT COUNT(*) AS n FROM tenant_credit").get() as { n: number };
      const indonesian = await postChat(env, "harga beras di Jakarta", { "x-tenant-id": "sim-missing" });
      expect(indonesian.status).toBe(404);
      const idBody = await indonesian.json() as { reply: string; outcome: string };
      expect(idBody.reply).toBe(tenantNotFoundReply("id"));
      expect(idBody.outcome).toBe("refusal");
      expect(idBody).not.toHaveProperty("balance_tokens");

      const english = await postChat(env, "What's the price of rice?", { "x-tenant-id": "sim-missing" });
      expect(english.status).toBe(404);
      const enBody = await english.json() as { reply: string };
      expect(enBody.reply).toBe(tenantNotFoundReply("en"));

      const after = sqlite.prepare("SELECT COUNT(*) AS n FROM tenant_credit").get() as { n: number };
      expect(after.n).toBe(before.n);
      expect(sqlite.prepare("SELECT tenant_id FROM tenant_credit WHERE tenant_id = 'sim-missing'").get()).toBeUndefined();
      expect(sqlite.prepare("SELECT COUNT(*) AS n FROM request_usage").get()).toMatchObject({ n: 0 });
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      fetchImpl.mockRestore();
    }
  });
});
