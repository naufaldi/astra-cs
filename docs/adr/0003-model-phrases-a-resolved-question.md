# AstraFlow phrases only a resolved price question

AstraFlow is called only after a message resolves to one price table. It phrases the reply from the public price facts that sentence needs: one row, the winning row and the count, or two rows, plus the trading date and the average when the sentence uses them. It does not receive the whole table, and it does not receive the visitor's wording. A refusal covers everything else, and that refusal does not call the model.

Sending the raw visitor message and letting the model decide was rejected. That would put visitor identity and off-topic text in the model payload, which is the leak the workshop exists to close.
