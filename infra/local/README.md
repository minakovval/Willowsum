# Local environment

**Створено:** 2026-11-06 · **Оновлено:** 2026-11-27 (replacing the data keys of spaces made under the fixed-label key, `pnpm local:dev --rotate-data-keys`, NFR-01@PoC FR 3; 2026-11-26: the installation's master key file, NFR-01@PoC FR 3; 2026-11-20: one file storage for every process; 2026-11-18: `pnpm local:backup`, `pnpm local:restore`; 2026-11-16: `pnpm local:dev`; free ports, closing the window, leftovers — #363)

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
printed or written), every release flag on (CICD-06; an operational flag keeps its state, and one a release flag
requires, such as `household.core`, is turned on when it has none yet). Then the processes
`api`, `worker` and `scheduler` (ARC-02) on free ports picked on every start, listening only on `127.0.0.1`
(`WS_HOST`), and the web dev server on `http://localhost:5173` with `/v1` passed to the API (`WS_API_ORIGIN`).
Other tools on this Mac (Colima/Lima port forwards, other containers) may hold any port 8080–8089: the run does
not need them. Providers are synthetic (`WS_PROVIDER_MODE=test`): no
CAPTCHA service, no mail, no exchange-rate service — nothing leaves the machine. Process output goes to
`infra/local/.state/dev/<process>.log` (git-ignored).

- **Stored files** (import originals): every process uses the same storage and the same key of signed links — the
  S3 storage of `local:up`, or without Docker the directory `infra/local/.state/dev/files` (git-ignored; emptied with
  `--fresh`). Never each process's own memory: the worker reads the file the API stored.
- **Master key** (NFR-01@PoC FR 3, NFR-15@PoC FR 26). `pnpm local:dev` runs the app as an instance with real data
  (`WS_REAL_DATA=true`): every space's data key is wrapped by this computer's own random 256-bit master key, kept in
  `~/.config/willowsum/local-kms-key.json` (`WS_KMS_KEY_FILE`; mode 0600, folder 0700). The first start makes it. It is
  never in the repository, the database or an environment variable, and the app does not start if other users may
  read it (`chmod 600 ~/.config/willowsum/local-kms-key.json`) or if it lies inside a git checkout. Spaces made before this
  key existed are moved to it once, by itself, on the next start («Re-wrapped N of N space key(s)…»); the same by hand:
  `pnpm --filter @willowsum/api kms:rewrap [--dry-run]` with the processes' configuration. The move changes the wrap,
  not the space's data key: **a copy of the database made before the move (an earlier `pnpm local:backup` file, any
  other copy) is still protected only by the fixed-label test key — and with it the values sealed later.** Delete such
  copies everywhere they are kept and make a new one after the move. The fixed-label test key
  (`local-N`) is for tests and CI only. **Lose the file and the encrypted fields (IBANs, policy numbers, stored files)
  cannot be opened again**: keep a copy of it (below). A missing or wrong key file never becomes a new key over your
  data: `pnpm local:dev` stops with «… space key(s) in this database do not open with the installation's key file …»
  and changes nothing; put the saved copy back and start again.
- **Replacing old data keys** (NFR-01@PoC FR 3; the security review of #726). The re-wrap protects the wrap, not the
  data key. `pnpm local:dev --rotate-data-keys` gives every space whose data key may ever have been wrapped by the
  fixed-label key (every space made before this version, `space_keys.exposed`) a new data key under the key file,
  seals all of its values again with it (account numbers, the account binding of import templates and their versions,
  parsed statements, stored files; in batches, each in one transaction) and then retires the old key. It prepares the
  database like a normal start, holds the cluster lock and **starts no process**, so the app is stopped while it runs.
  `--dry-run` only counts («Dry run: N space(s) to get a new data key, M sealed value(s) …»). A stop in the middle
  (Ctrl+C, a crash) loses nothing: the new key and the finished parts are kept, the space's values cannot be opened
  until you run the command again (`SPACE_KEY_ROTATING`), and the repeat carries on without sealing anything twice.
  It refuses to run without `WS_REAL_DATA=true` and the key file. The same by hand: `pnpm --filter @willowsum/api
  kms:rotate-data-keys [--dry-run] [--batch-size N]` with the processes' configuration and the processes stopped.
  After it reports «Replaced the data keys of N of N space(s)…» **delete every copy of the database made before** and
  make a new one: the old copies hold the old data keys, which the repository opens.
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
   вона не перезаписує. Файл не зашифрований і містить усе з `ws_dev` (облікові записи, хеші паролів, сесії):
   тримайте його лише на своєму комп'ютері, не завантажуйте в хмару і не діліться ним, поки самі його не зашифрували.
4. **Головного ключа в копії немає — так і задумано** (NFR-01@PoC п. 3). Файл ключа
   `~/.config/willowsum/local-kms-key.json` лежить поза базою, тож копія бази, зроблена після переобгортання, сама не
   відкриває жодного зашифрованого поля (IBAN, номери полісів, збережені файли). **Копії, зроблені до переобгортання**
   (до першого старту, на якому `pnpm local:dev` написав «Re-wrapped N of N space key(s)…»), захищені лише ключем
   фіксованої мітки з репозиторію — разом зі значеннями, запечатаними пізніше: видаліть їх усюди, де вони є, і зробіть
   нову копію. Повністю закриває це лише заміна ключів даних (розділ нижче, «Замінити ключі даних старих
   просторів»): після неї видаліть **усі** копії, зроблені до неї. Збережіть копію файлу ключа один раз (і після ротації) **окремо** від копій
   бази — наприклад, у менеджері паролів або на іншому диску; ніколи не в одній папці чи одному архіві з `.dump`.
   Команда відмовляється писати копію в папку файлу ключа і після кожної копії нагадує про це.

**Замінити ключі даних старих просторів (один раз)**

Простори, створені до файлу ключа, мали ключ даних, обгорнутий ключем фіксованої мітки з репозиторію. Переобгортання
захистило обгортку, але сам ключ даних лишився тим самим, і старі копії бази його відкривають. Ця команда дає кожному
такому простору новий ключ даних і заново запечатує ним усі його значення.

1. Зупиніть `pnpm local:dev` (Ctrl+C). Зробіть свіжу копію (`pnpm local:backup`) — на випадок, якщо щось піде не так.
2. Перевірка без змін: `pnpm local:dev --rotate-data-keys --dry-run` — друкує, скільки просторів і значень буде
   замінено, і нічого не змінює.
3. Заміна: `pnpm local:dev --rotate-data-keys`. Команда готує базу як звичайний старт, але програму не запускає; чекайте
   «Replaced the data keys of N of N space(s)…». Перервалося (Ctrl+C, вимкнення): запустіть ту саму команду ще раз —
   вона продовжить з того місця, нічого не втративши і нічого не запечатавши двічі. Поки заміна не завершена, значення
   цього простору не відкриваються (`SPACE_KEY_ROTATING`).
4. **Видаліть усі копії бази, зроблені до заміни** (кожен старий `.dump` у `~/Willowsum-backups`, на інших дисках, у
   хмарі), потім зробіть нову копію: `pnpm local:backup`. Файл ключа лишається тим самим — нова копія файлу ключа не
   потрібна.
5. Повторний запуск нічого не робить («Replaced the data keys of 0 of 0 space(s)…»): простори, створені вже з файлом
   ключа, заміни не потребують.

**Відновити з файлу**

1. Зупиніть `pnpm local:dev` (Ctrl+C). Docker Desktop відкритий.
2. `pnpm local:restore ~/Willowsum-backups/ws_dev-….dump`. Команда перевіряє файл, друкує шлях і розмір і питає
   «yes» перед тим, як замінити базу. Без питання: додайте `--yes` (або коротко `-y`).
3. Дочекайтеся «Restored ws_dev», далі `pnpm local:dev`: програма стартує з вашими даними. Копія спершу
   відновлюється в окрему базу `ws_dev_restore`, і `ws_dev` замінюється лише після успіху: якщо файл пошкоджений
   або відновлення перервалося, команда пише «ws_dev is unchanged», і ваша база лишається як була.
4. Том видалено? Спершу `pnpm local:up`, потім пункт 2: ролі беруться з `.roles.sql` поряд із файлом.
   Збережіть обидва файли разом.
5. Відновлена база відкривається лише з файлом ключа тієї інсталяції, що зробила копію. Новий комп'ютер: спершу покладіть
   збережену копію файлу ключа в `~/.config/willowsum/local-kms-key.json` (`chmod 600`), потім `pnpm local:dev`.
   Файлу немає або він від іншої інсталяції: `pnpm local:dev` зупиняється з «… do not open with the installation's key
   file …» і нічого не змінює (нового ключа поверх ваших даних не створює) — покладіть правильний файл і запустіть
   знову. Копії файлу ключа немає зовсім: зашифровані поля цієї бази не відкриються ніколи; почати з порожньої бази —
   `pnpm local:dev --fresh` (стирає `ws_dev`).

Без Docker: ті самі команди з `WS_TEST_PG_ADMIN_URL=postgres://<superuser>@127.0.0.1:5432/postgres` і клієнтами
`pg_dump`, `pg_restore`, `psql` у PATH. Помилка «database is being accessed by other users» — `pnpm local:dev` ще
працює: зупиніть його.

## Test database per agent (`pnpm db:test`)

Owner decision 2026-11-12: each agent (branches work in parallel, AGENTS.md «Parallel branches») gets its own throwaway database.

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
