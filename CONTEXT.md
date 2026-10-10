# Monitor Pangan Support

The conversation a visitor has with the support agent about Monitor Pangan. The agent answers from exactly one price table, in Indonesian, and names the trading date. It never calls that price today. A visitor who states a claimed price gets a handoff record. Our server stores only that record.

Visitor identity never reaches a wording call, the session draft, the request log, or the handoff record. The wording call receives only resolved public price facts. The raw visitor text only picks the reply language, and it is never sent.

Decisions that explain why live in `docs/adr/`.

## Language

**Visitor**:
A person on the public Monitor Pangan map who talks to the agent. The only person in this context.
_Avoid_: Customer, user, operator

**Price question**:
A visitor's request answered from exactly one price table: a province price, a comparison between provinces, a highest or lowest province among rows that have a price, or a comparison to the average. It does not cross commodities or trading dates.
_Avoid_: Query, lookup, support ticket

**Price table**:
The published prices of one commodity on one trading date, by province, including each province's difference from the average. A province with no published price is absent from the table.
_Avoid_: Dataset, snapshot, feed

**Trading date**:
The date on a price table. It is a trading day, and the published price is not "today's" market price. A date with no price table is not a price question.
_Avoid_: Today, realtime, last update

**Latest trading date**:
The most recent trading date on the fresh payload, the field `latestDate`. It is the price table when the visitor names no date, or says today. The reply names that date. A null `latestDate` means there is no price table to phrase.
_Avoid_: Today, now, last update

**Published name**:
The commodity or province name as Monitor Pangan prints it. A visitor's word counts only when it maps to exactly one published name. The reply uses that name.
_Avoid_: Alias, synonym, code

**Support request**:
A visitor's claim that the map is wrong, incomplete, or unusable, which a person must handle. The agent does not change the price.
_Avoid_: Ticket, bug, complaint

**Monitor Pangan**:
The public map of strategic food prices in Indonesia, by province.
_Avoid_: The database, the backend

**Support agent**:
The agent a visitor talks to about Monitor Pangan. Every sentence the visitor reads is Indonesian.
_Avoid_: Bot, assistant, chatbot

**Public price fact**:
A commodity, a province, and the price Monitor Pangan publishes for them.
_Avoid_: Record, row, payload

**Visitor identity**:
A name, phone, address, or free text that may contain them.
_Avoid_: PII, user data, profile

**Zero content retention**:
AstraFlow does not keep the price chat or the model reply, and our server does not keep them either. Visitor identity is never kept. Token cost is read from AstraFlow, not from a copy we store.
_Avoid_: Zero data retention, no logs

**Session draft**:
The fields of one visitor session: published commodity, the published provinces that question used, trading date, the last public price facts, and a claimed price until a handoff record is written. Raw visitor text and visitor identity are never in it. The web keeps it in sessionStorage until the tab closes. A CLI keeps it in the memory of one process until that process exits. The server receives one resolved question and does not keep the draft. An unresolved name is asked before that, and it is not sent.
_Avoid_: History, transcript, cookie, session

**Handoff record**:
The only artifact our server stores: commodity, province, displayed price, and claimed price. The displayed price comes from the price read. The claimed price is the number the visitor states. It is written only when all four are present. Writing it does not call AstraFlow. Visitor identity is never in it.
_Avoid_: Transcript, ticket, conversation log

**Price cache**:
A stored price table keyed by commodity and trading date. It contains no visitor session. When the live read fails, a reply may use it. A failed read is never stored as one.
_Avoid_: History, transcript

**Price read**:
The support agent's access to one price table, read from the public fresh payload Monitor Pangan publishes. That payload is trading days after the baked snapshot, currently after 2026-09-16. It is not sample data, and it is not the baked history. A province price names one province, a comparison names two, and a ranking names none. Commodity and trading date are always named. The raw message never identifies the read, and the model does not perform it.
_Avoid_: Query, lookup, scrape

**Handler**:
The person who reads handoff records. A visitor is never a handler, and the list is not part of the visitor chat.
_Avoid_: Admin, operator, instructor

**Refusal**:
The agent's reply when it will not phrase a price. AstraFlow is not called. This includes off-topic text, a trend, a cross-commodity comparison, an unpublished date, and a price table that cannot be read and is not in the price cache.
_Avoid_: Error, fallback, small talk

**Outcome**:
How a request ended: answered, refusal, handoff, or unread. A written handoff record makes it handoff, even when a price was also phrased. Answered means a price was phrased and no handoff was written. A template answer after a wording failure still counts as answered. Unread means the price table could not be read and was not in the price cache. Every other request that does not phrase a price is a refusal.
_Avoid_: Status code, error

**Request log**:
A line that a request happened: when, its id, its outcome, the commodity, the trading date, and how long the price read and the wording call took. It contains no visitor message, no visitor identity, no model reply, and no claimed price.
_Avoid_: Transcript, trace, analytics event
