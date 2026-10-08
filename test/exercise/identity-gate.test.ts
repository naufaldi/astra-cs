import { describe, expect, it } from "vitest";
import { emptyDraft, type HandoffRecord } from "../../src/domain.js";
import { handleVisitorMessage } from "../../src/agent/handle-request.js";
import { formatRequestLog } from "../../src/agent/log.js";
import { readPriceTable } from "../../src/mcp/read-table.js";

describe("identity gate", () => {
  it("keeps a name and a phone out of the wording payload and storage", async () => {
    const handoffs: HandoffRecord[] = [];
    const text = "Berapa harga beras di Aceh? Nama saya Budi, telepon 081234567890";
    const result = await handleVisitorMessage({
      text,
      draft: emptyDraft(),
      readTable: (commodityId, dateToken) => readPriceTable({ source: "mock", commodityId, dateToken }),
      writeHandoff: async (row) => {
        handoffs.push(row);
      },
      now: new Date("2026-10-06T03:00:00.000Z"),
      requestId: "req-identity",
    });
    const payload = JSON.stringify(result.wordingPayload);
    const stored = JSON.stringify({ draft: result.draft, log: formatRequestLog(result.log), handoffs });
    expect(payload).not.toContain("Budi");
    expect(payload).not.toContain("081234567890");
    expect(stored).not.toContain("Budi");
    expect(stored).not.toContain("081234567890");
  });

  it("sends only the resolved facts to the wording call", async () => {
    const result = await handleVisitorMessage({
      text: "What is the price of rice in Aceh? Call me on +62 812 3456 7890",
      draft: emptyDraft(),
      readTable: (commodityId, dateToken) => readPriceTable({ source: "mock", commodityId, dateToken }),
      writeHandoff: async () => undefined,
      now: new Date("2026-10-06T03:00:00.000Z"),
      requestId: "req-phone",
    });
    const user = result.wordingPayload?.messages[1]?.content ?? "";
    expect(JSON.parse(user)).toEqual({
      komoditas: "Beras",
      tanggal: "2026-10-05",
      satuan: "kg",
      baris: { provinsi: "Aceh", harga: 15700, selisihRataRata: -50 },
    });
    expect(JSON.stringify(result.wordingPayload)).not.toContain("812");
  });
});
