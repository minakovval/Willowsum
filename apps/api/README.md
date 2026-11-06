# @willowsum/api — бекенд

**Створено:** 2026-11-06 · **Оновлено:** 2026-11-06

Один застосунок на TypeScript, розділений на модулі з жорсткими межами (ARC-01). Стек і правила —
[ADR-0001](../../docs/adr/0001-backend-stack.md).

## Будова

| Шлях | Що |
| --- | --- |
| `src/modules/<module>/` | Модуль: `index.ts` (публічний інтерфейс і події), `domain/`, `application/`, `adapters/` (зокрема `adapters/db/migrations/NNNN_slug.sql`), картка `README.md` |
| `src/modules/index.ts` | Реєстр модулів (генератор додає сюди) |
| `src/platform/` | Інфраструктурний код без бізнес-правил: БД (`db/`), події (`events/`), опис модулів (`modules/`) |
| `module-rules.json` | Єдиний файл правил: модулі, шар, від яких модулів залежить кожен |
| `events.snapshot.json` | Опубліковані версії подій і схеми їхніх даних |
| `scripts/` | `new-module`, `check-modules`, `events-snapshot`, `migrate` |

## Команди

| Команда | Що робить |
| --- | --- |
| `pnpm new-module <name> [--depends a,b] [--layer platform\|subject\|process]` | Створює модуль із каталогу ARC-01 і реєструє його |
| `pnpm check:modules` | Правила модулів, аналізатор імпортів, контракти подій (CI-задача `api`) |
| `pnpm --filter @willowsum/api events:snapshot` | Записує нові версії подій; несумісну зміну відхиляє |
| `pnpm --filter @willowsum/api test` | Юніт-тести (без БД і мережі) |
| `DATABASE_URL=… pnpm test:integration` | Інтеграційні тести на реальному PostgreSQL (суперкористувач тимчасової БД) |
| `DATABASE_URL=… pnpm --filter @willowsum/api migrate` | Застосовує міграції від імені ролі-власника схем |

## Доступ до БД

Код модуля отримує `ModuleDatabase` для свого модуля: кожна транзакція перемикається на роль
`ws_mod_<module>` і схему модуля, тож запит до таблиці іншого модуля база відхиляє (`42501`).
Роль застосунку `ws_app` власних прав не має.
