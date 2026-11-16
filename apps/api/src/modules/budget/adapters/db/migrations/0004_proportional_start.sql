-- The proportional first period of the budget wizard (BUD-02@PoC b; wave 2 row 30; FR 14): the day the budget starts
-- counting inside its first period, today when the wizard's «Пропорційно на <день>–<останній>» is chosen; null — the
-- whole first period. The plan of that period is the plan × (days left, the day included) ÷ (days in the period).
-- Additive: a nullable column, so the code of row 29 runs on this schema unchanged.
ALTER TABLE budgets
  ADD COLUMN first_day date
    CHECK (first_day IS NULL OR (date_trunc('month', first_day)::date = first_period AND extract(day FROM first_day) > 1));
