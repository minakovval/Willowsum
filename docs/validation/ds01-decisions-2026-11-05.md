# DS-01 (#32) decisions, 2026-11-05

Baseline already merged (PR #52): P0 canvas is the visual reference for non-chart UI, except accessibility (control borders >=3:1 border-control, 44 px hit areas, focus ring) and currency after the amount; chart palette/geometry follow DS-06/DS-07/DS-16.

Owner answers:
O1. Accounts list filters in PoC: Тип, Валюта, Джерело (add Валюта and Джерело to FIN-12@PoC).
O2. «Колонки» and «Параметри» ARE in PoC: add to transactions and accounts boards (Параметри holds «Показати закриті», «Змінити порядок»).

Area 1 (filters, menus, views) — recommendations accepted:
1. Filter button text «Фільтри · N» (no separate badge), height 36 px everywhere.
2. Compact in-card filter variant (menu with checkbox groups, applies immediately) added to CMP-32 + README FilterBar.
4. Single page filter = Select variant «кнопка-список з підписом» 36 px with border-control; FilterBar only for lists with ≥2 filters.
5. «…» accessible name and tooltip «Ще дії», aria-haspopup="menu" (CMP-61, CMP-59).
6. Budget row actions via «…»; pencil only opens the limit-edit popover.
7. «…» with one item allowed only for a destructive item; otherwise show the button.
8. «Показати закриті», «Змінити порядок» → «Параметри» (fix FIN-01@PoC, FIN-12@PoC).
9. Chart view button 28×28 (hit area 44) per CMP-58.
10. Debt charts get the disabled view button too; remove the BUD-19@PoC exception.
11. «Таблиця» is always the text alternative under a chart, not a view option (CMP-58@MVP, README ViewSwitch, PlanBudgetPaceDays).
12. Segmented allowed for exactly two views of the same table; «Вигляд: … ˅» for whole-page view; use role radiogroup, not tablist.
13. Pairs «Пропозиції / Односторонні / Підтверджені» = Segmented with counts (fix IMP-03@PoC FR20).
15. New component SelectionBar (CMP-73): «Вибрано N · Сума», «Вибрати всі M за фільтром», «Дії з вибраними ˅», «×»; PoC set of bulk actions = FIN-03@PoC/DAT-03@PoC (3 actions); assets Bulk uses it (no «Теги» for assets).
- MoneyPairManual (MVP) aligned to PocMoneyPairManual (transactions FilterBar + chips).
- Chip «×» is a real button named «Прибрати фільтр <назва>»; one Chip spec (README) → update CMP-32@PoC, CMP-64@PoC.
- Term: «Зберегти вигляд» everywhere (not «Представлення»).
- CMP-60@PoC v2: «Сортувати» button only on narrow/card lists; tables sort by headers (align with CMP-62, GRID-02, FIN-03).
- Accounts table sortable (FIN-12@PoC).

Area 2 (pickers, dialogs, banners):
1. Dimensions follow the design system/canvas (already PR #52), a11y rules kept.
2. Banner: no edge strip; 1 px line on surface-inset + tone marker + word (CMP-19/DS-07 as merged). Inline hint = banner variant «вбудований», same look, smaller. Fix boards with 3 px strips.
3. Dialog footer buttons: one size for all dialogs — 40 px, radius 8, 44 px hit area.
4. Stepper: completed = gain «✓», steps clickable back (CMP-21 item 8); rewrite CMP-14; page wizard = same component, size page.
5. «Скасувати» stays on every step.
6. «Підсумок періоду» (S-135) uses budget navigation; remove it from CMP-72 purpose; describe budget navigation as a CMP-72 mode without «Тип періоду».
7. Chart period switch = Segmented variant «quiet» (CMP-12), role radiogroup.
8. CMP-03 gets variant «з пошуком»; CMP-02 type «дата» with calendar; category list first group «Часто для <мерчанта>» when merchant known, else «Нещодавні»; «Нова категорія» always present.
9. Popover forms allowed for 1–3 values with no irreversible effect (CMP-61); «Оновити залишок» stays modal.
10. Dialog sizes: default ≤560 px, «wide» 900 px only for original-vs-recognized comparison (receipt, manual pairing); splitting uses 640 px.
11. Toast: one at a time, 8 s / 10 s with «Відмінити»; fix DS-09 and duration-toast token (code too).
12. Words: «Скасувати» = close without changes; undo of a done action = «Відмінити»; marking a recurring payment cancelled = «Позначити скасованим». Record in DS-03.
- New-transaction primary action «Додати транзакцію» (FIN-03).
- Account label format: name + «··NNNN» mask everywhere.
- FIN-11 vs FIN-02 disconnect-bank dialog: one text (take FIN-11, PoC source).
- Danger button: 1.5 px loss border (as design system).
- Add a board for the session timeout warning (ACC-04@PoC v2) later (canvas task).

Area 3 (states, amounts, statuses):
1. Empty/error states: two variants — «блок» (left-aligned, CMP-23/24 sizes) and «область» (centered, 64 px tile, 22 px title).
2. Empty state: max one primary + one secondary action.
3. Component adds «✕ Помилка» and «Код: …»; feature slices give only «Не вдалося …».
4. Skeleton: code values (12 px lines, radius 6, `skeleton` token, 1.6 s) into CMP-22/DS-13; П-13 uses «Ще завантажується…».
5. Badge = flat 20 px plaque (merged) with mandatory marker; tones by meaning: «Активне» positive, «Помилка» negative. Fix boards.
6. BudgetRow/GoalProgress bars: 6 px pill on surface-300 (canvas); state also by marker + word, so the fill is not the only cue; update requirements.
7. Budget state word and marker use fixed DS-23 tones (gain, on-warning, loss, ink-muted); gradient only fills the bar.
8. Amounts stay ink; exception only for a state amount with its marker («! Дефіцит −43,00 €»).
9. Amount size table by role in CMP-07 from the canvas (Inter Tight for totals).
10. Missing value «–» (ink-muted); «—» only in Delta «без змін» (brand).
11. «Інші · N» per DS-07 (grey; hatch only in composition fills); «з цілей» uses a dotted pattern instead of hatch. Limits: 5 parts in widgets, up to 8 in reports.
12. «Порівняння»: one Delta («▲ 33,33 € · 0,6 %»), no separate percent column.
13. New component Progress (CMP-74) for determinate process progress (sync, import, bulk action, review queue).
- Currency after the amount on all boards (80 PoC + 120 MVP).
- Delta colours only gain/loss tokens; sizes from CMP-08.
- Card goal on PocMoneyAccount uses GoalProgress, not an amber bar.
