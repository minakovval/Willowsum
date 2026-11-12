# Модуль identity

**Створено:** 2026-11-12 · **Оновлено:** 2026-11-12

Картка модуля (ARC-01). Робота з модулем починається з неї; оновлюйте її в тому ж PR, що й інтерфейс.

## Призначення

Реєстрація, вхід, 2FA, passkey, сесії, step-up, блокування входу. Зараз (ACC-01@PoC, частини a і b): реєстрація за email і
паролем, підтвердження email, вхід з блокуванням і CAPTCHA, серверна сесія, вихід, скидання пароля з завершенням усіх
сесій; частина c — перший простір під час першого входу (через порт `FirstSpace`, який реалізує `household`) і щоденна
задача. Рішення — [ADR-0009](../../../../../docs/adr/0009-identity-sign-in.md),
[ADR-0010](../../../../../docs/adr/0010-first-space-and-daily-cleanup.md).

## Вимоги

ACC-01@PoC (частина a: п. 1–5, 8, 9, 11–15; частина b: п. 10 і AC25; частина c: п. 6, 7, AC5, AC8, AC9 — серверна
частина; п. 16, AC26, AC27 — перелік адрес родини, #107); NFR-01@PoC (п. 7, 9, 10), NFR-14@PoC (п. 7), NFR-15@PoC (п. 1, 2, 3, 5), NFR-12@PoC (непідтверджений акаунт).
Далі: ACC-04 — тайм-аут сесії і лист про новий пристрій.

## Публічний інтерфейс

`index.ts`:

- `identityModule` — опис модуля; публічні маршрути модуля (без сесії; за вимикачем модуля і прапорцем
  `identity.sign-in`, який діє лише на етапі `all`):
  - `POST /v1/registrations` (`signUp`) — ім'я, email, пароль (≥ 12 символів), `captchaToken` → завжди
    `{ status: "check-email", registrationToken, resendAfterS }`; 429 `RATE_LIMITED` після 5 реєстрацій на годину з
    адреси; 400 `CAPTCHA_REQUIRED`.
  - `POST /v1/registrations/resend` (`resendRegistrationEmail`), `POST /v1/registrations/change-email`
    (`changeRegistrationEmail`) — дії екрана «Перевірте пошту» за `registrationToken`; однакові для нового й наявного
    email; 429 з `Retry-After` за лімітом листів (60 с, 5 на годину).
  - `POST /v1/email-confirmations` (`confirmEmail`) → `{ result: confirmed | expired | already-used | invalid }`, без сесії;
    `POST /v1/email-confirmations/resend` (`resendConfirmationEmail`) — нове посилання замість простроченого.
  - `POST /v1/sessions` (`signIn`) → `signed-in` (cookie `__Secure-session`) або `email-not-confirmed` з
    `registrationToken`; 401 `INVALID_CREDENTIALS`, 429 `SIGN_IN_LOCKED`, 400 `CAPTCHA_REQUIRED`.
  - `GET /v1/session` (`getSession`) → `{ name, email }` або 401; `DELETE /v1/session` (`signOut`).
  - `POST /v1/password-resets` (`requestPasswordReset`) — email → завжди `{ status: "requested" }`; пошук акаунта,
    посилання (60 хв, одноразове, новіше скасовує попередні; лист не частіше раз на 60 с і 5 на годину) і лист — після
    відповіді.
  - `POST /v1/password-resets/check` (`checkPasswordReset`) — токен → `{ status: "valid" }` або 410
    `RESET_LINK_INVALID`; нічого не змінює.
  - `POST /v1/password-resets/complete` (`completePasswordReset`) — токен і новий пароль (≥ 12 символів) →
    `{ status: "password-changed" }`: пароль змінено, усі сесії акаунта завершено (cookie цього браузера видалено, нової
    сесії немає), email підтверджено, блокування входу адреси знято, безпекове сповіщення; 410 `RESET_LINK_INVALID`.
  - Реєстрація відкрита лише для адрес родини (`signUpAllowlist`, ACC-01 п. 16): адреса поза переліком отримує ту саму
    відповідь (той самий хеш пароля і та сама транзакція з токеном), але акаунт не створюється і лист не йде; її токен
    (рядок `registrations` виду `outside`, без акаунта й адреси) відповідає на «Надіслати ще раз» і «Змінити email»
    так само і нічого не надсилає.
  - Повторна реєстрація з адресою непідтвердженого акаунта замінює його ім'я і пароль і скасовує посилання (рішення
    власника 2026-11-12); підтверджений акаунт не змінюється.
- `createIdentityServices({ mail, captcha, audit, webOrigin, spaces, signUpAllowlist?, now?, hasher?, deliver? })` → `IdentityServices` —
  порти і налаштування, які `src/api.ts` передає маршрутам (`ctx.services`); `main.ts` вибирає реалізації пошти й
  CAPTCHA за `WS_PROVIDER_MODE`, а перелік адрес родини — з `WS_SIGNUP_ALLOWLIST` (без нього — будь-яка адреса; у
  `staging`/`production` роль `api` без нього не стартує). `spaces` (порт `FirstSpace`) — `ensureFirstSpace` модуля `household`: вхід
  підтвердженого акаунта створює перший простір «Родина <Прізвище>», якщо простору ще немає; якщо простір не вдалося
  створити, нова сесія завершується, а вхід відповідає 500.
- `authenticateSession(services, db, token)` → `{ accountId, name, email }` або null — жива сесія підтвердженого акаунта
  (рухає строк бездіяльності); `src/api.ts` будує з неї і простору акаунта того, хто викликає захищені маршрути.
- `createIdentityMaintenance({ db, audit, now? })` → `{ dailyCleanup() }` — щоденна задача ролі `scheduler`: видаляє
  непідтверджені акаунти через 30 днів після останньої реєстрації (`UNCONFIRMED_ACCOUNT_TTL_MS`; запис у журнал
  платформи без адреси) і прибирає рядки, що вже не змінюють жодної відповіді чи ліміту (ADR-0010).
- `argon2Hasher(parameters?)`, `ARGON2_PARAMETERS`, `SESSION_COOKIE` і числа правил (`CONFIRMATION_TTL_MS`,
  `PASSWORD_RESET_TTL_MS`,
  `MAIL_COOLDOWN_MS`, `MAIL_PER_HOUR`, `PASSWORD_MIN_LENGTH`, `SESSION_ABSOLUTE_MS`, `SESSION_IDLE_MS`,
  `SIGN_IN_FAILURE_WINDOW_MS`, `SIGN_IN_FAILURES_LIMIT`, `SIGN_IN_LOCK_MS`, `SIGN_UPS_PER_ADDRESS_PER_HOUR`).

Листи (українською, англійська повна): підтвердження з посиланням `<WS_WEB_ORIGIN>/#/verify?token=…` (24 год) і лист про
спробу реєстрації з наявним email — лише з посиланням `<WS_WEB_ORIGIN>/#/password/reset`; лист скидання з посиланням
`<WS_WEB_ORIGIN>/#/password/reset?token=…` (60 хв) і безпекове сповіщення про зміну пароля (лише посилання на сторінку
скидання). Веб маршрутизує у фрагменті URL, тож токени не потрапляють на сервер і в Referer. Надсилаються після
відповіді; невдача — подія `identity.mail_failed` лише з класом помилки; невдача роботи після відповіді —
`identity.task_failed`.

## Залежності

Шар: platform. Модулі: audit (`apps/api/module-rules.json`) — зміни стану акаунта в журнал платформи (автор `system`,
сутність `identity.account`, поле `state`, без email). `household` — лише через порт `FirstSpace`, який передає
`main.ts`; identity його не імпортує.

## Події

| Публікує | Версія | Коли |
| --- | --- | --- |
| — | | |

| Споживає | Версія | Навіщо |
| --- | --- | --- |
| — | | |

## Власні таблиці

Схема `identity`; міграції — `adapters/db/migrations/NNNN_slug.sql`. Жодна таблиця не має `household_id`: акаунт — вхід
людини, а не дані простору (виняток із причиною в `schema-exemptions.json`, ADR-0009). Токени й адреси в ключах — лише
SHA-256.

| Таблиця | Що |
| --- | --- |
| `accounts` | Email (як введено і нормалізований, унікальний), ім'я, хеш argon2id, `email_confirmed_at` |
| `email_confirmations` | Посилання підтвердження: SHA-256 токена, строк (24 год), `used_at`, `revoked_at` |
| `registrations` | Токен екрана «Перевірте пошту»: акаунт (немає для `outside`), `kind` (`new` / `existing` / `outside` — адреса поза переліком родини), строк, `closed_at`, `superseded_at` (пізніша реєстрація замінила пароль непідтвердженого акаунта) |
| `password_resets` | Посилання скидання пароля: SHA-256 токена, строк (60 хв), `used_at`, `revoked_at` |
| `sessions` | SHA-256 токена сесії, `last_seen_at`, `expires_at` (12 год), `ended_at` |
| `sign_in_guards` | Блокування входу на email (SHA-256 адреси): `locked_until`, `captcha_required` |
| `throttle_events` | Події ковзних лімітів: невдалі входи, листи підтвердження і про спробу реєстрації (на адресу), «Надіслати ще раз» (на токен реєстрації), реєстрації (на адресу клієнта, будь-яка година) |

Скільки живуть рядки: щоденна задача (ADR-0010) видаляє непідтверджені акаунти через 30 днів після останньої
реєстрації з усіма їхніми рядками, а з решти таблиць — те, що вже не змінює жодної відповіді чи ліміту (події лімітів і
посилання скидання — через 1 год, завершені сесії, закриті й прострочені реєстрації, скасовані посилання підтвердження
одразу, рядки захисту входу без позначки CAPTCHA і без чинного блокування). Використані й прострочені посилання
підтвердження і позначка CAPTCHA не прибираються (AC6, AC14, AC24): перші відходять разом з акаунтом, другу знімає
успішний вхід або скидання пароля. Пакет чи прибирання, перервані взаємоблокуванням (`40P01`), повторюються до двох разів.

Синтетичні дані: немає (таблиці не мають даних простору; тести створюють акаунти через API з адресами `@example.test`).
