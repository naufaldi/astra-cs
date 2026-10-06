# Observability is one content-free log line

Each request writes one line: time, request id, outcome, commodity, trading date, price-read latency, wording-call latency, and error class. A written handoff record is outcome `handoff` even when a price was also phrased. `answered` means a price was phrased and no handoff was written. `unread` means the table could not be read and was not cached. Every other request that does not phrase a price is `refusal`. The line never includes the raw message, visitor identity, the model reply, or the claimed price. Token totals stay in AstraFlow's audit log.

A stored transcript was rejected because it breaks zero content retention. A metrics stack was rejected because the workshop product is one path, and the line is enough to see that the path ran.
