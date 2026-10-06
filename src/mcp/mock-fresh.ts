import type { FreshPayload } from "../domain.js";

/**
 * A public price fixture shaped like `/api/pihps/fresh`.
 * Bali is a published province with no row, so ranking skips it.
 */
export const mockFresh: FreshPayload = {
  latestDate: "2026-10-05",
  dates: ["2026-10-02", "2026-10-05"],
  prices: {
    "2026-10-05:beras:11": 15700,
    "2026-10-05:beras:31": 16950,
    "2026-10-05:beras:32": 15600,
    "2026-10-05:beras:34": 14800,
    "2026-10-02:beras:11": 15000,
    "2026-10-02:beras:31": 16800,
    "2026-10-02:beras:32": 15500,
    "2026-10-02:beras:34": 14700,
  },
};
