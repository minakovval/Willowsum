-- BUD-01@PoC FR 12, AC22 (wave 2 row 221; owner decision 2026-11-26): a category is deleted with its months' own
-- values in «План» — module categories asks which of its categories have a cell, and the delete removes the cells of
-- one line. An index on the line keeps both bounded to the space's rows of the category. Additive: an index only, so
-- the code before this migration runs on this schema unchanged (ARC-03 FR 4).
CREATE INDEX plan_cells_line ON plan_cells (household_id, line_id) WHERE kind = 'limit';
