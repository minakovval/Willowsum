-- ws:contract 0001_liabilities.sql the loan rule only widens, for a loan marked terms_pending; the previous code never sets the mark (DEFAULT false), so every row it writes is held to the same rule as before
-- «Кредитна картка» → «Кредит» (FIN-12@PoC FR 5, AC12): the loan keeps the card's rate, if any, and has no monthly
-- payment yet — the account is marked «Додайте ставку і платіж» until both are entered. Expand, not a dropped rule
-- (ARC-03 FR 4): the rule «a loan has its rate and monthly payment and no grace period» (FIN-01 FR 2, FR 3) stays in the
-- database for every loan, except that a loan which came from a card (`terms_pending`, set only by the kind change)
-- may miss its rate or payment. A new loan still needs both, here and in `checkTerms` (FIN-01 FR 5). The card's
-- «no monthly payment» CHECK (`liabilities_check1`) is unchanged.
ALTER TABLE liabilities ADD COLUMN terms_pending boolean NOT NULL DEFAULT false;
ALTER TABLE liabilities DROP CONSTRAINT liabilities_check;
ALTER TABLE liabilities ADD CONSTRAINT liabilities_loan_terms CHECK (
  kind <> 'loan'
  OR (grace_period_days IS NULL AND (terms_pending OR (annual_rate IS NOT NULL AND monthly_payment IS NOT NULL)))
);
ALTER TABLE liabilities ADD CONSTRAINT liabilities_terms_pending_loan CHECK (NOT terms_pending OR kind = 'loan');
