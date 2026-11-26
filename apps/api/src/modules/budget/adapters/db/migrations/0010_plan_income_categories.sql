-- «Бюджет → План», «Надходження» — a row per income category of the budget's plan (BUD-17@PoC FR 1; owner decision
-- 2026-11-21, 2 б; wave 2 row 231): a month's own value of an income category is a cell of kind 'income' whose
-- line_id is the category (module categories' opaque id), in the category's currency. «План доходу» and «Інші
-- надходження» are gone, and the regular incomes are no rows (they are in their category's fact).
--
-- The values typed before (lead decision 2026-11-26, row 231): the month's own «План доходу» (line_id nil) of a budget
-- with income categories in its own currency becomes that month's cells of those categories, adding up to it exactly:
-- the categories by plan, largest first (then by id), each takes its plan while the typed amount lasts, and the first
-- one also takes what the typed amount exceeds their sum by — no rounding, nothing lost. A category in another currency
-- (BUD-02 FR 24) keeps its plan: no rate here. The old rows stay as they are, so the code before this migration still
-- finds its «План доходу» and runs on this schema unchanged (ARC-03 FR 4); the new code reads the nil row only for a
-- budget without income categories. A regular income's own value (line_id a recurring payment) stays stored and no
-- longer counts — its line is gone, as a closed goal's (#613).
INSERT INTO plan_cells (household_id, budget_id, period, kind, line_id, amount, currency, version)
SELECT typed.household_id, typed.budget_id, typed.period, 'income', p.category_id,
       greatest(least(p.amount, typed.amount - (p.running - p.amount)), 0)
         + CASE WHEN p.rank = 1 THEN greatest(typed.amount - p.total, 0) ELSE 0 END,
       p.currency, 1
  FROM plan_cells typed
  JOIN budgets b ON b.household_id = typed.household_id AND b.id = typed.budget_id
  JOIN LATERAL (
    SELECT ip.category_id, ip.amount, ip.currency,
           row_number() OVER w AS rank,
           sum(ip.amount) OVER (w ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running,
           sum(ip.amount) OVER () AS total
      FROM income_plans ip
     WHERE ip.household_id = typed.household_id AND ip.budget_id = typed.budget_id AND ip.currency = b.currency
    WINDOW w AS (ORDER BY ip.amount DESC, ip.category_id)
  ) p ON true
 WHERE typed.kind = 'income'
   AND typed.line_id = '00000000-0000-0000-0000-000000000000'
   AND typed.amount IS NOT NULL
ON CONFLICT (household_id, budget_id, period, kind, line_id) DO NOTHING;

-- BUD-01@PoC FR 12 (row 221): an income category's delete finds and removes its cells by the line, as a limit's.
-- Additive: an index only.
CREATE INDEX plan_cells_income_line ON plan_cells (household_id, line_id) WHERE kind = 'income';
