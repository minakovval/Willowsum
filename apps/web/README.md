# @willowsum/web — web application

**Purpose.** The user web app (Vite + React 19). For now it holds the app shell with placeholder
L1 sections and the design-system sample page.

## Routes

Routes use the URL hash, so the static build works from any folder (`base: "./"`) with no server
rewrites.

| Route | URL | What |
| --- | --- | --- |
| `/` | `#/` | Shell, «Головна» (placeholder heading and empty state) |
| `/money`, `/assets`, `/planning`, `/more` | `#/money` … | Shell with the section current (placeholders) |
| `/gallery/tokens` | `#/gallery/tokens` | DS-22 sample page: colours of both themes with computed contrast, chart palette, amounts, type scale, spacing, radii, shadows and overlay, layers, motion, breakpoints, icons, the mark. Theme, language and «Приховати суми» switches. Not linked from the navigation; `noindex` |

## Requirements covered

| ID | Status | Notes |
| --- | --- | --- |
| DS-22 | Partly | Token gallery as above. Still to add: photo placeholders, charts, map, interaction states, automated axe and screenshot checks |
| DS-11 | Item 7 | `index.html` applies the stored theme before the first paint |
| DS-02 | Item 12 | Tab title «Willowsum · <page>», the mark as favicon |
| DS-14 | Item 8 | Focus moves to `main` after navigation |
| CMP-69 / UX-09 | Partly | Uses `AppShell` from `@willowsum/ui` with Головна, Гроші, Активи, Планування, Ще. No «Приховати суми» action: the mode is not in PoC (owner decision 2026-11-05); the app pages always show amounts, only the gallery demonstrates the mode |

## Scripts

`pnpm dev` (from the repo root) · `pnpm --filter @willowsum/web build` → `apps/web/dist/` ·
`pnpm --filter @willowsum/web test`.

Public interface, events, tables: none (application).
