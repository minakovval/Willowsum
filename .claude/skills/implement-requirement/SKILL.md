---
name: implement-requirement
description: Implement one Willowsum product requirement (e.g. BUD-03, ACC-10, AST-14a) from docs/requirements/ end to end — tests first, code, checks, one PR. Use when a task names a requirement ID to build or change.
---

# Implement a requirement

**Створено:** 2026-11-01 · **Оновлено:** 2026-11-13

Input: a requirement ID (or a small group from the same module). Output: one PR whose title starts with
the ID, CI green, every acceptance criterion covered by a test.

**Gate: design before code.** Do not change `apps/` or `packages/` until the owner has approved the design of
the target release and started development (AGENTS.md «Process: design before code»); until then stop and tell
the owner (requirement and design changes follow PRC-02).

## 1. Load only what you need

1. Read `AGENTS.md` if it is not already in context.
2. Find the requirement with `ls docs/requirements/*/<ID>*.md`. No file → stop and tell the owner. For a
   migrated requirement (its `<ID>.md` has a «Зв'язки» block with «Зрізи»), read only the **view** of the
   target release, `<ID>.<poc|poc-v2|mvp|…>.md` (the latest view at or before that release); it is complete
   on its own. Do not read the source `<ID>.md` to build: it merges every release. Use the view's «Зв'язки»
   header for dependencies, screens, П-rules and tests. A requirement not migrated yet is one plain file.
   Views are generated: never edit one (line 2 says so). Requirement text changes go to the source
   (`change-requirement`).
3. From `docs/requirements/00-general.md` read only the sections the requirement depends on
   (roles, plans, П-rules, glossary). Use grep, not a full read.
4. For UI, read the design files it names in `docs/requirements/ds/` and the components in
   `docs/requirements/cmp/` (grep by component name).
5. Read the module card (`README.md` in the module folder; module map in `AGENTS.md`) before its code. A
   missing module: create it with the scaffold generator (domain / application / adapters, public interface
   in `index.ts`). For a wide search use a read-only subagent and keep only its conclusion.

## 2. Plan

Write a short plan in the session (not a file):
- each acceptance criterion and edge case → the test that will cover it (unit in the module's domain layer,
  integration on real PostgreSQL in `apps/api`, e2e in `apps/web/e2e`);
- database schema changes in the module's own schema (migration), API endpoints (OpenAPI
  contract in `packages/api-contract` first), UI screens and states;
- feature key and plan limits, roles and scope behaviour, audit entries.

Unclear criteria: follow AGENTS.md «Ambiguity» (real product question → stop and ask the owner; small
detail → decide and record it in the PR body and in a new file in `docs/decisions/log/`, see «7. PR»). If the
work will not fit one session or one review round, split it by criteria (e.g. backend and UI) into several PRs
now.

## 3. Branch

`git checkout -b <ID>-<short-slug>` from up-to-date `main` (unless the task names a branch).

## 4. Tests first

Write the tests from the plan. Run them and confirm they fail for the right reason. Name each test by item,
so `node tools/req-check/index.mjs --coverage` maps it: the requirement ID with the release you built, then
the item — `it('BUD-03@PoC AC2: shows daily limit when …')`, `BUD-16@PoC v2 FR 3`, `BUD-16@PoC EC2` (`FR` =
functional requirement, `AC` = acceptance criterion, `EC` = edge case, numbered as in that view). A plain ID
(`BUD-03 AC2`) means the release named for it elsewhere in the test file, else its first view. Before
pushing, run `--coverage` and check that every AC and EC of your view is covered.

Always include, where relevant:
- permission tests for Owner, Admin, Editor, Viewer and a scoped member (no data, counts or sums leak);
  PoC and PoC v2 have one user per space, so there the tests cover that user and other spaces;
- entitlement tests: limit reached → `402 PLAN_LIMIT_REACHED`, existing data still visible;
- money tests with `Decimal` and mixed currencies;
- audit entry written for every change;
- time-dependent tests: a test must not re-read `Date.now()` to choose a time window (rate limits, expiry): it fixes the time once per test or injects a clock (re-reading it made CI flaky at minute boundaries, PR #92).

## 5. Implement

- Hard rules (AGENTS.md): Money/Decimal from `packages/domain-kernel`, never floats; plans only through the
  entitlement interface (`plan-catalog`, `usage-limits`) with the feature key, no plan names or numbers in
  code; scope filters in the query layer and database policies, not in the UI; external services only through
  an adapter; new functions behind a feature flag; synthetic data only (`tools/synthetic`).
- Money movements: only through the `ledger` interface, following ARC-11.
- Update the module card in the same PR when the public interface or events change.
- UI: empty / loading / error states, the breakpoints of the target release (PoC and PoC v2: desktop from 1280 px, light theme — П-25),
  i18n keys for uk and en, WCAG 2.2 AA (PoC: as limited by П-25), «Приховати суми» mode respected from MVP (not in PoC). Reuse
  existing design-system elements; the canvas is the visual reference.
- Stay inside the module; use other modules only through their public interfaces.

## 6. Verify

Record the tests in the requirement: add the test file paths to the «Перевіряється» field of the slice text
in the **source** `<ID>.md`. One untagged line when the list holds for every release; when it differs
between releases, one tagged line per range (`- [лише PoC] Перевіряється: …`, `- [PoC v2] Перевіряється: …`),
keeping the other releases' lines. Then run
`node tools/req-check/index.mjs --views` so the views pick it up. Never edit «Перевіряється» in a view.

Run the repo's checks (typecheck, lint, unit, integration; e2e for UI — see the root `package.json`),
plus `node --test tools/req-check`, `node tools/req-check/index.mjs --views` and
`node tools/req-check/index.mjs --report docs/validation/req-check-report.md --traceability`
(0 errors; the source, the regenerated views and the generated files committed). All green before pushing (CI jobs: AGENTS.md step 6).
Cloud sessions have no Docker, so `pnpm db:test` fails there unless the admin URL is given:
`WS_TEST_PG_ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres pnpm db:test run -- pnpm --filter @willowsum/api exec vitest run --config vitest.integration.config.ts <files>`
(`infra/local/README.md`).
A test that fails only sometimes needs a root cause, never «load», «flake» or «timeout under load» as the
explanation (owner, 2026-11-13): reproduce it, compare with `main`, find the cause (#146: tests sharing
`apps/api/test/.tmp` deleted each other's folders; whole-tree analysis tests ran without a timeout of their
own). If you cannot find it in this PR, file a separately tracked issue with the evidence (run link, log lines,
how to reproduce). Never skip, quarantine or raise a timeout without a stated basis.
Re-read your own diff as a hostile reviewer: hard rules from `AGENTS.md`, missing criteria, leaks
through scope, floats, hard-coded limits, personal data in logs.
Before pushing, run a local check for secret-shaped literals (what the CI job `secrets` checks).

## 7. PR

Scratchpad files (owner, 2026-11-13): only under a prefix or subfolder unique to the PR and role
(`pr153-impl/`), never a generic name like `body.md`, which another agent can overwrite. Before setting
or PATCHing a PR body from a file, check that the file is the one you wrote (it names this PR's ID).

Push the branch and open a PR (draft until CI is green) using `.github/pull_request_template.md`:
- title `<ID>: <what>`;
- the table criterion → test (the `--coverage` row of your view);
- open questions for the owner, if any;
- tick the sensitive-areas box if auth, permissions, encryption, money, schema, pipeline or infrastructure changed;
- a «Follow-ups» list for non-blocking review findings (or issue links);
- a row in `docs/ops/integrations.md` updated if the PR adds or changes an external service.

Decisions (owner, 2026-11-13): each one goes into a **new file** `docs/decisions/log/YYYY-MM-DD-<short-slug>.md`
(a numeric suffix if the name is taken), never appended to `docs/decisions/state-2026-11-05.md` (the archive).
Word entries as before: an owner decision as the lead's report, a small detail as «Рішення ведучого (дата;
власник не схвалював)».

**Self-check before review** (owner, 2026-11-13): before you report the PR as ready for review, run the
`review-pr` checklist («2. Check coverage», «3. Check the hard rules») on your own diff
(`git diff origin/main...HEAD`), fix what it finds, and list in the PR body what you checked and the result
(a short «Self-check» list). It adds to the reviewer's work; it does not replace it.

Then ask for review by a different agent session with the `review-pr` skill; a PR labelled `sensitive` (CI
sets it from file paths) also needs a `security-review` session. Review rounds, merge conditions and approvals
are in AGENTS.md «Process», steps 5 and 7. What must not go wrong:
- The lead merges (squash; AGENTS.md step 7, owner, 2026-11-13), not you: only when CI is green on the
  latest commit and `Verdict: Ready` (for `sensitive` also `Security verdict: Ready`) names the exact head
  SHA, and never while the owner's «stop» or question on the PR is unanswered; any later commit needs a
  re-review. Report the PR URL and head SHA to the lead.
- A PR that changes requirements, AGENTS.md or skills states in its body the owner decision it implements.
  A PR that acts on the cloud or production needs the owner's approval on that PR: a comment from the owner's
  own account with a line that is exactly «Схвалюю» or «Approved», or the owner's chat decision in the PR body
  as `Рішення власника (YYYY-MM-DD): схвалено …`.
- Never write «Схвалюю» or «Approved» yourself; write the `Рішення власника` line only for a decision the
  owner actually gave.
- Review rounds (what blocks, at most two rounds, the reviewer's ready fix): AGENTS.md step 5.
