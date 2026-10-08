# A wording failure falls back to the template answer

When the AstraFlow call fails or exceeds 25 seconds, the reply is the template sentence built from the resolved facts, with the source citation. No tokens are recorded and no credits are charged, and the outcome stays answered. The request log carries `wording_fallback`. A refusal was rejected because the visitor had a valid price and a gateway fault is not their problem.

When the call succeeds but the sentence drops a price or the trading date, `wordingKeepsFacts` rejects it and the template replaces it. The tokens were spent, so they are charged, and the log carries `wording_rejected`.

Thinking is off by default (`thinking: {"type":"disabled"}`) because on a one-sentence probe the total dropped from 230 to 73 tokens, and a real answered call now averages about 135 tokens (105 prompt, 31 completion, no reasoning) with a 2-10 second round trip. `ASTRAFLOW_THINKING=on` restores reasoning. The tenant id is sent as `user` so the gateway can attribute usage.
