import type { FreshPayload } from "../domain.js";

const FRESH_URL = "https://monitor.naufaldi.com/api/pihps/fresh";

/** Read the live price payload the map already publishes. */
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

function isFreshPayload(value: unknown): value is FreshPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.latestDate === "string" &&
    Array.isArray(record.dates) &&
    typeof record.prices === "object" &&
    record.prices !== null
  );
}
