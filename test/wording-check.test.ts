import { describe, expect, it } from "vitest";
import { wordingKeepsFacts } from "../src/agent/check-wording.js";
import type { PhraseFacts } from "../src/agent/select.js";

const base = { date: "2026-10-05", latestDate: "2026-10-05", commodity: "Beras", unit: "kg" as const };
const province: PhraseFacts = {
  kind: "province",
  row: { provinsi: "DKI Jakarta", harga: 16950, selisihRataRata: 550 },
  ...base,
};

describe("wordingKeepsFacts", () => {
  it("accepts the price and an ISO trading date", () => {
    expect(wordingKeepsFacts("Pada tanggal perdagangan 2026-10-05, harga Beras di DKI Jakarta adalah Rp16.950 per kg.", province)).toBe(true);
  });

  it("accepts an Indonesian written date", () => {
    expect(wordingKeepsFacts("Pada 5 Oktober 2026 harga beras di DKI Jakarta Rp16.950 per kg.", province)).toBe(true);
  });

  it("accepts an English written date and a comma separated price", () => {
    expect(wordingKeepsFacts("On October 5, 2026 rice in DKI Jakarta was Rp16,950 per kg.", province)).toBe(true);
    expect(wordingKeepsFacts("On 5 October 2026 rice in DKI Jakarta was Rp16950 per kg.", province)).toBe(true);
  });

  it("rejects a reply with a different price", () => {
    expect(wordingKeepsFacts("Pada tanggal perdagangan 2026-10-05 harga beras Rp17.950 per kg.", province)).toBe(false);
  });

  it("rejects a reply that only contains the price as part of a longer number", () => {
    expect(wordingKeepsFacts("Pada tanggal perdagangan 2026-10-05 harga beras 169500 per kg.", province)).toBe(false);
  });

  it("rejects a reply with no trading date", () => {
    expect(wordingKeepsFacts("Harga beras di DKI Jakarta adalah Rp16.950 per kg.", province)).toBe(false);
  });

  it("rejects a different trading date", () => {
    expect(wordingKeepsFacts("Pada tanggal perdagangan 2026-10-04 harga beras Rp16.950 per kg.", province)).toBe(false);
  });

  it("needs both prices of a comparison", () => {
    const compare: PhraseFacts = {
      kind: "compare",
      left: { provinsi: "Aceh", harga: 15700, selisihRataRata: -50 },
      right: { provinsi: "Jawa Barat", harga: 15600, selisihRataRata: -150 },
      ...base,
    };
    expect(wordingKeepsFacts("2026-10-05: Aceh Rp15.700, Jawa Barat Rp15.600.", compare)).toBe(true);
    expect(wordingKeepsFacts("2026-10-05: Aceh Rp15.700.", compare)).toBe(false);
  });

  it("needs the average when the question compares to it", () => {
    const versus: PhraseFacts = {
      kind: "versusAverage",
      row: { provinsi: "Aceh", harga: 15700, selisihRataRata: -50 },
      average: 15750,
      ...base,
    };
    expect(wordingKeepsFacts("2026-10-05: Aceh Rp15.700, rata-rata Rp15.750.", versus)).toBe(true);
    expect(wordingKeepsFacts("2026-10-05: Aceh Rp15.700.", versus)).toBe(false);
  });

  it("requires the Rp prefix on every price", () => {
    expect(wordingKeepsFacts("Pada 5 Oktober 2026 harga beras di DKI Jakarta 16.950 per kg.", province)).toBe(false);
    expect(wordingKeepsFacts("On October 5, 2026 rice in DKI Jakarta was 16,950 per liter.", province)).toBe(false);
    expect(wordingKeepsFacts("Pada 5 Oktober 2026 harga beras di DKI Jakarta Rp 16.950 per kg.", province)).toBe(true);
    expect(wordingKeepsFacts("Pada 5 Oktober 2026 harga beras di DKI Jakarta Rp.16.950 per kg.", province)).toBe(true);
  });

  it("needs Rp on both prices of a comparison", () => {
    const compare: PhraseFacts = {
      kind: "compare",
      left: { provinsi: "Aceh", harga: 15700, selisihRataRata: -50 },
      right: { provinsi: "Jawa Barat", harga: 15600, selisihRataRata: -150 },
      ...base,
    };
    expect(wordingKeepsFacts("2026-10-05: Aceh Rp15.700, Jawa Barat 15.600.", compare)).toBe(false);
  });
});
