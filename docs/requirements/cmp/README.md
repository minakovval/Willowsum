# CMP — module requirements

Scope: UI components (one requirement per component). Source: tab 11 of the Willowsum product specification.

## Text from the specification tab (outside individual requirements)

<!-- spec-text:begin -->
## 11. Компоненти інтерфейсу

Ця вкладка описує кожен компонент інтерфейсу Willowsum: призначення, будову, розміри, стани, тексти, поведінку з клавіатурою та екранним читачем, адаптивність і перевірювані критерії приймання. Компоненти однакові для вебзастосунку й адмін-панелі; мобільні застосунки використовують ті самі правила.

**Умовні позначення, спільні для всіх вимог вкладки**
- Колір токена записано як `назва` і два шістнадцяткові коди RGB без знака решітки: спершу світла тема, потім темна. Наприклад, `brand` 0B2545 / EBDFC6.
- Класи ширини вікна: Compact — менше 600 px (від 360 px), Medium — 600–1023 px, Expanded — 1024–1439 px, Large — від 1440 px. Компонент реагує також на ширину свого контейнера (container query).
- «Фокус-кільце» — суцільна лінія 3 px кольору `focus` 1D4E89 / E3A33B з відступом 2 px від краю; воно ніколи не прибирається.
- «Режим "Приховати суми"» — глобальний перемикач: замість кожної суми показано «•••», відсотки лишаються видимими, осі графіків із сумами приховано, маркери мапи мають однаковий розмір.
- «Зменшений рух» — системне налаштування користувача; тоді анімації вимикаються або замінюються миттєвою зміною.
- Тексти інтерфейсу в прикладах — українською; суми — в EUR або UAH у форматі «€ 128 450,00» (пробіл між тисячами, кома перед копійками, валюта перед числом).

**Вимоги вкладки:** CMP-01 Button, CMP-02 Field, CMP-03 Select, CMP-04 Checkbox, CMP-05 Switch, CMP-06 Dropzone, CMP-07 Amount, CMP-08 Delta, CMP-09 GoalProgress, CMP-10 PageHeader, CMP-11 Tabs, CMP-12 Segmented, CMP-13 Pagination, CMP-14 Stepper, CMP-15 Checklist, CMP-16 CommandPalette, CMP-17 Tree, CMP-18 Badge, CMP-19 Banner, CMP-20 Toast, CMP-21 Dialog, CMP-22 Skeleton, CMP-23 EmptyState, CMP-24 ErrorState, CMP-25 Tooltip, CMP-26 Table, CMP-27 ListRow, CMP-28 TransactionRow, CMP-29 NotificationItem, CMP-30 Avatar, CMP-31 Timeline, CMP-32 FilterBar, CMP-33 Icon, CMP-34 AssetPlaceholder, CMP-35 AssetMap, CMP-36 AssetGallery, CMP-37 PhotoGallery, CMP-38 AssetMapWidget, CMP-39 AssetGalleryWidget, CMP-40 SummaryWidget, CMP-41 AssetTypeWidget, CMP-42 LineChart, CMP-43 SmallMultiples, CMP-44 Sparkline, CMP-45 Treemap, CMP-46 InvestmentChart, CMP-47 BarChart, CMP-48 DonutChart, CMP-49 RingProgress, CMP-50 Waterfall, CMP-51 Heatmap, CMP-52 AllocationBar, CMP-53 Card, CMP-54 Widget, CMP-55 BudgetRow, CMP-56 ConnectionCard, CMP-57 PlanCard, CMP-58 ViewSwitch, CMP-59 IconButton, CMP-60 Toolbar, CMP-61 Menu, CMP-62 SortMenu, CMP-63 ColumnPicker, CMP-64 Chip, CMP-65 PillTabs, CMP-66 GroupHeader, CMP-67 FolderCard, CMP-68 MiniMap, CMP-69 AppNavigation, CMP-70 KpiTile, CMP-71 BrandMark, CMP-72 PeriodPicker.

<!-- spec-text:end -->

## Requirements

| ID | Title | Release | Priority |
| --- | --- | --- | --- |
| [CMP-01](CMP-01.md) | Button — Кнопка | PoC | M |
| [CMP-02](CMP-02.md) | Field — Поле введення | PoC | M |
| [CMP-03](CMP-03.md) | Select — Список вибору | PoC | M |
| [CMP-04](CMP-04.md) | Checkbox — Прапорець | PoC | M |
| [CMP-05](CMP-05.md) | Switch — Перемикач | PoC | M |
| [CMP-06](CMP-06.md) | Dropzone — Зона завантаження файлів | MVP | M |
| [CMP-07](CMP-07.md) | Amount — Сума | PoC | M |
| [CMP-08](CMP-08.md) | Delta — Зміна | PoC | M |
| [CMP-09](CMP-09.md) | GoalProgress — Прогрес цілі | PoC | M |
| [CMP-10](CMP-10.md) | PageHeader — Заголовок сторінки | PoC | M |
| [CMP-11](CMP-11.md) | Tabs — Вкладки | PoC | M |
| [CMP-12](CMP-12.md) | Segmented — Сегментований перемикач | PoC | M |
| [CMP-13](CMP-13.md) | Pagination — Пагінація | PoC | M |
| [CMP-14](CMP-14.md) | Stepper — Індикатор кроків | PoC | M |
| [CMP-15](CMP-15.md) | Checklist — Список налаштування | MVP | M |
| [CMP-16](CMP-16.md) | CommandPalette — Командна панель | MVP | S |
| [CMP-17](CMP-17.md) | Tree — Дерево | PoC | M |
| [CMP-18](CMP-18.md) | Badge — Бейдж статусу | PoC | M |
| [CMP-19](CMP-19.md) | Banner — Банер | PoC | M |
| [CMP-20](CMP-20.md) | Toast — Спливне повідомлення | PoC | M |
| [CMP-21](CMP-21.md) | Dialog — Діалог | PoC | M |
| [CMP-22](CMP-22.md) | Skeleton — Скелетон завантаження | PoC | M |
| [CMP-23](CMP-23.md) | EmptyState — Порожній стан | PoC | M |
| [CMP-24](CMP-24.md) | ErrorState — Стан помилки | PoC | M |
| [CMP-25](CMP-25.md) | Tooltip — Підказка | PoC | M |
| [CMP-26](CMP-26.md) | Table — Таблиця | PoC | M |
| [CMP-27](CMP-27.md) | ListRow — Рядок списку | PoC | M |
| [CMP-28](CMP-28.md) | TransactionRow — Рядок транзакції | PoC | M |
| [CMP-29](CMP-29.md) | NotificationItem — Сповіщення в центрі сповіщень | MVP | M |
| [CMP-30](CMP-30.md) | Avatar — Аватар учасника | MVP | M |
| [CMP-31](CMP-31.md) | Timeline — Хронологія подій | MVP | M |
| [CMP-32](CMP-32.md) | FilterBar — Панель фільтрів | PoC | M |
| [CMP-33](CMP-33.md) | Icon — Іконка | PoC | M |
| [CMP-34](CMP-34.md) | AssetPlaceholder — Заглушка зображення | MVP | M |
| [CMP-35](CMP-35.md) | AssetMap — Мапа активів | MVP | S |
| [CMP-36](CMP-36.md) | AssetGallery — Галерея активів | MVP | M |
| [CMP-37](CMP-37.md) | PhotoGallery — Фотогалерея активу | v1 | S |
| [CMP-38](CMP-38.md) | AssetMapWidget — Віджет мапи активів | MVP | S |
| [CMP-39](CMP-39.md) | AssetGalleryWidget — Віджет галереї активів | MVP | M |
| [CMP-40](CMP-40.md) | SummaryWidget — Підсумковий віджет | MVP | M |
| [CMP-41](CMP-41.md) | AssetTypeWidget — Віджет типу активу | MVP | M |
| [CMP-42](CMP-42.md) | LineChart — Лінійний графік | PoC | M |
| [CMP-43](CMP-43.md) | SmallMultiples — Малі множини | v1 | S |
| [CMP-44](CMP-44.md) | Sparkline — Спарклайн | MVP | M |
| [CMP-45](CMP-45.md) | Treemap — Мозаїка часток | MVP | M |
| [CMP-46](CMP-46.md) | InvestmentChart — Графік інвестиції | MVP | M |
| [CMP-47](CMP-47.md) | BarChart — Стовпчиковий графік | PoC | M |
| [CMP-48](CMP-48.md) | DonutChart — Кільцева діаграма | PoC | M |
| [CMP-49](CMP-49.md) | RingProgress — Кільце прогресу | PoC | M |
| [CMP-50](CMP-50.md) | Waterfall — Каскадна діаграма | MVP | S |
| [CMP-51](CMP-51.md) | Heatmap — Теплова карта | v1 | C |
| [CMP-52](CMP-52.md) | AllocationBar — Смуга розподілу | MVP | M |
| [CMP-53](CMP-53.md) | Card — Картка | PoC | M |
| [CMP-54](CMP-54.md) | Widget — Віджет | MVP | M |
| [CMP-55](CMP-55.md) | BudgetRow — Рядок бюджету | PoC | M |
| [CMP-56](CMP-56.md) | ConnectionCard — Картка підключення | PoC | M |
| [CMP-57](CMP-57.md) | PlanCard — Картка плану | MVP | M |
| [CMP-58](CMP-58.md) | ViewSwitch — Перемикач вигляду | MVP | M |
| [CMP-59](CMP-59.md) | IconButton — Кнопка-іконка | PoC | M |
| [CMP-60](CMP-60.md) | Toolbar — Панель інструментів списку | PoC | M |
| [CMP-61](CMP-61.md) | Menu — Меню і спливна панель | PoC | M |
| [CMP-62](CMP-62.md) | SortMenu — Меню сортування | PoC | M |
| [CMP-63](CMP-63.md) | ColumnPicker — Вибір колонок | PoC | M |
| [CMP-64](CMP-64.md) | Chip — Чип | PoC | M |
| [CMP-65](CMP-65.md) | PillTabs — Вкладки-пігулки | MVP | M |
| [CMP-66](CMP-66.md) | GroupHeader — Заголовок групи активів | MVP | M |
| [CMP-67](CMP-67.md) | FolderCard — Картка папки | MVP | M |
| [CMP-68](CMP-68.md) | MiniMap — Міні-мапа | MVP | S |
| [CMP-69](CMP-69.md) | AppNavigation — Навігація застосунку | PoC (лише розділи «Гроші», «Планування» і «Ще → Налаштування, Імпорт»; стартова сторінка і ціль «На Головну» — «Планування → Бюджет»; корінь «Ще» — «Налаштування»; бічна панель від 1280 px; без Головної, Активів і нижньої панелі); решта — MVP | M |
| [CMP-70](CMP-70.md) | KpiTile — Плитка показника | MVP | M |
| [CMP-71](CMP-71.md) | BrandMark — Знак і назва продукту | PoC | M |
| [CMP-72](CMP-72.md) | PeriodPicker — Вибір періоду аналітичної таблиці | PoC | M |
