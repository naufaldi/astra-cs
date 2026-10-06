# The price read is live

MCP reads the live Monitor Pangan price table. A price cache keyed by commodity and trading date may keep that public table. The cache never contains a visitor session. If the live read fails, the cache may answer. A failed read is not written into the cache.

A frozen workshop copy was rejected because the reply would drift from the map the visitor is looking at.
