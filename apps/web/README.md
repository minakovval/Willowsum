# @willowsum/web — web application

**Purpose.** The user web app (Vite + React 19). For now it holds the PoC app shell (UX-09@PoC,
CMP-69@PoC) with placeholder pages and the design-system sample page.

## Routes

Routes use the URL hash, so the static build works from any folder (`base: "./"`) with no server
rewrites.

| Route | URL | What |
| --- | --- | --- |
| `/` | `#/` | Opens `/planning/budget` (start page, UX-09@PoC item 5) |
| `/money`, `/planning` | `#/money` … | Open the section root (`/money/transactions`, `/planning/budget`) |
| `/money/transactions`, `/money/accounts` | | «Гроші» L2 pages (placeholders); «Транзакції» has «Імпортувати виписку» and «Історія імпорту» |
| `/planning/budget`, `/planning/goals`, `/planning/recurring`, `/planning/afford`, `/planning/debts` | | «Планування» L2 pages (placeholders) |
| `/money/transactions/import` | | «Імпорт» (import history), with breadcrumbs |
| `/money/transactions/new`, `/money/accounts/new`, `/planning/goals/new` | | «+ Додати» targets (placeholders); the transaction one has «Імпортувати виписку» |
| `/import` | | Statement import wizard in focus mode (no navigation; «×» goes back by history) |
| `/settings` | | «Налаштування», from the profile menu |
| anything else | | «Сторінку не знайдено» with «На Бюджет» |
| `/gallery/tokens` | `#/gallery/tokens` | DS-22 sample page: colours of both themes with computed contrast, chart palette, amounts, type scale, spacing, radii, shadows and overlay, layers, motion, breakpoints, icons, the mark. Theme, language and «Приховати суми» switches. Not linked from the navigation; `noindex` |

## Requirements covered

| ID | Status | Notes |
| --- | --- | --- |
| DS-22 | Partly | Token gallery as above. Still to add: photo placeholders, charts, map, interaction states, automated axe and screenshot checks |
| DS-11 | Item 7 | `index.html` applies the stored theme before the first paint |
| DS-02 | Item 12 | Tab title «Willowsum · <page>», the mark as favicon |
| DS-14 | Item 8 | Focus moves to `main` after navigation |
| UX-09@PoC / CMP-69@PoC / CMP-71@PoC / GRID-00@PoC | Partly | L1 «Гроші» and «Планування» with their L2 pages, start page and brand link to «Бюджет», last L2 page per section in the session, active section → root and scroll up, «+ Додати» (Транзакція with «T», Рахунок, Ціль), profile menu → «Налаштування», G→T/B/G/A, collapsible sidebar, focus-mode wizard, «На Бюджет» on not found. Still to do with their screens: page tabs (item 3), breadcrumbs on L3 records, list state on «Назад» (item 9), unsaved-changes dialog in the wizard (AC6), the «До розбору» count source, profile name and space from `identity` |

## Scripts

`pnpm dev` (from the repo root) · `pnpm --filter @willowsum/web build` → `apps/web/dist/` ·
`pnpm --filter @willowsum/web test`.

Public interface, events, tables: none (application).
