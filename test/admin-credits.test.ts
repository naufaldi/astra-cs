import { describe, expect, it, vi } from "vitest";
import { renderAdmin } from "../src/admin/page.js";
import { loadDashboard, totalsFrom } from "../src/admin/queries.js";
import { handleFetch, type AppBindings } from "../src/routes.js";
import { handleVisitorMessage } from "../src/agent/handle-request.js";
import { emptyDraft } from "../src/domain.js";
import { readPriceTable } from "../src/mcp/read-table.js";
import { ledgerGap, passesCreditGate, planCharge } from "../src/workshop/charge-credits.js";
import { CREDIT_PRICE_IDR, tokensToSen } from "../src/workshop/credit-price.js";
import { estimateCost, modelPrice } from "../src/workshop/token-usage.js";
import { openWorkshopDb, seedTenant } from "./sqlite-db.js";

const offPeak = new Date("2026-10-06T12:30:00.000Z");
const peak = new Date("2026-10-06T03:00:00.000Z");

function basic(password: string): string {
  return `Basic ${Buffer.from(`owner:${password}`).toString("base64")}`;
}

function app(db: AppBindings["DB"], extra: Partial<AppBindings> = {}): AppBindings {
  return {
    PRICE_SOURCE: "mock",
    DB: db,
    ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
    WORKSHOP_KEY: "workshop-test-key",
    ...extra,
  };
}

function completion(total: number) {
  return Response.json({
    choices: [{ message: { content: "Pada tanggal perdagangan 2026-10-05, harga Beras di DKI Jakarta adalah Rp16.950 per kg." } }],
    usage: { prompt_tokens: 180, completion_tokens: total - 180, total_tokens: total, completion_tokens_details: { reasoning_tokens: 40 } },
  });
}

async function postChat(env: AppBindings, text: string, headers: Record<string, string> = {}) {
  return handleFetch(
    new Request("http://local/chat", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ text }),
    }),
    env,
    async () => new Response("mcp"),
  );
}

async function postForm(env: AppBindings, path: string, fields: Record<string, string>) {
  return handleFetch(
    new Request(`http://local${path}`, {
      method: "POST",
      headers: {
        authorization: basic("workshop-test-key"),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(fields),
    }),
    env,
    async () => new Response("mcp"),
  );
}

describe("credit charge math", () => {
  it("prices peak at twice the off-peak cost and still charges the same tokens", () => {
    expect(CREDIT_PRICE_IDR).toBe(100);
    expect(modelPrice.peak.inputPerMillionUsd).toBe(modelPrice.offPeak.inputPerMillionUsd * 2);
    expect(modelPrice.peak.outputPerMillionUsd).toBe(modelPrice.offPeak.outputPerMillionUsd * 2);
    const usage = { promptTokens: 180, completionTokens: 60 };
    expect(estimateCost(usage, false)).toEqual({ estCostUsd: 0.00006006, estCostIdr: 1 });
    expect(estimateCost(usage, true)).toEqual({ estCostUsd: 0.00012012, estCostIdr: 2 });
    const charge = planCharge(50_000, 240);
    expect(charge.chargedTokens).toBe(240);
    expect(charge.chargedCredits).toBe(0.24);
    expect(charge.overdraftTokens).toBe(0);
    expect(tokensToSen(240)).toBe(2_400);
  });

  it("opens the gate at 2,000 tokens and floors an overdraft at zero", () => {
    expect(passesCreditGate(1_999)).toBe(false);
    expect(passesCreditGate(2_000)).toBe(true);
    const overdraft = planCharge(2_500, 4_000);
    expect(overdraft).toMatchObject({ chargedTokens: 2_500, overdraftTokens: 1_500, balanceTokens: 0 });
  });

  it("blocks a price question under 2 credits and still allows one at the line", async () => {
    const blocked = await handleVisitorMessage({
      text: "harga beras di Jakarta",
      draft: emptyDraft(),
      readTable: (commodityId, dateToken) => readPriceTable({ source: "mock", commodityId, dateToken }),
      writeHandoff: async () => undefined,
      apiKey: "test-key",
      fetchImpl: vi.fn<typeof fetch>(),
      creditsRemaining: 1_999,
      now: offPeak,
      requestId: "req-gate",
    });
    expect(blocked.outcome).toBe("402");
    expect(blocked.modelCalled).toBe(false);

    const fetchImpl = vi.fn<typeof fetch>(async () => completion(240));
    const allowed = await handleVisitorMessage({
      text: "harga beras di Jakarta",
      draft: emptyDraft(),
      readTable: (commodityId, dateToken) => readPriceTable({ source: "mock", commodityId, dateToken }),
      writeHandoff: async () => undefined,
      apiKey: "test-key",
      fetchImpl,
      creditsRemaining: 2_000,
      now: peak,
      requestId: "req-open",
    });
    expect(allowed.modelCalled).toBe(true);
    expect(allowed.usage.estCostIdr).toBe(2);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe("ledger and admin", () => {
  it("keeps the demo grant equal to the balance", async () => {
    const { db, sqlite } = openWorkshopDb();
    expect(sqlite.prepare("SELECT balance FROM tenant_credit WHERE tenant_id = 'demo'").get()).toMatchObject({ balance: 50_000 });
    expect(await ledgerGap(db)).toBe(0);
  });

  it("reconciles a peak charge, a top-up, and a new tenant with the ledger", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(peak);
    const { db, sqlite } = openWorkshopDb();
    seedTenant(sqlite, "low", 2_500);
    const env = app(db, { ASTRAFLOW_API_KEY: "test-key" });
    const fetchImpl = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("api-sg.umodelverse.ai")) {
        return Promise.resolve(completion(240));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    try {
      const priced = await postChat(env, "harga beras di Jakarta", { "x-tenant-id": "low" });
      expect(priced.status).toBe(200);
      const body = await priced.json() as { credits: { chargedTokens: number; tokens: number }; usage: { estCostUsd: number; estCostIdr: number } };
      expect(body.credits.chargedTokens).toBe(240);
      expect(body.credits.tokens).toBe(2_260);
      expect(body.usage).toMatchObject({ estCostUsd: 0.00006006 * 2, estCostIdr: 2 });
      const ledger = sqlite.prepare("SELECT delta_tokens, reason, idr_amount, chat_ref FROM credit_ledger WHERE tenant_id = 'low' AND reason = 'usage'").get() as {
        delta_tokens: number;
        reason: string;
        idr_amount: number;
      };
      expect(ledger).toMatchObject({ delta_tokens: -240, reason: "usage", idr_amount: 2_400 });
      const usage = sqlite.prepare("SELECT total_tokens, charged_tokens, peak, reasoning_tokens, outcome FROM request_usage WHERE tenant_id = 'low'").get() as {
        total_tokens: number;
        charged_tokens: number;
        peak: number;
        reasoning_tokens: number;
        outcome: string;
      };
      expect(usage).toMatchObject({ total_tokens: 240, charged_tokens: 240, peak: 1, reasoning_tokens: 40, outcome: "answered" });

      const topped = await postForm(env, "/admin/topup", { tenant: "demo", credits: "5" });
      expect(topped.status).toBe(303);
      expect(topped.headers.get("location")).toContain("notice=topped");
      expect(sqlite.prepare("SELECT balance FROM tenant_credit WHERE tenant_id = 'demo'").get()).toMatchObject({ balance: 55_000 });
      expect(sqlite.prepare("SELECT delta_tokens, idr_amount FROM credit_ledger WHERE reason = 'topup_fake'").get()).toMatchObject({
        delta_tokens: 5_000,
        idr_amount: 50_000,
      });

      const created = await postForm(env, "/admin/tenant", { tenant: "kios", credits: "10" });
      expect(created.status).toBe(303);
      const fresh = await postChat(env, "harga beras di Jakarta", { "x-tenant-id": "kios" });
      expect(fresh.status).toBe(200);
      expect(await ledgerGap(db)).toBe(0);

      const dashboard = await loadDashboard(db, new Date());
      const charged = 480;
      expect(dashboard.allTime.chargedTokens).toBe(charged);
      expect(dashboard.allTime.creditsUsed).toBeCloseTo(charged / 1_000, 5);
      expect(dashboard.allTime.earnedIdr).toBe((charged * CREDIT_PRICE_IDR) / 1_000);
      expect(dashboard.allTime.marginIdr).toBe(dashboard.allTime.earnedIdr - dashboard.allTime.costIdr);
      expect(dashboard.allTime.cashInIdr).toBe(500);
      const low = dashboard.tenants.find((row) => row.tenantId === "low");
      expect(low?.balanceTokens).toBe(2_260);
      expect(low?.earnedIdr).toBe((240 * CREDIT_PRICE_IDR) / 1_000);
      expect(totalsFrom(dashboard.allTime.tokens, dashboard.allTime.chargedTokens, dashboard.allTime.costIdr, 500).marginIdr).toBe(dashboard.allTime.marginIdr);

      const page = await handleFetch(
        new Request("http://local/admin?notice=topped&tenant=demo&credits=5", { headers: { authorization: basic("workshop-test-key") } }),
        env,
        async () => new Response("mcp"),
      );
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain("Added 5.00 credits to demo.");
      expect(html).not.toContain("workshop-test-key");
      expect(html).not.toContain("<script>");
    } finally {
      fetchImpl.mockRestore();
      vi.useRealTimers();
    }
  });

  it("logs an overdraft when the reply costs more than the remaining tokens", async () => {
    const { db, sqlite } = openWorkshopDb();
    seedTenant(sqlite, "edge", 2_100);
    const env = app(db, { ASTRAFLOW_API_KEY: "test-key" });
    const fetchImpl = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("api-sg.umodelverse.ai")) {
        return Promise.resolve(completion(4_000));
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    try {
      const response = await postChat(env, "harga beras di Jakarta", { "x-tenant-id": "edge" });
      expect(response.status).toBe(200);
      const body = await response.json() as { credits: { chargedTokens: number; tokens: number } };
      expect(body.credits).toMatchObject({ chargedTokens: 2_100, tokens: 0 });
      expect(sqlite.prepare("SELECT delta_tokens, overdraft_tokens FROM credit_ledger WHERE reason = 'usage'").get()).toMatchObject({
        delta_tokens: -2_100,
        overdraft_tokens: 1_900,
      });
      expect(await ledgerGap(db)).toBe(0);
    } finally {
      fetchImpl.mockRestore();
    }
  });

  it("returns 401 without the key and lists the same handoffs as D1", async () => {
    const { db, sqlite } = openWorkshopDb();
    const env = app(db);
    const hidden = await handleFetch(new Request("http://local/admin"), env, async () => new Response("mcp"));
    expect(hidden.status).toBe(401);
    expect(hidden.headers.get("www-authenticate")).toContain("Basic");
    const wrong = await handleFetch(
      new Request("http://local/admin", { headers: { authorization: basic("nope") } }),
      env,
      async () => new Response("mcp"),
    );
    expect(wrong.status).toBe(401);

    await postChat(env, "Di pasar dekat rumah saya beras cuma 10 ribu");
    const dashboard = await loadDashboard(db, offPeak);
    const stored = sqlite.prepare("SELECT commodity, province, displayed_price, claimed_price FROM handoff ORDER BY created_at").all() as {
      commodity: string;
      province: string;
      displayed_price: number;
      claimed_price: number;
    }[];
    expect(dashboard.handoffs.map((row) => [row.commodity, row.province, row.displayedPrice, row.claimedPrice])).toEqual(
      stored.map((row) => [row.commodity, row.province, row.displayed_price, row.claimed_price]),
    );
    expect(stored.length).toBeGreaterThan(0);

    const html = renderAdmin(
      {
        ...dashboard,
        handoffs: [{ commodity: "<script>", province: "Aceh", displayedPrice: 1, claimedPrice: 2, createdAt: "t" }],
      },
      null,
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("workshop-test-key");
  });
});
