# The session draft stays in the browser tab

One visitor session on the web is one browser tab. sessionStorage holds the session draft: published commodity, provinces, trading date, the last public price facts, and a claimed price until a handoff record is written. Raw text and visitor identity never enter it. Closing the tab ends the session. One CLI process is the same kind of session, held only in that process's memory until it exits. The server receives one resolved question and stores no chat.

localStorage was rejected because it survives on a shared machine. A session cookie was rejected because it is sent to our server. A server-side session was rejected because that is a stored chat.
