import { emptyDraft, type PublicPriceFact, type SessionDraft } from "./domain.js";
import { replies, replyLanguage } from "./agent/language.js";
import { handleVisitorMessage } from "./agent/handle-request.js";
import { insertHandoff, listHandoffs, type HandoffDb } from "./agent/handoff.js";
import { formatRequestLog } from "./agent/log.js";
import { workshopKeyMatches } from "./agent/workshop-key.js";
import { adminAuthorized, unauthorized } from "./admin/auth.js";
import { renderAdmin, type AdminNotice } from "./admin/page.js";
import { loadDashboard } from "./admin/queries.js";
import { readTableThroughMcp } from "./mcp/client.js";
import { chargeCredits, createTenant, topUpFake } from "./workshop/charge-credits.js";
import { creditChargeView, isTenantSlug, listCredits, parseCreditCount, readBalance, tenantIdFrom } from "./workshop/credits.js";
import { isPeakUtc } from "./workshop/token-usage.js";
import { insertRequestUsage } from "./workshop/usage-log.js";

export type AppBindings = {
  PRICE_SOURCE: string;
  DB: HandoffDb;
  ASSETS: { fetch(request: Request): Promise<Response> };
  ASTRAFLOW_API_KEY?: string;
  ASTRAFLOW_MODEL?: string;
  WORKSHOP_KEY?: string;
};

/** Route chat, MCP, and the handler list. The chat page is a static asset. */
export async function handleFetch(request: Request, env: AppBindings, mcp: (request: Request) => Promise<Response>): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/mcp") {
    return mcp(request);
  }
  if (url.pathname === "/chat" && request.method === "POST") {
    return handleChat(request, env);
  }
  if (url.pathname === "/handoff" && request.method === "GET") {
    return handleHandoff(request, env);
  }
  if (url.pathname === "/credits" && request.method === "GET") {
    return handleCredits(request, env);
  }
  if (url.pathname === "/admin" && request.method === "GET") {
    return handleAdmin(request, env, url);
  }
  if (url.pathname === "/admin/topup" && request.method === "POST") {
    return handleTopup(request, env);
  }
  if (url.pathname === "/admin/tenant" && request.method === "POST") {
    return handleNewTenant(request, env);
  }
  if (request.method === "GET" || request.method === "HEAD") {
    return env.ASSETS.fetch(request);
  }
  return new Response("Not found", { status: 404 });
}

async function handleChat(request: Request, env: AppBindings): Promise<Response> {
  const body: unknown = await request.json().catch(() => null);
  const text = typeof body === "object" && body !== null && "text" in body && typeof body.text === "string" ? body.text : "";
  const draft = sanitizeDraft(body);
  if (text.trim() === "") {
    return Response.json({ reply: replies[replyLanguage(text)].empty, draft, outcome: "refusal" }, { status: 400 });
  }
  // Workshop: usage and credits. Remove with src/workshop/.
  const tenantId = tenantIdFrom(request);
  const balance = await readBalance(env.DB, tenantId);
  const result = await handleVisitorMessage({
    text,
    draft,
    readTable: (commodityId, dateToken) => readTableThroughMcp(env, commodityId, dateToken),
    writeHandoff: (row) => insertHandoff(env.DB, row),
    apiKey: env.ASTRAFLOW_API_KEY,
    model: env.ASTRAFLOW_MODEL,
    fetchImpl: guardedFetch(env.ASTRAFLOW_API_KEY),
    creditsRemaining: balance,
  });
  const charge = result.modelCalled
    ? await chargeCredits(env.DB, tenantId, result.usage, result.log.requestId, result.log.time)
    : { chargedTokens: 0, overdraftTokens: 0, balanceTokens: balance };
  await insertRequestUsage(env.DB, result.log, {
    usage: result.usage,
    tenantId,
    chargedTokens: charge.chargedTokens,
    overdraftTokens: charge.overdraftTokens,
    peak: isPeakUtc(new Date(result.log.time)),
  });
  console.log(formatRequestLog(result.log));
  const status = result.outcome === "402" ? 402 : 200;
  return Response.json({
    reply: result.reply,
    draft: result.draft,
    outcome: result.outcome,
    usage: result.usage,
    credits: creditChargeView(tenantId, charge.balanceTokens, charge.chargedTokens),
  }, { status });
}

async function handleCredits(request: Request, env: AppBindings): Promise<Response> {
  const provided = request.headers.get("x-workshop-key") ?? "";
  const allowed = await workshopKeyMatches(provided, env.WORKSHOP_KEY ?? "");
  if (!allowed) {
    return new Response("Unauthorized", { status: 401 });
  }
  return Response.json({ credits: await listCredits(env.DB) });
}

async function handleHandoff(request: Request, env: AppBindings): Promise<Response> {
  const provided = request.headers.get("x-workshop-key") ?? "";
  const allowed = await workshopKeyMatches(provided, env.WORKSHOP_KEY ?? "");
  if (!allowed) {
    return new Response("Unauthorized", { status: 401 });
  }
  const rows = await listHandoffs(env.DB);
  return Response.json({ handoffs: rows });
}

function sanitizeDraft(body: unknown): SessionDraft {
  if (typeof body !== "object" || body === null || !("draft" in body) || typeof body.draft !== "object" || body.draft === null) {
    return emptyDraft();
  }
  const draft = body.draft as Record<string, unknown>;
  const facts = Array.isArray(draft.facts)
    ? draft.facts.flatMap((entry) => {
        if (typeof entry !== "object" || entry === null) {
          return [];
        }
        const row = entry as Record<string, unknown>;
        if (typeof row.komoditas !== "string" || typeof row.provinsi !== "string" || typeof row.harga !== "number") {
          return [];
        }
        const satuan: PublicPriceFact["satuan"] = row.satuan === "liter" ? "liter" : "kg";
        const fact: PublicPriceFact = { komoditas: row.komoditas, provinsi: row.provinsi, harga: row.harga, satuan };
        return [fact];
      })
    : [];
  return {
    commodity: typeof draft.commodity === "string" ? draft.commodity : null,
    provinces: Array.isArray(draft.provinces) ? draft.provinces.filter((province) => typeof province === "string") : [],
    tradingDate: typeof draft.tradingDate === "string" ? draft.tradingDate : null,
    facts,
    claimedPrice: typeof draft.claimedPrice === "number" ? draft.claimedPrice : null,
  };
}

async function handleAdmin(request: Request, env: AppBindings, url: URL): Promise<Response> {
  if (!(await adminAuthorized(request, env.WORKSHOP_KEY ?? ""))) {
    return unauthorized();
  }
  const dashboard = await loadDashboard(env.DB, new Date());
  return new Response(renderAdmin(dashboard, noticeFrom(url)), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

async function handleTopup(request: Request, env: AppBindings): Promise<Response> {
  if (!(await adminAuthorized(request, env.WORKSHOP_KEY ?? ""))) {
    return unauthorized();
  }
  const form = await readAdminForm(request);
  const credits = parseCreditCount(form.credits, false);
  if (!isTenantSlug(form.tenant) || credits === null) {
    return redirectAdmin("invalid", "", 0);
  }
  await topUpFake(env.DB, form.tenant, credits, new Date().toISOString());
  return redirectAdmin("topped", form.tenant, credits);
}

async function handleNewTenant(request: Request, env: AppBindings): Promise<Response> {
  if (!(await adminAuthorized(request, env.WORKSHOP_KEY ?? ""))) {
    return unauthorized();
  }
  const form = await readAdminForm(request);
  const credits = parseCreditCount(form.credits, true);
  if (!isTenantSlug(form.tenant) || credits === null) {
    return redirectAdmin("invalid", "", 0);
  }
  const created = await createTenant(env.DB, form.tenant, credits, new Date().toISOString());
  if (created === "exists") {
    return redirectAdmin("exists", form.tenant, credits);
  }
  return redirectAdmin("created", form.tenant, credits);
}

async function readAdminForm(request: Request): Promise<{ tenant: string; credits: string }> {
  const form = await request.formData();
  return {
    tenant: String(form.get("tenant") ?? "").trim().toLowerCase(),
    credits: String(form.get("credits") ?? ""),
  };
}

function redirectAdmin(notice: string, tenant: string, credits: number): Response {
  const query = new URLSearchParams({ notice });
  if (tenant) {
    query.set("tenant", tenant);
    query.set("credits", String(credits));
  }
  return new Response(null, {
    status: 303,
    headers: { location: `/admin?${query}`, "cache-control": "no-store" },
  });
}

function noticeFrom(url: URL): AdminNotice {
  const kind = url.searchParams.get("notice");
  if (kind === "invalid") {
    return { kind: "invalid" };
  }
  const tenantId = url.searchParams.get("tenant") ?? "";
  const credits = Number(url.searchParams.get("credits"));
  if (!isTenantSlug(tenantId) || !Number.isInteger(credits)) {
    return null;
  }
  switch (kind) {
    case "topped":
    case "created":
      return { kind, tenantId, credits };
    case "exists":
      return { kind, tenantId };
    default:
      return null;
  }
}

function guardedFetch(apiKey: string | undefined): typeof fetch {
  return (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!apiKey && url.includes("api-sg.umodelverse.ai")) {
      return Promise.reject(new Error("AstraFlow is not configured"));
    }
    return fetch(input, init);
  };
}
