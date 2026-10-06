import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { PriceCache } from "./price-cache.js";
import { readPriceTable } from "./read-table.js";

/** The only arguments the price tool accepts. Visitor text is not one of them. */
export const toolArguments = ["komoditas", "tanggal_perdagangan"] as const;

const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();
const priceCache = new PriceCache();

export type McpBindings = {
  PRICE_SOURCE: string;
};

/** Serve the one price-table tool over Streamable HTTP. */
export async function handleMcp(request: Request, env: McpBindings): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }
  const existingId = request.headers.get("mcp-session-id");
  if (existingId) {
    const existing = sessions.get(existingId);
    if (!existing) {
      return jsonError(404, -32001, "Session not found");
    }
    return existing.handleRequest(request);
  }
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (sessionId) => {
      sessions.set(sessionId, transport);
    },
    onsessionclosed: (sessionId) => {
      sessions.delete(sessionId);
    },
  });
  const server = createPriceServer(env);
  await server.connect(transport);
  return transport.handleRequest(request);
}

function createPriceServer(env: McpBindings): McpServer {
  const server = new McpServer({ name: "monitor-pangan", version: "1.0.0" });
  server.registerTool(
    "baca_tabel_harga",
    {
      title: "Baca tabel harga",
      description: "Return one published price table for a commodity and a trading date.",
      inputSchema: {
        komoditas: z.string().describe("Published commodity id"),
        tanggal_perdagangan: z.string().describe("YYYY-MM-DD or terbaru"),
      },
    },
    async ({ komoditas, tanggal_perdagangan }) => {
      const result = await readPriceTable({
        source: env.PRICE_SOURCE,
        commodityId: komoditas,
        dateToken: tanggal_perdagangan,
        cache: priceCache,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        isError: !result.ok,
      };
    },
  );
  return server;
}

function jsonError(status: number, code: number, message: string): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
