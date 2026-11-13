# Local environment

**Створено:** 2026-11-06 · **Оновлено:** 2026-11-13

CICD-04, row «Локальне»: the backing services the app needs, started with one command, holding only
synthetic data.

| Service | Technology | Address (127.0.0.1 only) | Licence |
| --- | --- | --- | --- |
| Database | PostgreSQL 17 (UTC) | `127.0.0.1:5432` | PostgreSQL |
| Mail | Mailpit: SMTP catches every message, nothing leaves the machine; SMTP and the web UI need the generated logins | SMTP `127.0.0.1:1025`, web UI `http://127.0.0.1:8025` | MIT |
| File storage | SeaweedFS S3 gateway, path-style, bucket `willowsum-files` | `http://127.0.0.1:8333` | Apache-2.0 |

## Commands

Requires Docker with the compose plugin and Node 22. From the repository root:

| Command | What it does |
| --- | --- |
| `pnpm local:up` | Starts everything, waits until healthy, creates the bucket. The first run generates local credentials. |
| `pnpm local:status` | Services, health and where to connect. Never prints secrets. |
| `pnpm local:smoke` | End-to-end check: SQL query, mail over SMTP, S3 put/get, and refusal without credentials. |
| `pnpm local:down` | Stops; data is kept. |
| `pnpm local:reset` | Stops, deletes all local data (volumes), starts empty. |

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
