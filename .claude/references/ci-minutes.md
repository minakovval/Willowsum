# CI minutes and path filters

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-14

Moved out of AGENTS.md without change. Read when you add or change a workflow, or a job was skipped by its path filter.

**CI minutes** (the repository is
public since 2026-11-13, so GitHub Actions minutes are free, but jobs stay lean and path-filtered): a new push cancels the PR's run in progress;
the pnpm store is cached; the job `changes` skips `web`, `api`, `local-env`, `infra` and `e2e`
when the PR's paths do not need them (docs-only PRs skip all five; `e2e`, NFR-07@PoC, runs on every code change
except `infra/`, `tools/` and the root lint, format and ignore files, with only Chromium installed and cached (WebKit dropped from CI, owner 2026-11-20); a skipped job concludes `skipped` and
counts as passed only when `tools/pr-rules/lib/ci-paths.mjs` says the PR did not need it). Do not add
scheduled or frequent workflows without counting their minutes. «Requirements traceability» runs once per push to
`main` (about a minute) to publish the generated traceability files; «Contract check on main» runs `pnpm contract:check` and `pnpm typecheck` once per push to `main` (about a minute and a half, owner 2026-11-20).

**The job `api` in parts** (integration tests in 2 shards): the matrix job `api-parts` runs three parallel parts, each with its own
PostgreSQL 17 service — `api checks` (module boundaries, contract, flags, schema, migrations, old code + new
schema, the image) and `api integration 1/2`, `api integration 2/2` (`vitest --shard=i/2`, split by file). The
required check stays `api`: a small job that needs the parts and fails unless all three passed; it and the parts are
skipped together by the path filter. The parts are not required by name (`tools/pr-rules/lib/workflows.mjs`
leaves out a matrix job another job needs). Cost: three runners each install the workspace (about 1–2 min each), so
the minutes go up a little while the wall time drops. Reproduce one shard locally:
`pnpm db:test run -- pnpm --filter @willowsum/api exec vitest run --config vitest.integration.config.ts --shard=1/2`
(a test that passes alone but fails in its shard on a fresh cluster depends on another file: fix the dependency,
[flaky tests](flaky-tests.md)).
