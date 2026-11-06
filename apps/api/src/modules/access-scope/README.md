# Модуль access-scope

**Створено:** 2026-11-06 · **Оновлено:** 2026-11-06

Картка модуля (ARC-01). Робота з модулем починається з неї; оновлюйте її в тому ж PR, що й інтерфейс.

## Призначення

Обмеження доступу (scope) і перевірка прав для всіх модулів.

## Вимоги

ARC-07@PoC (перевірка прав на кожному маршруті), NFR-05@PoC (п. 2: права лише на сервері). Матриця — 00-general
§0.3 «Ролі і права» і «Область доступу» (П-5, П-24). Обмеження областей політикою видимості і scope активів
додадуть вимоги ACC/AST, які їх вводять (у PoC — один користувач на простір, шарінгу немає).

## Публічний інтерфейс

`index.ts`:

- `accessScopeModule` — опис модуля з маршрутом `GET /v1/me/permissions` (`getMyPermissions`: роль, scope і
  дозволи того, хто викликає; дозвіл `household.data.read`, ключ функції `household.core`).
- `checkPermission(member, permission)` / `can(member, permission)` — чи має учасник (`{ role, scoped }`) дозвіл;
  невідома роль чи дозвіл — ні; учасник зі scope має лише `household.data.read`; scope буває лише в Editor,
  Viewer і Advisor (`SCOPABLE_ROLES`), а «обмежений» Owner чи Admin не має жодного дозволу.
- `permissionsOf(member)`, `PERMISSIONS` (дозвіл → ролі), `PERMISSION_KEYS`, `ROLES` (`owner`, `admin`,
  `editor`, `viewer`, `advisor`), типи `Member`, `Permission`, `Role`.

Кожен маршрут API називає дозвіл із `PERMISSION_KEYS`; API не стартує з невідомим дозволом (ADR-0003).

## Залежності

Шар: platform. Модулі: — (`apps/api/module-rules.json`).

## Події

| Публікує | Версія | Коли |
| --- | --- | --- |
| — | | |

| Споживає | Версія | Навіщо |
| --- | --- | --- |
| — | | |

## Власні таблиці

Схема `access_scope`; міграції — `adapters/db/migrations/NNNN_slug.sql`. Таблиць поки немає.
