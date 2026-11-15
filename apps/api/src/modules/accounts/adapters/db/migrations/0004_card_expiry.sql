-- «Реквізити» (FIN-12@PoC FR 4, wave 2 row 14): «Строк дії» of a credit card, month and year (YYYY-MM, 2000–2099).
-- Only the card's last 4 digits are kept with it (`number_last4`); the full card number is never taken. Expand: a new
-- nullable column the previous code never writes. «Only a credit card has it» is the code's rule for now (a kind
-- change to «Кредит» clears it); as a database rule it would break the previous code's kind change of a card with an
-- expiry, so it comes as a contract step in a later release (see the PR, «Follow-ups»).
ALTER TABLE accounts ADD COLUMN card_expires text CHECK (card_expires ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$');
