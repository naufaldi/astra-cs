import type { PriceRow, PriceTable, PublicPriceFact } from "../domain.js";

export type PhraseFacts =
  | {
      kind: "province";
      row: PriceRow;
      date: string;
      latestDate: string;
      commodity: string;
      unit: PriceTable["satuan"];
    }
  | {
      kind: "compare";
      left: PriceRow;
      right: PriceRow;
      date: string;
      latestDate: string;
      commodity: string;
      unit: PriceTable["satuan"];
    }
  | {
      kind: "rank";
      row: PriceRow;
      count: number;
      direction: "high" | "low";
      date: string;
      latestDate: string;
      commodity: string;
      unit: PriceTable["satuan"];
    }
  | {
      kind: "versusAverage";
      row: PriceRow;
      average: number;
      date: string;
      latestDate: string;
      commodity: string;
      unit: PriceTable["satuan"];
    };

export type SelectionInput =
  | { kind: "province"; province: string }
  | { kind: "compare"; left: string; right: string }
  | { kind: "rank"; direction: "high" | "low" }
  | { kind: "versusAverage"; province: string };

/** Pick the rows a sentence needs. The whole table is not returned. */
export function selectRows(table: PriceTable, selection: SelectionInput): PhraseFacts | { missing: true } {
  const base = {
    date: table.tanggalPerdagangan,
    latestDate: table.tanggalTerbaru,
    commodity: table.komoditas,
    unit: table.satuan,
  };
  switch (selection.kind) {
    case "province": {
      const row = findRow(table, selection.province);
      return row ? { kind: "province", row, ...base } : { missing: true };
    }
    case "versusAverage": {
      const row = findRow(table, selection.province);
      return row ? { kind: "versusAverage", row, average: table.rataRata, ...base } : { missing: true };
    }
    case "compare": {
      const left = findRow(table, selection.left);
      const right = findRow(table, selection.right);
      return left && right ? { kind: "compare", left, right, ...base } : { missing: true };
    }
    case "rank": {
      if (table.baris.length === 0) {
        return { missing: true };
      }
      const sorted = [...table.baris].sort((left, right) =>
        selection.direction === "high" ? right.harga - left.harga : left.harga - right.harga,
      );
      const row = sorted[0];
      if (!row) {
        return { missing: true };
      }
      return { kind: "rank", row, count: table.baris.length, direction: selection.direction, ...base };
    }
    default: {
      const unexpected: never = selection;
      throw new Error(`unexpected selection ${JSON.stringify(unexpected)}`);
    }
  }
}

/** Public facts for the session draft. Raw visitor text is not included. */
export function factsFromPhrase(facts: PhraseFacts): PublicPriceFact[] {
  switch (facts.kind) {
    case "province":
    case "versusAverage":
    case "rank":
      return [fact(facts.commodity, facts.row, facts.unit)];
    case "compare":
      return [fact(facts.commodity, facts.left, facts.unit), fact(facts.commodity, facts.right, facts.unit)];
    default: {
      const unexpected: never = facts;
      throw new Error(`unexpected facts ${JSON.stringify(unexpected)}`);
    }
  }
}

export function provincesFromPhrase(facts: PhraseFacts): string[] {
  switch (facts.kind) {
    case "province":
    case "versusAverage":
    case "rank":
      return [facts.row.provinsi];
    case "compare":
      return [facts.left.provinsi, facts.right.provinsi];
    default: {
      const unexpected: never = facts;
      throw new Error(`unexpected facts ${JSON.stringify(unexpected)}`);
    }
  }
}

function fact(commodity: string, row: PriceRow, unit: PriceTable["satuan"]): PublicPriceFact {
  return { komoditas: commodity, provinsi: row.provinsi, harga: row.harga, satuan: unit };
}

function findRow(table: PriceTable, province: string): PriceRow | undefined {
  return table.baris.find((row) => row.provinsi === province);
}
