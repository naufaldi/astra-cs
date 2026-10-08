import type { RequestLog } from "../domain.js";

/** One content-free line. The message, identity, reply, and claimed price are not fields. */
export function formatRequestLog(line: RequestLog): string {
  return JSON.stringify({
    time: line.time,
    requestId: line.requestId,
    outcome: line.outcome,
    commodity: line.commodity,
    tradingDate: line.tradingDate,
    priceReadMs: line.priceReadMs,
    wordingMs: line.wordingMs,
    errorClass: line.errorClass,
    wordingPath: line.wordingPath,
    ...(line.upstreamClass
      ? { upstreamClass: line.upstreamClass, upstreamMessage: line.upstreamMessage ?? "" }
      : {}),
  });
}
