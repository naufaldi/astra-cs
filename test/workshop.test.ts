import { describe, expect, it, vi } from "vitest";
import { emptyDraft, type HandoffRecord, type SessionDraft } from "../src/domain.js";
import type { HandoffDb } from "../src/agent/handoff.js";
import { handleVisitorMessage } from "../src/agent/handle-request.js";
import { handleFetch, type AppBindings } from "../src/routes.js";
import { readPriceTable } from "../src/mcp/read-table.js";
import { outOfCreditsReply, tenantIdFrom } from "../src/workshop/credits.js";
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
      estCostUsd: 0.00006006,
      estCostIdr: 1,
    });
    expect(readTokenUsage(body, peak)).toEqual({
      promptTokens: 180,
      completionTokens: 60,
      totalTokens: 240,
      estCostUsd: 0.00012012,
      estCostIdr: 2,
    });
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
      creditsRemaining: 3,
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
  });

  it("refuses a price question in the visitor's language and does not call the model", async () => {
    const indonesian = await ask("harga beras di Jakarta", { apiKey: "test-key", creditsRemaining: 0 });
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

function memoryDb(seed: Record<string, number>) {
  const credits = new Map(Object.entries(seed));
  const usage: unknown[][] = [];
  const db = {
    prepare(query: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async run() {
              if (query.includes("INSERT OR IGNORE INTO tenant_credit")) {
                const id = String(values[0]);
                if (!credits.has(id)) {
                  credits.set(id, Number(values[1]));
                }
              } else if (query.includes("UPDATE tenant_credit")) {
                const id = String(values[0]);
                const current = credits.get(id) ?? 0;
                if (current >= 1) {
                  credits.set(id, current - 1);
                }
              } else if (query.includes("INSERT INTO request_usage")) {
                usage.push(values);
              }
            },
            async all<T>(): Promise<{ results: T[] }> {
              if (query.includes("SELECT balance FROM")) {
                const id = String(values[0]);
                if (!credits.has(id)) {
                  return { results: [] };
                }
                return { results: [{ balance: credits.get(id) }] as T[] };
              }
              if (query.includes("SELECT tenant_id")) {
                const results = [...credits.entries()]
                  .sort(([left], [right]) => left.localeCompare(right))
                  .map(([tenant_id, balance]) => ({ tenant_id, balance }));
                return { results: results as T[] };
              }
              return { results: [] };
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as HandoffDb, credits, usage };
}

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

  it("logs a free refusal and serves the credit list only with the workshop key", async () => {
    const { db, usage, credits } = memoryDb({ demo: 50 });
    const env = app(db);
    const response = await postChat(env, "How do I cook rice?");
    expect(response.status).toBe(200);
    const body = await response.json() as { usage: { totalTokens: number }; credits: { cost: number; remaining: number } };
    expect(body.usage.totalTokens).toBe(0);
    expect(body.credits).toEqual({ tenantId: "demo", remaining: 50, cost: 0 });
    expect(credits.get("demo")).toBe(50);
    expect(JSON.stringify(usage)).not.toContain("cook");

    const hidden = await handleFetch(new Request("http://local/credits"), env, async () => new Response());
    expect(hidden.status).toBe(401);
    const shown = await handleFetch(
      new Request("http://local/credits", { headers: { "x-workshop-key": "workshop-test-key" } }),
      env,
      async () => new Response(),
    );
    expect(shown.status).toBe(200);
    const listed = await shown.json() as { credits: { tenantId: string; balance: number }[] };
    expect(listed.credits).toEqual([{ tenantId: "demo", balance: 50 }]);
  });

  it("spends one credit on a model answer and then refuses without calling the model", async () => {
    const { db, usage } = memoryDb({ low: 1 });
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
      const answered = await first.json() as {
        usage: { promptTokens: number; completionTokens: number; totalTokens: number; estCostUsd: number };
        credits: { tenantId: string; remaining: number; cost: number };
      };
      expect(answered.usage).toMatchObject({ promptTokens: 180, completionTokens: 60, totalTokens: 240 });
      expect(answered.usage.estCostUsd).toBeGreaterThan(0);
      expect(answered.credits).toEqual({ tenantId: "low", remaining: 0, cost: 1 });
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      const refused = await postChat(env, "How do I cook rice?", { "x-tenant-id": "low" });
      expect(refused.status).toBe(200);
      const free = await refused.json() as { credits: { cost: number; remaining: number } };
      expect(free.credits).toEqual({ tenantId: "low", remaining: 0, cost: 0 });

      const blocked = await postChat(env, "What's the price of rice in Jakarta?", { "x-tenant-id": "low" });
      expect(blocked.status).toBe(402);
      const body = await blocked.json() as { reply: string; credits: { cost: number; remaining: number } };
      expect(body.reply).toBe(outOfCreditsReply("en"));
      expect(body.credits).toEqual({ tenantId: "low", remaining: 0, cost: 0 });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(usage)).not.toContain("Jakarta");
      expect(JSON.stringify(usage)).toContain("180");
    } finally {
      fetchImpl.mockRestore();
    }
  });
});
