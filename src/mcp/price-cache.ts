import type { PriceTable } from "../domain.js";

/** Public price tables only. A failed read is never inserted. */
export class PriceCache {
  private readonly rows = new Map<string, PriceTable>();

  set(commodityId: string, table: PriceTable): void {
    this.rows.set(`${commodityId}:${table.tanggalPerdagangan}`, {
      ...table,
      sumber: "live",
      baris: table.baris.map((row) => ({ ...row })),
    });
  }

  get(commodityId: string, date: string | null): PriceTable | null {
    if (date) {
      const hit = this.rows.get(`${commodityId}:${date}`);
      return hit ? { ...hit, sumber: "cache", baris: hit.baris.map((row) => ({ ...row })) } : null;
    }
    let best: PriceTable | null = null;
    for (const [key, table] of this.rows) {
      if (!key.startsWith(`${commodityId}:`)) {
        continue;
      }
      if (!best || table.tanggalPerdagangan > best.tanggalPerdagangan) {
        best = table;
      }
    }
    return best ? { ...best, sumber: "cache", baris: best.baris.map((row) => ({ ...row })) } : null;
  }
}
