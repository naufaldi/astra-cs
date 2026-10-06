import type { FreshPayload } from "../domain.js";

const FRESH_URL = "https://monitor.naufaldi.com/api/pihps/fresh";
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export async function readLiveFresh(fetchImpl: typeof fetch = fetch): Promise<FreshPayload> {
  const response = await fetchImpl(FRESH_URL, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`fresh read failed: ${response.status}`);
  }
  const body: unknown = await response.json();
  if (!isFreshPayload(body)) {
    throw new Error("fresh read failed: shape");
  }
  return body;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && isoDate.test(value);
}

function isFreshPayload(value: unknown): value is FreshPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.latestDate !== null && !isIsoDate(record.latestDate)) {
    return false;
  }
  if (!Array.isArray(record.dates) || !record.dates.every(isIsoDate)) {
    return false;
  }
  if (typeof record.prices !== "object" || record.prices === null || Array.isArray(record.prices)) {
    return false;
  }
  return Object.values(record.prices).every((price) => typeof price === "number" && Number.isFinite(price));
}
