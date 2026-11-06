# @willowsum/api — бекенд

**Створено:** 2026-11-06 · **Оновлено:** 2026-11-06 (ARC-02)

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
| `node src/main.ts --role api\|worker\|scheduler` | Запускає процес (ARC-02); образ — `docker build -f apps/api/Dockerfile .` з кореня |

## Конфігурація (ARC-02, CICD-12)

Лише змінні середовища; без обов'язкової змінної процес не стартує і називає її (без значення).

| Змінна | Що | Типово |
| --- | --- | --- |
| `WS_PORT` | Порт HTTP (API або лише перевірки `/health/live`, `/health/ready`) | 8080 |
| `WS_SHUTDOWN_TIMEOUT_MS` | Скільки чекати завершення запитів під час зупинки | 30000 |
| `WS_DB_HOST`, `WS_DB_PORT`, `WS_DB_NAME`, `WS_DB_SSL` | Сервер БД | порт 5432, SSL увімкнено |
| `WS_DB_PROBE_PASSWORD` | Пароль ролі `ws_probe` (лише читання списку міграцій для «готовий») | — |
| `WS_DB_PASSWORD_<СХЕМА>` | Пароль ролі входу кожного модуля (`ws_mod_<схема>`) | — |

## Доступ до БД

Код модуля отримує `ModuleDatabase` для свого модуля (`ModuleDatabases.for(<module>)`). Його пул
входить у базу під роллю `ws_mod_<module>`, яка має права лише на схему модуля і не є членом жодної
іншої ролі, тож запит до таблиці іншого модуля база відхиляє (`42501`) за будь-якого SQL.
