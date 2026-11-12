# CHT — module requirements

Scope: Charts: reusable chart components that hold the complex visualisation logic (time series, spending vs budget, composition of a whole). Source: product owner decisions of 2026-11-02 (design review of the Home screen).

## Text from the specification tab (outside individual requirements)

<!-- spec-text:begin -->
## Графіки

Модуль «Графіки» описує перевикористовувані компоненти графіків зі складною логікою побудови: часовий ряд з кількома серіями, витрати проти бюджету і склад цілого. Модуль відповідає на питання «як малювати»; віджет чи сторінка вирішує, що і де показати, а доменні модулі — як рахувати. Візуальні токени і загальні правила графіків лишаються в дизайн-системі (DS-07, DS-15, DS-16, DS-17, DS-19). Усі вимоги модуля входять у реліз MVP. Приклади сум наведено в EUR.

Вимоги модуля: CHT-00, CHT-01, CHT-02, CHT-03.

<!-- spec-text:end -->

Реліз PoC: частина вимог модуля входить у PoC або PoC v2 — актуальний реліз кожної вимоги наведено в таблиці нижче і в рядку «Реліз» її файлу.

## Traceability

| Component | Used by | Data from | Visual rules | Moved here from |
| --- | --- | --- | --- | --- |
| CHT-01 Часовий ряд | WGT-27, WGT-25, Net worth tab (GRID-01), net worth history (VAL-08) | VAL-09, VAL-08, FIN-05 | DS-07, DS-16, DS-17, DS-19, CMP-42 | VAL-09 FR 12 and criteria 11–12; DS-16 FR 16–20 and criteria 9–12; CMP-40 trend view rules |
| CHT-02 Витрати проти бюджету | WGT-14, WGT-29, budget page (GRID-04) | BUD-03, FCS-01, FCS-02, FCS-03 | DS-17 (dotted forecast exception), DS-06 warning tokens | drawing rules restated from FCS-03 (FCS-03 keeps the data and widget criteria) |
| CHT-03 Склад цілого | WGT-17 | VAL-09 | DS-07, DS-15, DS-19 (legend-as-table exception), CMP-52, CMP-48, CMP-45 | UX-03 FR 19 and criteria 19, 20, 26; CMP-40 «Інші · N» rule |

Related library components (stay in CMP, listed in CHT-00 by name): CMP-42 LineChart, CMP-43 SmallMultiples, CMP-44 Sparkline, CMP-45 Treemap, CMP-46 InvestmentChart, CMP-47 BarChart, CMP-48 DonutChart, CMP-49 RingProgress, CMP-50 Waterfall, CMP-51 Heatmap, CMP-52 AllocationBar, CMP-40 SummaryWidget. No CHT-04 was created: moving these components gives no clear benefit now.

## Requirements

| ID | Title | Release | Priority |
| --- | --- | --- | --- |
| [CHT-00](CHT-00.md) | Принципи модуля «Графіки» | PoC; PoC v2 (текстовий підсумок і таблиця-альтернатива в компонентах); MVP (ролі й учасники простору; режим «Приховати суми» в компонентах) | M |
| [CHT-01](CHT-01.md) | Часовий ряд з кількома серіями | PoC (одна панель — баланс рахунку; без режиму «Приховати суми» і графіка net worth на Головній); PoC v2 (кілька панелей і нижня панель зобов'язань, текстовий підсумок і таблиця-альтернатива, внески і виведення портфелів, позначка «Переоцінка»); MVP (ролі й учасники простору; графік net worth на Головній, режим «Приховати суми», сенсорні екрани); v1 (розширений набір періодів на вкладці «Дохідність» інвестицій) | M |
| [CHT-02](CHT-02.md) | Витрати проти бюджету | PoC v2 (повний варіант на сторінці бюджету; текстовий підсумок і таблиця-альтернатива); MVP (ролі й учасники простору; компактний варіант у віджеті S і повний у віджеті L Головної, режим «Приховати суми», дотик) | M |
| [CHT-03](CHT-03.md) | Склад цілого | MVP | M |
