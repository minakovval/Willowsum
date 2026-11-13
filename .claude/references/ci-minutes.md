# CI minutes and path filters

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-13

Moved out of AGENTS.md without change (owner, 2026-11-13: shorter AGENTS.md and skills). Read when you add or change a workflow, or a job was skipped by its path filter.

**CI minutes** (lead, 2026-11-12; updated by the owner's decision of 2026-11-13, item 5: the repository is
public since 2026-11-13, so GitHub Actions minutes are free, but jobs stay lean and path-filtered): a new push cancels the PR's run in progress;
the pnpm store is cached; the job `changes` skips `web`, `api`, `local-env`, `infra` and `e2e`
when the PR's paths do not need them (docs-only PRs skip all five; `e2e`, NFR-07@PoC, runs on every code change
except `infra/`, `tools/` and the root lint, format and ignore files, with only Chromium and WebKit installed and cached; a skipped job concludes `skipped` and
counts as passed only when `tools/pr-rules/lib/ci-paths.mjs` says the PR did not need it). Do not add
scheduled or frequent workflows without counting their minutes. «Requirements traceability» runs once per push to
`main` (about a minute; owner, 2026-11-13) to publish the generated traceability files.
