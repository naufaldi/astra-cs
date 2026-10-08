# The live read is the fresh payload

MCP reads `https://monitor.naufaldi.com/api/pihps/fresh`. The payload is the trading days Monitor Pangan publishes after its baked snapshot. On 2026-10-06 that cutoff is 2026-09-16. A named date on or before the cutoff has no price table here, even when the map still draws that day from the snapshot. A null `latestDate` is an empty payload, not a price, and it is not stored in the price cache.

Vendoring the baked snapshot was rejected because this repo would then ship a second copy of history. An MCP server inside the Monitor Pangan repo was rejected because this repo owns the tool, and the map repo stays untouched.
