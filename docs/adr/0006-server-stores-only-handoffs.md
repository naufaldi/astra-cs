# The server stores only handoff records

Our server persists a handoff record and nothing else. No transcript, no model reply, no usage copy. The displayed price comes from the price read. The claimed price is the number the visitor states. The record is written only when commodity, province, displayed price, and claimed price are all present. Writing it does not call AstraFlow. Token cost is read from AstraFlow's audit log. AstraFlow does not retain the chat content. The handler list is a separate route, unlocked with a server-side workshop key, and it is not linked from the visitor chat.

Saving nothing at all was rejected because a handler cannot check a wrong price with an empty list. Saving the chat was rejected because that breaks zero content retention.
