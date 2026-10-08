# A failed live read never becomes a price

If the live read fails and a price cache exists for that commodity and trading date, the reply uses the cache and names the trading date. If no cache exists, the agent says the price table cannot be read. It does not invent a price and does not call AstraFlow. A failed read is never stored as a price.

Inventing a price was rejected because the table is the only source. Calling AstraFlow on an empty read was rejected because the model will phrase a number that was never published.
