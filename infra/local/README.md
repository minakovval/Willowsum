# Local environment

CICD-04, row «Локальне»: the backing services the app needs, started with one command, holding only
synthetic data.

| Service | Technology | Address (127.0.0.1 only) | Licence |
| --- | --- | --- | --- |
| Database | PostgreSQL 17 (UTC) | `127.0.0.1:5432` | PostgreSQL |
| Mail | Mailpit: SMTP catches every message, nothing leaves the machine | SMTP `127.0.0.1:1025`, web UI `http://127.0.0.1:8025` | MIT |
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

## Credentials

No credentials are written by people or committed (CICD-12). On the first `pnpm local:up` the tool
generates random values (≥ 32 bytes for passwords and the S3 secret key) into
`infra/local/.state/local.env` (git-ignored, mode 0600). Later runs reuse them. The API (once it exists, ARC-01) will read
its local configuration from that file. To get new values, delete `infra/local/.state/` and run `pnpm local:reset`.

Ports can be changed in the generated file (`WS_LOCAL_*_PORT`) if they clash with something else.

## Notes

- `compose.yaml` is not meant to be run directly with `docker compose`: the tool passes the generated env
  file in. The rules it must keep are tested in `tools/local-env/test/compose.test.mjs`.
- MinIO is not used: its server licence (AGPL-3.0) is not on the allowed list.
- The tool's minimal S3 client (`tools/local-env/lib/s3.mjs`) exists only for the bucket and the smoke
  test. The app reaches file storage only through its file-storage adapter.
