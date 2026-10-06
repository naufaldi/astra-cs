import { nationalAverage, type DatedFreshPayload, type PriceTable, type ReadResult } from "../domain.js";
import { commodityById, provinces } from "./published-names.js";

export function tableFromFresh(
  fresh: DatedFreshPayload,
  commodityId: string,
  dateToken: string,
  sumber: PriceTable["sumber"],
): ReadResult {
  const commodity = commodityById(commodityId);
  if (!commodity) {
    return { ok: false, error: "unknown_commodity" };
  }
  const date = dateToken === "terbaru" ? fresh.latestDate : dateToken;
  if (!fresh.dates.includes(date)) {
    return { ok: false, error: "unpublished_date" };
  }
  const priced = provinces.flatMap((province) => {
    const price = fresh.prices[`${date}:${commodityId}:${province.code}`];
    return typeof price === "number" ? [{ provinsi: province.name, harga: price }] : [];
  });
  const rataRata = nationalAverage(priced.map((row) => row.harga));
  return {
    ok: true,
    table: {
      tanggalPerdagangan: date,
      tanggalTerbaru: fresh.latestDate,
      komoditas: commodity.name,
      satuan: commodity.unit,
      rataRata,
      baris: priced.map((row) => ({
        provinsi: row.provinsi,
        harga: row.harga,
        selisihRataRata: row.harga - rataRata,
      })),
      sumber,
    },
  };
}
