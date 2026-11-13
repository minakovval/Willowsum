# Moving scope between releases: `--move` (full text)

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-13

Moved out of `change-requirement` SKILL.md without change (owner, 2026-11-13). Read when you move items between releases.

## 3. Moving scope between releases: `--move`

1. Move items with the tool, not by hand:
   `node tools/req-check/index.mjs --move <ID> --items FR4,AC5,EC2 --to "PoC v2" [--from PoC]`.
   Items are numbered as in the `--from` view (default: the first view). The tool changes the tags of the item
   and its continuation lines in the source and regenerates that requirement's views.
2. The target view must exist. For a new release of the requirement, first add it by hand in the source:
   «Зрізи», the card's «Реліз» line and table of slices, the `[лише <release>] **Реліз:** …` line and the
   «Розширює» lines of the slice text; run `--views`; then move.
3. Read the whole `--move` report and act on every part of it:
   - **Item numbers that changed** and **citations of changed numbers in the source**: a line such as «прогрес
     за FR 15» now points at another item. Reword it to name the item by its phrase («пункт «Прогрес черги
     рахує транзакції»») or fix the number;
   - **tests and docs that cite changed numbers** (`BUD-12@PoC FR 15` in a test name): `--coverage` maps tests
     by number, so rename the test or list it as a follow-up for its author;
   - **the moved items are still mentioned in the same requirement**: business rules, criteria or edge cases
     that still describe the moved behaviour in the old release. Move them too (`--items`), reword them, or
     record why they stay;
   - **an item beside a variant of itself**: two wordings of one item in one view; keep one;
   - **dependents** and **key phrases elsewhere**: as in step 2.
4. Moving a `[лише PoC]` item to PoC v2 makes it `[лише PoC v2]`; check that it does not contradict a PoC v2
   item next to it (the variant check only catches lines that start alike).
5. Rewording is a plain edit of the source: a line that changes from release R on becomes two lines with
   adjacent ranges, old then new (`[PoC–PoC v2] old`, `[MVP] new`); a line of one release only is edited in
   place.
6. Keep each view complete for its release; IDs only in «Зв'язки» (tag the field lines that differ between
   releases).
7. The card part is not changed by `--move`: update the «Реліз» line, the table of slices and the module
   README row by hand when the set of releases changes. A changed card's «Реліз» line must match its module README row (PRC-01 FR 3): edit both in the same PR. Plans that list the item (`docs/plans/`) are updated
   in the same PR; grep them for the ID.
