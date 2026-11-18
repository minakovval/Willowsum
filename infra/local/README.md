# Local environment

**Створено:** 2026-11-06 · **Оновлено:** 2026-11-18 (`pnpm local:backup`, `pnpm local:restore`; 2026-11-16: `pnpm local:dev`; free ports, closing the window, leftovers — #363)

CICD-04, row «Локальне»: the backing services the app needs, started with one command, holding only
synthetic data.

| Service | Technology | Address (127.0.0.1 only) | Licence |
| --- | --- | --- | --- |
| Database | PostgreSQL 17 (UTC) | `127.0.0.1:5432` | PostgreSQL |
| Mail | Mailpit: SMTP catches every message, nothing leaves the machine; SMTP and the web UI need the generated logins | SMTP `127.0.0.1:1025`, web UI `http://127.0.0.1:8025` | MIT |
| File storage | SeaweedFS S3 gateway, path-style, bucket `willowsum-files` | `http://127.0.0.1:8333` | Apache-2.0 |

## Commands

Requires Docker with the compose plugin and Node 22.18 or newer, 22 or 24 LTS (macOS or Linux; Windows is not supported). From the repository root:

| Command | What it does |
| --- | --- |
| `pnpm local:up` | Starts everything, waits until healthy, creates the bucket. The first run generates local credentials. |
| `pnpm local:status` | Services, health and where to connect. Never prints secrets. |
| `pnpm local:smoke` | End-to-end check: SQL query, mail over SMTP, S3 put/get, and refusal without credentials. |
| `pnpm local:down` | Stops; data is kept. |
| `pnpm local:reset` | Stops, deletes all local data (volumes), starts empty. |
| `pnpm local:backup [file]` | A copy of the `pnpm local:dev` database in a file (below). |
| `pnpm local:restore <file> [--yes]` | Replaces the `pnpm local:dev` database with a copy from a file (below). |
| `pnpm local:dev` | The whole app to click through: the services above, then the API, worker, scheduler and web app (below). |

## The whole app (`pnpm local:dev`)

One command for a person who wants to use the app locally, not only run tests. **Windows is not supported**; the
steps below are for macOS (Terminal app).

**Once, to set up**

1. Install [Node.js](https://nodejs.org) 22.18 or newer, **22 or 24 LTS** (the LTS installer is fine; Node 25 and newer do not bring `corepack`: then run `npm install -g corepack` first). Check: `node -v` prints `v22.18`
   or higher.
2. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and open it. (Without Docker: a local
   PostgreSQL 16 or newer and its superuser URL, see «Without Docker» below.)
3. Get the code: `git clone https://github.com/minakovval/Willowsum.git`, then `cd Willowsum`.
4. `corepack enable` (makes the `pnpm` command available; if macOS says permission denied, run
   `sudo corepack enable`), then `pnpm install`.

**Every time**

1. Open Docker Desktop and wait until it says it is running (not needed with your own PostgreSQL).
2. In the repository folder run:

```bash
pnpm local:dev
```

3. Wait for «Willowsum is running», then open `http://localhost:5173` in Chrome and sign up.
4. Letters are not sent. Type the email you signed up with in the Terminal window and press Enter: it prints a
   confirmation link; open it in Chrome.
5. Ctrl+C in the Terminal, or closing the Terminal window, stops everything; your data is kept.
   `pnpm local:dev --fresh` starts with an empty database.
6. Something from an earlier run still running (a window closed while it was starting, a crash)? Just run
   `pnpm local:dev` again: it stops what is left of its own earlier run by itself. No `pkill` is needed.

It starts the services (`local:up`), then on the database `ws_dev` of the same PostgreSQL: `db:bootstrap` the
first time, the migrations on every start, a login for every module role with a password made for this run (never
printed or written), every release flag on (CICD-06; operational flags keep their state). Then the processes
`api`, `worker` and `scheduler` (ARC-02) on free ports picked on every start, listening only on `127.0.0.1`
(`WS_HOST`), and the web dev server on `http://localhost:5173` with `/v1` passed to the API (`WS_API_ORIGIN`).
Other tools on this Mac (Colima/Lima port forwards, other containers) may hold any port 8080–8089: the run does
not need them. Providers are synthetic (`WS_PROVIDER_MODE=test`): no
CAPTCHA service, no mail, no exchange-rate service — nothing leaves the machine. Process output goes to
`infra/local/.state/dev/<process>.log` (git-ignored).

- **Confirming an email.** The synthetic mail adapter keeps letters inside the API process. After signing up, type
  the email in the terminal and press Enter: it prints the confirmation link. `limits` clears the sign-up limits.
- **Data is kept** between runs (`ws_dev`). `pnpm local:dev --fresh` drops it and starts empty; `pnpm local:reset`
  deletes all local data.
- **Ctrl+C or closing the window** stops every process. A process whose `pnpm local:dev` is gone (killed, or the
  window closed before it could stop them) stops by itself within a second or two. Open the app in Chrome: the session cookie is always `Secure`, which Chrome accepts
  on `http://localhost` and Safari may not.
- **Leftovers.** The pids of a run are kept in `infra/local/.state/dev/pids.json` (git-ignored). The next start
  stops the processes listed there that are still the same processes (same pid, start time and command line), so a
  number the system has since given to another program is never touched.
- **Cluster lock.** Module roles belong to the whole PostgreSQL cluster and this command sets their passwords, so it
  holds the cluster lock while it runs: `pnpm test:integration` and `pnpm db:test run` on the same server wait until
  it stops. If it has to wait itself, it says who holds the lock: another `pnpm local:dev` (from another copy of the
  repository) in the next window — close it; integration tests — it goes on by itself when they end.
- Without Docker: `WS_TEST_PG_ADMIN_URL=postgres://<superuser>@127.0.0.1:5432/postgres pnpm local:dev` uses your own
  PostgreSQL 16 or newer instead (same variable as `pnpm db:test`). Only a server on this machine (`127.0.0.1`, `::1`,
  `localhost` or a Unix socket) is accepted: the command resets role passwords and may drop `ws_dev`.
- The web dev server gets only `PATH`, `HOME` and the API address, not the rest of your environment.
- Port 5173 must be free (the browser opens it): the command checks it on `127.0.0.1`, `::1` and every address and
  names the program to look for (`lsof -nP -iTCP:5173 -sTCP:LISTEN`). If a process fails to start or is not ready in
  60 s, the command stops and prints the end of its log and the reason from `/health/ready`.

## Копія бази і відновлення (`pnpm local:backup`, `pnpm local:restore`)

Для власника: ваша ручна робота в `pnpm local:dev` лежить у базі `ws_dev`. `pnpm local:reset` або видалення тома
Docker стирає її без вороття, тому час від часу зберігайте копію у файл. Команди чіпають лише `ws_dev` на цьому
комп'ютері; тестові бази і чужі сервери — ніколи.

**Зберегти копію**

1. Запустіть `pnpm local:dev` хоча б раз, щоб база існувала (Docker Desktop відкритий).
2. У папці репозиторію: `pnpm local:backup` (файл `~/Willowsum-backups/ws_dev-<дата і час>.dump`) або
   `pnpm local:backup ~/Documents/moya-kopiya.dump`.
3. Команда друкує шлях і розмір файлу, поряд кладе `<файл>.roles.sql` (ролі модулів без паролів). Існуючий файл
   вона не перезаписує. Копію можна зберігати і в хмарі, але це справжня ваша робота: не ділитися нею.

**Відновити з файлу**

1. Зупиніть `pnpm local:dev` (Ctrl+C). Docker Desktop відкритий.
2. `pnpm local:restore ~/Willowsum-backups/ws_dev-….dump`. Команда перевіряє файл, друкує шлях і розмір і питає
   «yes» перед тим, як замінити базу. Без питання: додайте `--yes`.
3. Дочекайтеся «Restored ws_dev», далі `pnpm local:dev`: програма стартує з вашими даними.
4. Том видалено? Спершу `pnpm local:up`, потім пункт 2: ролі беруться з `.roles.sql` поряд із файлом.
   Збережіть обидва файли разом.

Без Docker: ті самі команди з `WS_TEST_PG_ADMIN_URL=postgres://<superuser>@127.0.0.1:5432/postgres` і клієнтами
`pg_dump`, `pg_restore`, `psql` у PATH. Помилка «database is being accessed by other users» — `pnpm local:dev` ще
працює: зупиніть його.

## Test database per agent (`pnpm db:test`)

Owner decision 2026-11-12: each agent (up to 3 branches work in parallel) gets its own throwaway database.

| Command | What it does |
| --- | --- |
| `pnpm db:test` | Creates `ws_t_<branch>_<random>`, prints its `DATABASE_URL` with the password hidden and writes the full one to `infra/local/.state/db-test/<name>.env` (git-ignored; `set -a; . <file>; set +a`). |
| `pnpm db:test run -- <command>` | Fresh database, `DATABASE_URL` set for the command, dropped afterwards; holds a cluster-wide lock meanwhile. |
| `pnpm db:test list` / `pnpm db:test drop <name>` | Lists / drops this tool's databases (it refuses any other name). |

Server: `WS_TEST_PG_ADMIN_URL` (a superuser URL of a machine's own local PostgreSQL, e.g. in a cloud session
without Docker) wins; otherwise the `pnpm local:up` PostgreSQL, started if needed.

**Limitation.** PostgreSQL roles belong to the whole cluster, not to a database. The integration tests set the
passwords of the module login roles (`ws_mod_<schema>`, `ws_context`, `ws_probe`) and some drop and recreate
roles, so two integration runs on one cluster break each other even in separate databases. Run them only as
`pnpm db:test run -- pnpm test:integration`: the lock makes runs on one cluster wait for each other. The
integration config's globalSetup (`apps/api/test/cluster-lock.ts`) takes the same lock, so a bare `vitest` or
`pnpm test:integration` run queues too; the lock lives in the `postgres` database of the cluster
(`tools/test-guards/cluster-lock.mjs`), and a run started by `pnpm db:test run` does not take it twice. Separate
databases are enough for everything else (migrations, `check:schema`, running the API). Run-scoped role names
would remove the wait but change the isolation guard (ADR-0002); that is a follow-up.

**Limitation: the lock table.** The lock table also belongs to the whole cluster: `max_locks_per_transaction` ×
`max_connections` slots (64 × 100 by default) for all databases together. One transaction that takes thousands of
locks — for example a bulk insert through a trigger that takes an advisory lock per row — leaves no slot for the
others, and for that moment a statement in any other database fails with «out of shared memory» (SQLSTATE 53200).
On 2026-11-14 a 20 000-row probe in a hand-made database failed the ledger migration of a full integration run this
way (#222). Run such a probe, and any other experiment that loads the cluster, as `pnpm db:test run -- <command>`:
it then holds the same lock as the integration runs and waits for them. The integration tests' setup names this
cause when it meets it (`apps/api/test/real-modules.ts`, `sharedLockTableFull`).

## Credentials

No credentials are written by people or committed (CICD-12). On the first `pnpm local:up` the tool
generates random values (≥ 32 bytes for every password and the S3 secret key) into
`infra/local/.state/local.env` (git-ignored, mode 0600). Later runs reuse them. The API (once it exists, ARC-01) will read
its local configuration from that file. To get new values, delete `infra/local/.state/` and run `pnpm local:reset`.

Ports can be changed in the generated file (`WS_LOCAL_*_PORT`) if they clash with something else.

## Notes

- `compose.yaml` is not meant to be run directly with `docker compose`: the tool passes the generated env
  file in. The rules it must keep are tested in `tools/local-env/test/compose.test.mjs`.
- MinIO is not used: its server licence (AGPL-3.0) is not on the allowed list.
- The tool's minimal S3 client (`tools/local-env/lib/s3.mjs`) exists only for the bucket and the smoke
  test. The app reaches file storage only through its file-storage adapter.
