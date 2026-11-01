---
name: implement-requirement
description: Implement one Willowsum product requirement (e.g. BUD-03, ACC-10, AST-14a) from docs/requirements/ end to end — tests first, code, checks, one PR. Use when a task names a requirement ID to build or change.
---

# Implement a requirement

Input: a requirement ID (or a small group from the same module). Output: one PR whose title starts with
the ID, CI green, every acceptance criterion covered by a test.

## 1. Load only what you need

1. Read `AGENTS.md` (hard rules) if it is not already in context.
2. Read the requirement file `docs/requirements/<module>/<ID>.md`. Find it with
   `ls docs/requirements/*/<ID>.md`. No file → stop and tell the owner.
3. From `docs/requirements/00-general.md` read only the sections the requirement depends on
   (roles matrix, plan matrix, general rules П-…, glossary terms it uses). Use grep, not a full read.
4. If the requirement has UI, read the design files it names by topic in `docs/requirements/ds/` and
   the matching components in `docs/requirements/cmp/` (grep by component name).
5. Read the module card (`README.md` in the module folder) before its code. Find the module in the
   module map in `AGENTS.md`. If the module does not exist yet, create it with the scaffold generator, in that layout (domain / application / adapters, public
   interface in `index.ts`). For a wide search, delegate to a read-only subagent and keep only its conclusion.

## 2. Plan

Write a short plan in the session (not a file):
- each acceptance criterion and edge case → the test that will cover it (unit in the module's domain layer,
  integration on real PostgreSQL in `apps/api`, e2e in `apps/web/e2e`);
- database schema changes in the module's own schema (migration), API endpoints (OpenAPI
  contract in `packages/api-contract` first), UI screens and states;
- feature key and plan limits, roles and scope behaviour, audit entries.

If any criterion is ambiguous or conflicts with another rule, stop and list the question for the owner.
Do not guess. If the work will not fit one session, split it by criteria into several PRs now.

## 3. Branch

`git checkout -b <ID>-<short-slug>` from up-to-date `main` (unless the task names a branch).

## 4. Tests first

Write the tests from the plan. Run them and confirm they fail for the right reason. Name each test
after the criterion, e.g. `it('BUD-03 AC2: shows daily limit when …')`.

Always include, where relevant:
- permission tests for Owner, Admin, Editor, Viewer and a scoped member (no data, counts or sums leak);
- entitlement tests: limit reached → `402 PLAN_LIMIT_REACHED`, existing data still visible;
- money tests with `Decimal` and mixed currencies;
- audit entry written for every change.

## 5. Implement

- Money: the Money/Decimal type from `packages/domain-kernel`, never floats.
- Plans: the entitlement interface of the `plans` module with the feature key; no plan names or numbers in code.
- Scope: filter in the query layer and database policies, not in the UI.
- External services: only through an adapter; new functions behind a feature flag.
- Money movements: only through the `ledger` interface, following ARC-11.
- Update the module card in the same PR when the public interface or events change.
- UI: empty / loading / error states, three breakpoints, i18n keys for uk and en, WCAG 2.2 AA,
  «Приховати суми» mode respected.
- Stay inside the module; use other modules only through their public interfaces.
- Synthetic data only (`tools/synthetic`).

## 6. Verify

Run the repo's checks (typecheck, lint, unit, integration; e2e for UI — see the root `package.json`).
All green before pushing.
Re-read your own diff as a hostile reviewer: hard rules from `AGENTS.md`, missing criteria, leaks
through scope, floats, hard-coded limits, personal data in logs.

## 7. PR

Push the branch and open a PR (draft until CI is green) using `.github/pull_request_template.md`:
- title `<ID>: <what>`;
- the table criterion → test;
- open questions for the owner, if any;
- tick the sensitive-areas box if auth, permissions, encryption, money, schema, pipeline or infrastructure changed.

Then ask for review by a different agent session with the `review-pr` skill. Merge (squash) yourself only
when CI is green on the latest commit, the review verdict is «Ready» (and the security review, for sensitive
areas), and the owner has not commented «stop» or asked a question on the PR. A PR that changes requirements,
AGENTS.md or skills states in its body the owner decision it implements. A PR that changes deploy or
infrastructure workflows or access/trust settings (OIDC, secrets store, KMS, DNS) also needs an approval
comment from the owner's own GitHub account on that PR. Never merge your own PR without that independent review.
