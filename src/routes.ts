import { emptyDraft, type PublicPriceFact, type SessionDraft } from "./domain.js";
import { handleVisitorMessage } from "./agent/handle-request.js";
import { insertHandoff, listHandoffs, type HandoffDb } from "./agent/handoff.js";
import { formatRequestLog } from "./agent/log.js";
import { workshopKeyMatches } from "./agent/workshop-key.js";
import { readTableThroughMcp } from "./mcp/client.js";

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
    return Response.json({ reply: "Tulis pertanyaan harga.", draft, outcome: "refusal" }, { status: 400 });
  }
  const result = await handleVisitorMessage({
    text,
    draft,
    readTable: (commodityId, dateToken) => readTableThroughMcp(env, commodityId, dateToken),
    writeHandoff: (row) => insertHandoff(env.DB, row),
    apiKey: env.ASTRAFLOW_API_KEY,
    model: env.ASTRAFLOW_MODEL,
    fetchImpl: guardedFetch(env.ASTRAFLOW_API_KEY),
  });
  console.log(formatRequestLog(result.log));
  return Response.json({ reply: result.reply, draft: result.draft, outcome: result.outcome });
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

function guardedFetch(apiKey: string | undefined): typeof fetch {
  return (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!apiKey && url.includes("api-sg.umodelverse.ai")) {
      return Promise.reject(new Error("AstraFlow is not configured"));
    }
    return fetch(input, init);
  };
}
