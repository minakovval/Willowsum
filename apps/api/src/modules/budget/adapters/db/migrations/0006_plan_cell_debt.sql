-- ws:contract 0005_plan_cells.sql the kind rule only widens (it now also allows 'debt'); every kind the previous code can store still passes
-- «Розподіл» saved with the budget (BUD-02@PoC FR 15): the extra payment above the minimum planned for one debt in the
-- first period is a cell of kind 'debt' (line_id — module accounts' id of the debt). The grid shows it read only as
-- that month's «додатковий платіж» (BUD-17 FR 1); it is not planned savings (BUD-02 FR 11). The previous code never
-- writes it and reads only the kinds it knows, so it runs on this schema unchanged.
ALTER TABLE plan_cells DROP CONSTRAINT plan_cells_kind_check;
ALTER TABLE plan_cells ADD CONSTRAINT plan_cells_kind_check
  CHECK (kind IN ('income', 'limit', 'goal', 'savings', 'debt'));
