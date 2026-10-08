# One MCP tool returns the price table

Ranking, comparison, and a province price all come from one published table. MCP exposes one tool, which takes a commodity and a trading date and returns that table. The server selects the rows. The web chat and the CLI share that path.

Three tools were rejected because they would repeat one read. A direct fetch from the chat was rejected because it removes the guardrail.
