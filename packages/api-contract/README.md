# @willowsum/api-contract — контракт API і типізований клієнт

**Створено:** 2026-11-06 · **Оновлено:** 2026-11-07 (ARC-09)

Єдиний задокументований HTTP API для всіх клієнтів (ARC-07, NFR-05 п. 1). Рішення — [ADR-0003](../../docs/adr/0003-api-contract.md).

| Файл | Що |
| --- | --- |
| `openapi.json` | Контракт OpenAPI 3.1, згенерований з маршрутів `apps/api` (ті самі схеми zod, що перевіряють запити). Не редагується вручну |
| `src/schema.ts` | Типи, згенеровані з `openapi.json` (`openapi-typescript`). Не редагується вручну |
| `src/index.ts` | `createApiClient()` (на `openapi-fetch`), тип `Problem`, `isProblem`, `problemSupportCode` (код помилки для екрана — `supportId`, ідентифікатор траси запиту, ARC-09), `newIdempotencyKey` |

Після зміни маршруту: `pnpm contract:write` з кореня і коміт обох файлів. CI (задача `api`) падає, якщо файли
не збігаються з маршрутами або якщо контракт змінився несумісно щодо базової гілки (`contract:compat`).

```ts
import { createApiClient, newIdempotencyKey } from "@willowsum/api-contract";

const api = createApiClient({ baseUrl: "/", credentials: "include" });
const { data, error } = await api.GET("/v1/me/permissions"); // error — problem details з полем code
```
