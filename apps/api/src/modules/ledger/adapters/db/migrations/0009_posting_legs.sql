-- The legs of an event (IMP-02@PoC FR 5, AC11): an operation has one or more legs (an amount on an account) and a
-- separate fee leg. Each leg is one posting against «Зовнішні кошти», marked with its leg, so the entry keeps them.
-- Postings of the other events carry none (NULL). Expand only (ARC-03 FR 4): the previous code writes no leg.
ALTER TABLE postings ADD COLUMN leg text CHECK (leg IN ('main', 'fee'));
