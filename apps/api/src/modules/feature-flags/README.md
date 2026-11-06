# Модуль feature-flags

**Створено:** 2026-11-06 · **Оновлено:** 2026-11-06

Картка модуля (ARC-01). Робота з модулем починається з неї; оновлюйте її в тому ж PR, що й інтерфейс.

## Призначення

Прапорці функцій і аварійні вимикачі: кожна функція має прапорець, що вимикає її в production без релізу, і
вмикається поступово (тестові простори → частка просторів → усі); кожен модуль має аварійний вимикач, після якого
його маршрути відповідають «Тимчасово недоступно», а решта продукту працює. Рішення — [ADR-0004](../../../../../docs/adr/0004-feature-flags.md).

## Вимоги

CICD-06@PoC (п. 1–3), ARC-01@PoC (п. 7: кожна функція має ключ у каталозі функцій і прапорець), DAT-05@PoC
(п. 7: вимкнена функція прихована; серверна частина). Інтерфейс власника для прапорців — пізніше (ADM).

## Публічний інтерфейс

`index.ts`:

- `featureFlagsModule` — опис модуля; маршрут `GET /v1/me/features` (`getMyFeatures`): ключі функцій, увімкнених
  для простору сеансу; вимкнені не перелічуються.
- `FLAGS`, `FLAG_KEYS` — каталог прапорців у коді: ключ = ключ функції `plan-catalog`; `kind` (`release` — тимчасовий,
  видаляється ≤ 30 днів після повного вмикання; `operational` — постійний вимикач), `owner` (роль або команда),
  `reviewBy`, для `release` — `fullyEnabledOn`. Модуль не завантажиться, якщо ключі прапорців і ключі функцій різняться.
- `createFlagRuntimeFor(db, options?)` → `FlagRuntime` (одна на процес API, `src/api.ts`):
  `isModuleAvailable(module)`, `isEnabled(householdId, flag)`, `enabledFlags(householdId)`, `refresh()`, `loaded`, `fresh`.
  Стан кешується; його вік рахується від початку завантаження; перший запит після `REFRESH_MS` (15 с) перечитує його і
  чекає не довше `LOAD_WAIT_MS` (2 с). Невдале чи зависле перечитування лишає останній стан, поки йому менше
  `KILL_SWITCH_MAX_DELAY_MS` (60 с — межа CICD-06); без такого стану модулі недоступні, прапорці вимкнені, `fresh` — false.
- `createFlagAdminFor(db, audit, modules)` → `FlagAdmin` — єдиний спосіб змінити стан: `setRollout(actor, key, rollout)`,
  `setKillSwitch(actor, module, disabled)`, `setTestHousehold(actor, householdId, isTest)`, `state()`, `overdue(now)`.
  Автор — `{ kind: "staff", id }` або `{ kind: "system" }`. Кожна зміна пише запис аудиту (`AUDIT_ENTITY`): прапорці й
  вимикачі — у журнал платформи (з полем `flag` чи `module`), позначка тестового простору — у журнал простору; зміна без
  різниці нічого не пише. Після `rollout <release-прапорець> all` скрипт нагадує записати `fullyEnabledOn`.
  Персонал викликає його через `node scripts/flags.ts` (`state`, `rollout`, `kill`, `revive`, `test-space`, `--actor`).
- `flagReviewProblems(flags, today, featureKeys)`, `utcDay` — правила `pnpm check:flags`; `bucketOf(flag, householdId)`
  — кошик 0–99 (FNV-1a від «<ключ>:<простір>»).
- Типи `FlagRuntime`, `FlagAdmin`, `FlagActor`, `FlagSnapshot`, `FlagDefinition`, `FlagKey`, `FlagKind`, `Rollout`,
  `RolloutStage`; константи `REFRESH_MS`, `LOAD_WAIT_MS`, `KILL_SWITCH_MAX_DELAY_MS`, `FULL_ROLLOUT_MAX_DAYS`, `ROLLOUT_STAGES`.

Етапи (`Rollout`): `off` (типово: прапорець без збереженого стану), `test` (лише тестові простори), `share` + `percent`
1–99 (тестові простори + простори з кошиком < `percent`), `all`.

Маршрути API оголошують прапорець через `access.feature`; підфункція додає власний `access.flag`, і тоді потрібні обидва.
До читання тіла API відповідає 503 `MODULE_UNAVAILABLE`, поки вимикач модуля ввімкнено, і 404 `NOT_FOUND`, поки прапорець
вимкнений для простору (ADR-0004).

Прапорці: `household.core` — `operational`, власник `product-owner`, перегляд до 2027-02-04.

## Залежності

Шар: platform. Модулі: plan-catalog (ключі функцій), audit (записи змін) (`apps/api/module-rules.json`).

## Події

| Публікує | Версія | Коли |
| --- | --- | --- |
| — | | |

| Споживає | Версія | Навіщо |
| --- | --- | --- |
| — | | |

## Власні таблиці

Схема `feature_flags`; міграції — `adapters/db/migrations/NNNN_slug.sql`.

| Таблиця | Що | Дані клієнтів |
| --- | --- | --- |
| `flags` | Стан випуску прапорця: `key`, `stage`, `percent` (0 / 1–99 / 100), `fully_enabled_at`, `changed_at` | Ні (виняток у `schema-exemptions.json`) |
| `kill_switches` | Вимикач модуля: `module`, `disabled`, `changed_at` | Ні (виняток у `schema-exemptions.json`) |
| `test_households` | Позначки тестових просторів з історією: `household_id`, `marked_at`, `unmarked_at` (поточна — `unmarked_at IS NULL`, одна на простір) | Так: політика рядків простору |

Синтетичні дані: `synthetic.ts` (`test_households`, типово 1 позначка на простір).
