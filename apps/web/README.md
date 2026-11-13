# @willowsum/web — web application

**Створено:** 2026-11-02 · **Оновлено:** 2026-11-13 (NFR-07@PoC: наскрізні тести і перевірка контрасту маршрутів)

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
| NFR-09@PoC | FR 1–3 | The pseudo-locale `en-XA` is offered in development, test and CI builds (`src/i18n/languages.ts`): `?lang=en-XA#/planning/budget` opens the app in it, and the gallery language switch lists it; the production build never offers it and ignores `?lang=`. `src/i18n/pseudoLocale.test.tsx` opens every app screen in it and fails on any text that is not pseudo-localised. ESLint rule `willowsum/no-hardcoded-ui-strings` (root config) forbids hard-coded interface text in `apps/web/src` and `packages/ui/src`; `src/i18n/noHardcodedStrings.test.ts` checks the rule and that it applies to every interface file |
| NFR-07@PoC, DS-06@PoC AC2 | FR 1–3, AC1, EC1; AC2 | End-to-end tests in `e2e/` (below). EC1: `src/browser/` — an unsupported browser (`browserSupport`: versions released in the last 3 months — `SUPPORTED_BROWSERS` stores each minimum with its release date and the check date, Chromium from 153, Safari from 27 on 2026-11-13; a unit test fails when the check is older than 45 days; Firefox and anything unreadable are unsupported in PoC) sees a polite warning naming Chrome, Edge and Safari at the top of every auth card; sign-in is not blocked. Unit tests run as a supported Chrome (`vitest.config.ts`) |
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
| `VITE_CAPTCHA_SITE_KEY` | Cloudflare Turnstile site key (public; build time). Without it — local, CI, tests — a synthetic widget with no network, whose fixed token only the API's synthetic verifier accepts. Required for the deploy build: `pnpm --filter @willowsum/web build:production` (mode `production`) fails without a well-formed key; `pnpm build` (mode `ci`, local and CI) does not need it |

`fields.tsx` (Field and password field with «Показати пароль» and the Caps Lock hint, CMP-02), `AuthLayout.tsx` (narrow
card, notice with «Помилка» and the code — CMP-19/CMP-24, inactive button with the reason) and `captcha/` are minimal
versions inside the app until the design-system components exist in `packages/ui`.

## End-to-end tests (NFR-07@PoC)

`e2e/` — Playwright in Chromium and WebKit at 1280 × 800, light theme (Firefox from PoC v2). `global-setup.ts` starts
the stack once: a fresh database on the server of `DATABASE_URL` (a PostgreSQL superuser URL) with `db:bootstrap`, every
migration and the module logins, the real API process (`apps/api/test/e2e-support.ts`, synthetic providers), and the
`vite build --mode ci` output behind `vite preview` over HTTPS with a certificate made for the run (production headers
and CSP; `/v1` passed to the API; over plain http WebKit on Linux drops the `Secure` session cookie). The synthetic
mail stays in the API process, so a test gets the confirmation letter's link by putting a token of its own in place of
the live link's digest.

| File | What |
| --- | --- |
| `auth.spec.ts` | Sign-up → «Перевірте пошту» → the letter's link → sign-in → «Бюджет»; an unconfirmed account; a wrong password; an unknown link |
| `browser.spec.ts` | NFR-07@PoC EC1: no notice in the engines under test; with a Firefox user agent the notice, its contrast, and sign-up → confirmation → sign-in still working |
| `layout.spec.ts` | The 212 px sidebar with labels on the left, 24 px gutters (token and a rendered grid gap), content at most 1200 px, no horizontal scroll |
| `contrast.spec.ts` | DS-06@PoC AC2: every route of `src/routing/routes.ts` and the auth screens' API-driven states: text ≥ 4.5 : 1, controls ≥ 3 : 1 (`contrast.ts`; it reports what it cannot measure) |
| `contrast-check.spec.ts` | The check itself finds low contrast on a synthetic page |

Run: `DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres pnpm test:e2e` (builds, then tests; extra Playwright
arguments go at the end, e.g. `--project=chromium`). Integration runs share the cluster's roles, so on a shared server
wrap it: `pnpm db:test run -- pnpm test:e2e`. `WS_E2E_CHROMIUM_PATH` uses an already installed Chromium. CI job `e2e`
installs and caches only Chromium and WebKit.

## Scripts

`pnpm dev` (from the repo root) · `pnpm --filter @willowsum/web build` → `apps/web/dist/` (mode `ci`, synthetic CAPTCHA without a key) · `build:production` (the deploy build; needs `VITE_CAPTCHA_SITE_KEY`) ·
`pnpm --filter @willowsum/web preview` (serves `dist/` with the production headers and CSP) ·
`pnpm --filter @willowsum/web test`.

Public interface, events, tables: none (application).
