-- «Кредитна картка» → «Кредит» (FIN-12@PoC FR 5, AC12): the loan keeps the card's rate, if any, and has no monthly
-- payment yet — the account is marked «Додайте ставку і платіж» until both are entered. A new loan still needs both
-- (FIN-01 FR 5: checked by `checkTerms`), so only the stored rule that every loan has them goes. The rule «a loan has no
-- grace period» stays with the application (`termsAsKind`); its own CHECK is a constraint added, a contract step of a
-- later release (ARC-03 FR 4). A card's «no monthly payment» CHECK is unchanged.
ALTER TABLE liabilities DROP CONSTRAINT liabilities_check;
