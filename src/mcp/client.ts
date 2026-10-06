import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ReadResult } from "../domain.js";
import { handleMcp, type McpBindings } from "./server.js";

/** Read a price table by calling this Worker's MCP endpoint. The raw message is not an argument. */
export async function readTableThroughMcp(
  env: McpBindings,
  commodityId: string,
  dateToken: string,
): Promise<ReadResult> {
  const client = new Client({ name: "dukungan-monitor-pangan", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("https://monitor-pangan.internal/mcp"), {
    fetch: (input, init) => handleMcp(new Request(input, init), env),
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: "baca_tabel_harga",
      arguments: { komoditas: commodityId, tanggal_perdagangan: dateToken },
    });
    const text = textContent(result.content);
    const parsed: unknown = JSON.parse(text);
    if (!isReadResult(parsed)) {
      return { ok: false, error: "read_failed" };
    }
    return parsed;
  } finally {
    await client.close().catch(() => undefined);
  }
}

function textContent(content: unknown): string {
  if (!Array.isArray(content)) {
    throw new Error("mcp tool returned no content");
  }
  const first = content[0];
  if (typeof first !== "object" || first === null || !("text" in first) || typeof first.text !== "string") {
    throw new Error("mcp tool returned no text");
  }
  return first.text;
}

function isReadResult(value: unknown): value is ReadResult {
  if (typeof value !== "object" || value === null || !("ok" in value)) {
    return false;
  }
  const record = value as { ok: boolean };
  return typeof record.ok === "boolean";
}
