import { describe, expect, it, vi } from "vitest";
import { handleVisitorMessage } from "../src/agent/handle-request.js";
import { emptyDraft, type PriceTable, type ReadResult, type SessionDraft } from "../src/domain.js";

const now = new Date("2026-10-08T03:00:00.000Z");
const generic = "Sebutkan satu nama komoditas yang terbit di Monitor Pangan.";

function chiliTable(commodityId: string): PriceTable {
  const rawit = commodityId === "cabai-rawit";
  const harga = rawit ? 51250 : 42950;
  return {
    tanggalPerdagangan: "2026-10-08",
    tanggalTerbaru: "2026-10-08",
    komoditas: rawit ? "Cabai Rawit" : "Cabai Merah",
    satuan: "kg",
    rataRata: 70000,
    baris: [{ provinsi: "Jawa Timur", harga, selisihRataRata: harga - 70000 }],
    sumber: "mock",
  };
}

async function ask(text: string, draft: SessionDraft = emptyDraft()) {
  const fetchImpl = vi.fn();
  const reads: string[] = [];
  const result = await handleVisitorMessage({
    text,
    draft,
    readTable: async (commodityId) => {
      reads.push(commodityId);
      if (commodityId !== "cabai-rawit" && commodityId !== "cabai-merah") {
        return { ok: false, error: "unknown_commodity" };
      }
      const table = chiliTable(commodityId);
      const read: ReadResult = { ok: true, table };
      return read;
    },
    writeHandoff: async () => undefined,
    fetchImpl,
    now,
    requestId: "req-follow",
  });
  return { result, fetchImpl, reads };
}

describe("generic commodities", () => {
  it("lists the published chili variants instead of the generic commodity prompt", async () => {
    const named = await ask("harga cabai di jawa timur?");
    expect(named.result.outcome).toBe("refusal");
    expect(named.result.log.errorClass).toBe("ambiguous_commodity");
    expect(named.result.reply).toContain("Cabai Merah");
    expect(named.result.reply).toContain("Cabai Rawit");
    expect(named.result.reply).toContain("Jawa Timur");
    expect(named.result.reply).not.toBe(generic);
    expect(named.result.reply).not.toMatch(/Rp/);
    expect(named.reads).toEqual([]);
    expect(named.fetchImpl).not.toHaveBeenCalled();
    expect(named.result.draft.provinces).toEqual(["Jawa Timur"]);

    const bare = await ask("cabai?");
    expect(bare.result.reply).toContain("Cabai Merah");
    expect(bare.result.reply).toContain("Cabai Rawit");
    expect(bare.result.reply).not.toBe(generic);
    expect(bare.reads).toEqual([]);
  });

  it("lists the published shallot and garlic variants for bawang", async () => {
    const { result, reads } = await ask("bawang?");
    expect(result.reply).toContain("Bawang Merah");
    expect(result.reply).toContain("Bawang Putih");
    expect(result.reply).not.toBe(generic);
    expect(reads).toEqual([]);
  });

  it("still treats beras as the one published rice row", async () => {
    const { result } = await ask("beras?");
    expect(result.log.errorClass).toBe("need_province");
    expect(result.reply).toBe("Sebutkan provinsinya, atau minta yang tertinggi atau terendah.");
    expect(result.draft.commodity).toBe("Beras");
  });
});

describe("draft carries province and commodity", () => {
  it("answers cabai rawit in Jawa Timur after the variant question", async () => {
    const first = await ask("harga cabai di jawa timur?");
    const second = await ask("cabai rawit?", first.result.draft);
    expect(second.result.outcome).toBe("answered");
    expect(second.result.log.errorClass).toBeNull();
    expect(second.result.reply).toContain("Cabai Rawit");
    expect(second.result.reply).toContain("Jawa Timur");
    expect(second.result.reply).toContain("Rp51.250");
    expect(second.result.reply).toContain("2026-10-08");
    expect(second.result.reply).not.toContain("Sebutkan provinsinya");
    expect(second.reads).toEqual(["cabai-rawit"]);
    expect(second.fetchImpl).not.toHaveBeenCalled();
    expect(second.result.draft.commodity).toBe("Cabai Rawit");
    expect(second.result.draft.provinces).toEqual(["Jawa Timur"]);
  });

  it("uses a commodity saved when the province was still missing", async () => {
    const first = await ask("cabai rawit?");
    expect(first.result.log.errorClass).toBe("need_province");
    expect(first.result.draft.commodity).toBe("Cabai Rawit");
    const second = await ask("jawa timur?", first.result.draft);
    expect(second.result.outcome).toBe("answered");
    expect(second.result.reply).toContain("Cabai Rawit");
    expect(second.result.reply).toContain("Jawa Timur");
    expect(second.result.reply).toContain("Rp51.250");
  });
});
