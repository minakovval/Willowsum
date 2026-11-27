---
name: implement-requirement
description: Implement one Willowsum product requirement (e.g. BUD-03, ACC-10, AST-14a) from docs/requirements/ end to end — tests first, code, checks, one PR. Use when a task names a requirement ID to build or change.
---

# Implement a requirement

**Створено:** 2026-11-01 · **Оновлено:** 2026-11-27

Input: a requirement ID (or a small group from one module). Output: one PR whose title starts with the ID, CI
green, every acceptance criterion covered by a test. Gate: no change to `apps/` or `packages/` for a release whose
design the owner has not approved (AGENTS.md); until then stop and tell the owner.

## 1. Load only what you need

1. `AGENTS.md`, if not in context.
2. `node tools/req-check/index.mjs --show <ID>@<release>` (e.g. `BUD-03@PoC`): the view of the target release,
   its dependencies, the decisions that cite it and its coverage line. No such requirement → stop and tell the
   owner. Build only from the **view**, never the source `<ID>.md`; never edit a view (text changes:
   `change-requirement`).
3. Only the `00-general.md` sections it relies on (grep); for UI, the `ds/` and `cmp/` files it names (grep).
4. The module card (`README.md` in the module folder) before its code; a missing module is created with the
   scaffold generator.

## 2. Plan (in the session, not a file)

Each AC and EC → its test (unit in the domain layer, integration on PostgreSQL in `apps/api`, e2e in
`apps/web/e2e`); schema changes in the module's own schema; API in the OpenAPI contract first; UI screens and
states; feature key and limits; roles and scope; audit entries. A real product question → stop and ask
(AGENTS.md «Ambiguity»); a small detail → decide and record it (§5). Too big for one review round → split
by criteria (backend / UI) now.

## 3. Branch and tests first

`git checkout -b <ID>-<short-slug>` from up-to-date `main` (or the branch the lead names). Write the tests and
see them fail for the right reason. Name each by item so `--coverage` maps it: `it('BUD-03@PoC AC2: …')`,
`BUD-16@PoC v2 FR 3`, `BUD-16@PoC EC2` (numbers as in that view; a plain `BUD-03 AC2` means the release named
elsewhere in the file, else the first view). A table criterion without a number is named by its words
(`criterion «…»`). Include where relevant:
- permission tests (every role and a scoped member; PoC: the one user and other spaces);
- `402 PLAN_LIMIT_REACHED` with data still visible; `Decimal` money with mixed currencies; the audit entry;
- a fixed or injected clock (never re-read `Date.now()` to pick a window);
- for every new write endpoint labelled `sensitive:money`, a test with two simultaneous requests (`Promise.all`,
  same resource): the result is consistent, with no double spend or lost update;
- for a background job queue, a test for a job in state `dead` and for its daily recovery.

## 4. Implement and verify

- Hard rules (AGENTS.md): Money/Decimal, never floats; plans only through the entitlement interface; scope in
  queries and database policies; providers only through adapters; new functions behind a feature flag;
  synthetic data only; money movements only through `ledger` (ARC-11); other modules only through their
  public interfaces; update the module card when its interface or events change.
- A new migration takes the number the lead's brief gives; no number in the brief → the next free one in the
  module on `origin/main`, and say so in the report.
- UI: empty / loading / error states, the target release's breakpoints (PoC, PoC v2: 1280 px, light theme,
  П-25), uk and en strings, WCAG 2.2 AA, «Приховати суми» from MVP (not PoC), reuse design-system elements;
  the canvas is the visual reference. A PR that changes a screen or a shared UI component carries a 1280 px
  Playwright screenshot with long names and texts: [screen-from-canvas](../screen-from-canvas/SKILL.md) §6.
- Add the test files to «Перевіряється» in the **source** `<ID>.md` (one untagged line, or one tagged line per
  release range: `- [лише PoC] Перевіряється: …`), then `node tools/req-check/index.mjs --views`. A requirement not
  migrated yet is one plain file.
- Before tests: `pg_lsclusters`; if the cluster is down, `pg_ctlcluster 16 main start`.
- Type checks: `cd <worktree> && pnpm typecheck` (the CI job `web` runs the same command; a shell that starts in
  the main checkout checks the wrong tree).
- Checks: typecheck, lint, unit, integration, e2e for UI (root `package.json`), `node --test tools/req-check`,
  `--views` and `--check-mentions` (0 errors), `--coverage` (every AC and EC of your view covered). Without
  Docker: `WS_TEST_PG_ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres pnpm db:test run -- <command>`.
  Traceability files and the report are not committed.
- Text fingerprints: once the tests and code match the view, run
  `node tools/req-check/index.mjs --update-fingerprints <ID>` (the items your tests name) and commit
  `<ID>.fingerprints.json`; `--check-fingerprints` must show 0 errors.
- A PR that changes `migrations/`: before push, «old code + new schema» (ARC-03 FR 4, the CI step of the same
  name) — `main`'s module tests on this branch's migrations. With `main` in a scratch worktree `<base>`
  (`git worktree add <base> origin/main`):
  `cd <base> && pnpm install --frozen-lockfile && WS_COMPAT_SCHEMA_FROM=<worktree>/apps/api pnpm db:test run -- pnpm --filter @willowsum/api exec vitest run --config vitest.integration.config.ts src/modules --passWithNoTests`.
- Servers, databases, background processes: only your slot's ports and your own PIDs —
  [own ports](../../references/own-ports.md) (read when you start any of them).
- A test that fails only sometimes needs a root cause — [flaky tests](../../references/flaky-tests.md) (read
  when it happens). Never skip, weaken or quarantine a test.
- Re-read your own diff as a hostile reviewer: hard rules from `AGENTS.md`, missing criteria, leaks through
  scope, floats, hard-coded limits, personal data in logs. Run the local secret-shaped literal check.

## 5. PR

Scratchpad files only under `pr<n>-impl/` (never a generic `body.md`); before setting a body from a file, check
it names this PR. Before every push and every body change:

```
git fetch origin main
node tools/pr-rules/index.mjs local --title "<the PR title>" --body-file <scratchpad>/pr<n>-impl/body.md
```

Exit 0 required; tick «Sensitive areas touched» if it lists `sensitive`; record the owner decision if it lists
`owner-decision` — [details](../../references/local-pr-checks.md) (read when the output is unclear). GitHub
502 / 503 / «token store unavailable» → [retry rules](../../references/github-errors.md) (read when it happens).

Committing and pushing to your own PR branch is part of the task; if the permission classifier refuses, stop and
report it to the lead. Open a draft PR with `.github/pull_request_template.md`: title `<ID>: <what>`; the
criterion → test table (your `--coverage` row); open owner questions; the sensitive box; «Follow-ups» (the lead
opens the issues; agents never create them); `docs/ops/integrations.md` updated for a new external service; the
session's attribution lines at the end, as given.
Decisions go into a **new** file `docs/decisions/log/YYYY-MM-DD-<slug>.md`: an owner decision as the lead's
report, a small detail as «Рішення ведучого (дата; власник не схвалював)».

**Self-check before review**: run the `review-pr` checklist («2. Check coverage», «3. Check the hard rules») on
`git diff origin/main...HEAD`, fix what it finds, and list it under «Self-check» in the body.

Then a different session reviews; the lead merges, not you (AGENTS.md steps 5 and 7).

**Report to the lead**, once, at most 5 lines, in this order — `PR: <url>`, `Head: <full SHA>`,
`Result: <CI, criteria covered or left>`, `Blockers: <… or —>`, `Owner questions: <… or —>`. Everything else goes
in the PR body.
