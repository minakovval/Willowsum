---
name: review-pr
description: Review a Willowsum pull request against its requirement file in docs/requirements/ and the hard rules in AGENTS.md. Use when asked to review a PR or branch that implements a requirement ID. Must run in a different session from the one that wrote the code.
---

# Review a requirement PR

**Створено:** 2026-11-01 · **Оновлено:** 2026-11-06

You are an independent reviewer. You did not write this code. Your job is to find what is wrong or
missing, not to confirm the author's summary.

## 1. Load

1. `AGENTS.md` (hard rules, Definition of Done).
2. The PR: title, body, diff, CI status (GitHub tools). Take the requirement ID from the title.
3. The requirement file `docs/requirements/<module>/<ID>.md` (for a card: the slice of the target
   release, `<ID>.<release key>.md`) and only the sections of `docs/requirements/00-general.md` it
   relies on.

Read the requirement **before** the PR body, so the author's framing does not anchor you.

## 2. Check coverage

Build a table: every acceptance criterion and edge case in the requirement → the test that covers it →
does the test actually assert the behaviour (not just render)? Missing or weak rows are findings.
If the PR covers only part of the requirement, the body must say which criteria are left.

## 3. Check the hard rules

- Money: any `number`, `parseFloat`, `Math.round` or float arithmetic on amounts; currency conversion
  without a dated rate.
- Plans: plan names or numeric limits in code; missing entitlement check; a limit that hides or
  deletes data; wrong error (`402 PLAN_LIMIT_REACHED`).
- Scope and roles: queries without household/role/scope filter; counts, sums, totals, search results,
  exports or error messages that reveal out-of-scope records; missing permission tests per role.
- Audit: data changes without an audit entry.
- Privacy: personal data in logs, analytics, errors; real data or secrets in fixtures.
- Vault: plaintext of highly sensitive items reaching the server; CVV/PIN stored.
- Security: own crypto, injection, missing step-up where the requirement asks for it, unsafe file handling.
- Module boundaries: imports of another module's internals or tables; provider SDKs outside adapters;
  domain layer depending on database, HTTP or file system.
- Design before code: any change under `apps/` or `packages/` before the owner has started development
  (AGENTS.md, «Process: design before code») — blocking.
- UI: empty/loading/error states, «Приховати суми» (from MVP; not in PoC), breakpoints of the target
  release, i18n uk/en, accessibility; existing design-system elements reused.
- Ledger: any write to journal tables outside `ledger`, unbalanced entries, edits instead of reversals,
  texts or merchant names stored in the journal (ARC-11).
- Module card not updated when the public interface or events changed.
- Owner decision: a PR changing requirements, AGENTS.md or skills states in its body the owner decision it
  implements, and the change matches that decision; a PR changing deploy or infrastructure workflows or
  access/trust settings (OIDC, secrets store, KMS, DNS) has an approval comment from the owner's own GitHub
  account on that PR — otherwise blocking. The decision is also in the decision log (`docs/decisions/`).
- Tests: any skipped, disabled or weakened test; acceptance tests edited to fit the code.
- Requirement changes (PRC-01, PRC-02): run `node tools/req-check/index.mjs --impact <changed ID>` for
  each changed requirement, slice, screen or shared rule; every affected slice is updated in this PR or
  listed in the PR body as follow-up with an issue link (PRC-02 criterion 7) — otherwise blocking. For a
  changed card, its «Реліз» line matches its row in the module README (PRC-01 FR 3), its slices are
  complete for their release, scope removed from PoC moved to PoC v2, and `docs/traceability/` and
  `docs/validation/req-check-report.md` were regenerated (`node --test tools/req-check` and
  `node tools/req-check/index.mjs --report docs/validation/req-check-report.md --traceability`: 0 errors,
  no diff).
- New dependencies or services without justification.

## 4. Verify, do not speculate

For each suspected defect, trace a concrete path (input or caller → wrong result). Run the relevant tests
locally if needed. Drop findings you cannot support.

## 5. Report

Post one PR review:
- **Blocking** — violates a requirement criterion or a hard rule; each with file:line and the failing path.
- **Non-blocking** — clarity, naming, small improvements.
- The coverage table.
- Questions for the owner where the requirement itself is unclear.

Verdict: «Changes requested» if anything is blocking, otherwise «Ready». Post it as the review summary.
The authoring agent merges only after «Ready».
Once the merge conditions in AGENTS.md step 7 hold: do not ask the owner to confirm the merge; merge
at once and tell the owner it is merged. Changes to auth, permissions, encryption, money, schema,
pipeline or infrastructure also need a separate security review — say so if the PR has not had one.
