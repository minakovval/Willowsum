# @willowsum/web — web application

**Створено:** 2026-11-02 · **Оновлено:** 2026-11-12 (ACC-01@PoC: реєстрація, підтвердження email, вхід)

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
| `/signup` | `#/signup` | S-001 «Реєстрація» (focus mode, no navigation) |
| `/signup/check-email` | | S-002 «Перевірте пошту» with «Надіслати ще раз» (countdown) and «Змінити email»; without a sign-up in progress it opens `/signup` |
| `/verify` | `#/verify?token=…` | The confirmation link of the letter; S-003 «Посилання недійсне»; a used link opens `/login` (or «Бюджет» with a session). The token is in the fragment and leaves the address bar once read |
| `/login` | `#/login` | S-004 «Вхід» with the lockout, CAPTCHA and «Спершу підтвердіть email» states |
| anything else | | «Сторінку не знайдено» with «На Бюджет» |
| `/gallery/tokens` | `#/gallery/tokens` | DS-22 sample page: colours of both themes with computed contrast, chart palette, amounts, type scale, spacing, radii, shadows and overlay, layers, motion, breakpoints, icons, the mark. Theme, language and «Приховати суми» switches. Not linked from the navigation; `noindex` |

## Requirements covered

| ID | Status | Notes |
| --- | --- | --- |
| DS-22 | Partly | Token gallery as above. Still to add: photo placeholders, charts, map, interaction states, automated axe and screenshot checks |
| DS-11 | Item 7 | `index.html` applies the stored theme before the first paint (`public/theme-init.js`, a blocking script in `<head>`; not inline, so the CSP allows scripts from `'self'` only) |
| NFR-14@PoC | FR 2–4, criterion 4 | `security-headers.ts`: the headers and CSP of every static path (HSTS, nosniff, Referrer-Policy, closed Permissions-Policy, COOP, `X-Frame-Options: DENY`, CSP of the table; HTML shell `no-cache`, hashed `assets/` immutable). `vite preview` sends them; the CSP check runs in CI (`src/security-headers.test.ts`). The staging server or CDN must send exactly `webHeaders(path)` — checked on staging by CICD-07 (ADR-0007) |
| ACC-01@PoC | Part a2 | Client side of AC2, AC4–AC7, AC10, AC12–AC15, AC18–AC24, FR 3, FR 11, FR 12 and the UI states of S-001…S-004 (`src/auth/*.test.tsx`); server side in `apps/api` (part a1). «Забули пароль?» comes with part b |
| DS-02 | Item 12 | Tab title «Willowsum · <page>», the mark as favicon |
| DS-14 | Item 8 | Focus moves to `main` after navigation |
| UX-09@PoC / CMP-69@PoC / CMP-71@PoC / GRID-00@PoC | Partly | L1 «Гроші» and «Планування» with their L2 pages, start page and brand link to «Бюджет», last L2 page per section in the session, active section → root and scroll up, «+ Додати» (Транзакція with «T», Рахунок, Ціль), profile menu → «Налаштування», G→T/B/G/A, collapsible sidebar, focus-mode wizard, «На Бюджет» on not found. Still to do with their screens: page tabs (item 3), breadcrumbs on L3 records, list state on «Назад» (item 9), unsaved-changes dialog in the wizard (AC6), the «До розбору» count source, profile name and space from `identity`. No «Приховати суми» action: the mode is not in PoC (owner decision 2026-11-05); the app pages always show amounts, only the gallery demonstrates the mode |

## Sign-up and sign-in (ACC-01@PoC, part a2)

`src/auth/`: the screens S-001…S-004 on the identity API (`/v1/registrations…`, `/v1/email-confirmations…`,
`/v1/sessions`, `/v1/session`) through the typed client of `@willowsum/api-contract`. The API is on the app's own
origin (CSP `connect-src 'self'`); `pnpm dev` and `preview` pass `/v1` to `WS_API_ORIGIN` (default
`http://localhost:8080`). With the flag `identity.sign-in` off the API answers 404 and the screens say «Реєстрація і
вхід зараз недоступні»; every error shows the request's support code («Код: …», ARC-09).

| Setting | What |
| --- | --- |
| `VITE_CAPTCHA_SITE_KEY` | Cloudflare Turnstile site key (public; build time). Without it — local, CI, tests — a synthetic widget with no network, whose fixed token only the API's synthetic verifier accepts. Production builds must set it (the API refuses the synthetic verifier there) |

`fields.tsx` (Field and password field with «Показати пароль» and the Caps Lock hint, CMP-02), `AuthLayout.tsx` (narrow
card, notice with «Помилка» and the code — CMP-19/CMP-24, inactive button with the reason) and `captcha/` are minimal
versions inside the app until the design-system components exist in `packages/ui`.

## Scripts

`pnpm dev` (from the repo root) · `pnpm --filter @willowsum/web build` → `apps/web/dist/` ·
`pnpm --filter @willowsum/web preview` (serves `dist/` with the production headers and CSP) ·
`pnpm --filter @willowsum/web test`.

Public interface, events, tables: none (application).
