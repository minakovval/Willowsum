---
name: implement-requirement
description: Implement one Willowsum product requirement (e.g. BUD-03, ACC-10, AST-14a) from docs/requirements/ end to end — tests first, code, checks, one PR. Use when a task names a requirement ID to build or change.
---

# Implement a requirement

**Створено:** 2026-11-01 · **Оновлено:** 2026-11-14

Input: a requirement ID (or a small group from one module). Output: one PR whose title starts with the ID, CI
green, every acceptance criterion covered by a test. Gate: no change to `apps/` or `packages/` for a release whose
design the owner has not approved (AGENTS.md); until then stop and tell the owner (requirement and design changes
follow PRC-02).

## 1. Load only what you need

1. `AGENTS.md`, if not in context.
2. `node tools/req-check/index.mjs --show <ID>@<release>` (e.g. `BUD-03@PoC`): the view of the target release,
   its dependencies, the decisions that cite it and its coverage line — instead of listing or reading whole
   folders. No such requirement → stop and tell the owner. Build only from the **view**, never the source
   `<ID>.md`; never edit a view (text changes: `change-requirement`).
3. Only the `00-general.md` sections it relies on (grep); for UI, the `ds/` and `cmp/` files it names (grep).
4. The module card (`README.md` in the module folder) before its code; a missing module is created with the
   scaffold generator. Wide searches: a read-only subagent, keep only its conclusion.

## 2. Plan (in the session, not a file)

Each AC and EC → its test (unit in the domain layer, integration on PostgreSQL in `apps/api`, e2e in
`apps/web/e2e`); schema changes in the module's own schema; API in the OpenAPI contract first; UI screens and
states; feature key and limits; roles and scope; audit entries. A real product question → stop and ask
(AGENTS.md «Ambiguity»); a small detail → decide and record it («5. PR»). Too big for one review round → split
by criteria (backend / UI) now.

## 3. Branch and tests first

`git checkout -b <ID>-<short-slug>` from up-to-date `main` (or the branch the lead names). Write the tests and
see them fail for the right reason. Name each by item so `--coverage` maps it: `it('BUD-03@PoC AC2: …')`,
`BUD-16@PoC v2 FR 3`, `BUD-16@PoC EC2` (numbers as in that view; a plain `BUD-03 AC2` means the release named
elsewhere in the file, else the first view). A table criterion without a number is named by its words
(`criterion «…»`). Include where relevant: permission tests (every role and a scoped member; PoC: the one user
and other spaces), `402 PLAN_LIMIT_REACHED` with data still visible, `Decimal` money with mixed currencies, the
audit entry, and a fixed or injected clock (never re-read `Date.now()` to pick a window; #92).

## 4. Implement and verify

- Hard rules (AGENTS.md): Money/Decimal, never floats; plans only through the entitlement interface; scope in
  queries and database policies; providers only through adapters; new functions behind a feature flag;
  synthetic data only; money movements only through `ledger` (ARC-11); other modules only through their
  public interfaces; update the module card when its interface or events change.
- UI: empty / loading / error states, the target release's breakpoints (PoC, PoC v2: 1280 px, light theme,
  П-25), uk and en strings, WCAG 2.2 AA, «Приховати суми» from MVP (not PoC), reuse design-system elements;
  the canvas is the visual reference.
- Add the test files to «Перевіряється» in the **source** `<ID>.md` (one untagged line, or one tagged line per
  release range: `- [лише PoC] Перевіряється: …`), then `node tools/req-check/index.mjs --views`. A requirement not
  migrated yet is one plain file.
- Before tests (owner, 2026-11-14, #178): `pg_lsclusters`; if the cluster is down, `pg_ctlcluster 16 main start` (the environment's setup script does not run when a container restarts).
- Type checks: `pnpm typecheck` is enough — the CI job `web` runs the same command, and every package's script
  covers all its tsconfig files, tests included (owner, 2026-11-14, #178; guard
  `tools/pr-rules/test/typecheck-scripts.test.mjs`). Run it in your worktree in the same command
  (`cd <worktree> && pnpm typecheck`): a shell that starts in the main checkout checks the wrong tree (#184).
- Checks: typecheck, lint, unit, integration, e2e for UI (root `package.json`), `node --test tools/req-check`,
  `--views` and `--check-mentions` (0 errors), `--coverage` (every AC and EC of your view covered). Without
  Docker: `WS_TEST_PG_ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres pnpm db:test run -- <command>`.
  Traceability files and the report are not committed (generate on demand if you need to read them).
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

Committing and pushing to your own PR branch is part of the task (owner, 2026-11-13, #178: «дозволяю»); if the
permission classifier still refuses, stop and report it to the lead. Open a draft PR with `.github/pull_request_template.md`: title `<ID>: <what>`; the criterion → test table (your
`--coverage` row); open owner questions; the sensitive box; «Follow-ups»; `docs/ops/integrations.md` updated for
a new external service. Decisions go into a **new** file `docs/decisions/log/YYYY-MM-DD-<slug>.md`: an owner
decision as the lead's report, a small detail as «Рішення ведучого (дата; власник не схвалював)».

**Self-check before review** (owner, 2026-11-13): run the `review-pr` checklist («2. Check coverage», «3. Check
the hard rules») on `git diff origin/main...HEAD`, fix what it finds, and list it under «Self-check» in the body.
It adds to the reviewer's work; it does not replace it.

Then a different session reviews (`review-pr`; `sensitive` also `security-review`). The lead merges, not you,
only on Ready verdicts naming the exact head; never write «Схвалюю» / «Approved»; write `Рішення власника` only
for a decision the owner gave (AGENTS.md steps 5 and 7). Review rounds (what blocks, at most two rounds, the
reviewer's ready fix): AGENTS.md step 5.

**Report to the lead** (owner, 2026-11-13): 10–15 lines, no narrative — PR URL, head SHA (full), result (CI,
criteria covered or left), blockers, owner questions. Details go in the PR body. Follow-ups: list them under Follow-ups in the PR body / report; the lead opens the issue.
