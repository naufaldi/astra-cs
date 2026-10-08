import type { HandoffRecord } from "../domain.js";

export type HandoffDb = {
  prepare(query: string): {
    bind(...values: unknown[]): {
      run(): Promise<unknown>;
      all<T>(): Promise<{ results: T[] }>;
    };
  };
};

type HandoffRow = {
  commodity: string;
  province: string;
  displayed_price: number;
  claimed_price: number;
};

/** Insert a handoff only when commodity, province, displayed price, and claimed price are present. */
export async function insertHandoff(db: HandoffDb, row: HandoffRecord): Promise<void> {
  if (!row.commodity || !row.province || !Number.isFinite(row.displayedPrice) || !Number.isFinite(row.claimedPrice)) {
    return;
  }
  await db
    .prepare(
      "INSERT INTO handoff (id, commodity, province, displayed_price, claimed_price, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(crypto.randomUUID(), row.commodity, row.province, row.displayedPrice, row.claimedPrice, new Date().toISOString())
    .run();
}

/** List handoff records for the handler route. */
export async function listHandoffs(db: HandoffDb): Promise<HandoffRecord[]> {
  const result = await db
    .prepare(
      "SELECT commodity, province, displayed_price, claimed_price FROM handoff ORDER BY created_at",
    )
    .bind()
    .all<HandoffRow>();
  return result.results.map((row) => ({
    commodity: row.commodity,
    province: row.province,
    displayedPrice: row.displayed_price,
    claimedPrice: row.claimed_price,
  }));
}
