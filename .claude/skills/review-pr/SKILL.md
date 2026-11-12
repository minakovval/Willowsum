---
name: review-pr
description: Review a Willowsum pull request against its requirement file in docs/requirements/ and the hard rules in AGENTS.md. Use when asked to review a PR or branch that implements a requirement ID. Must run in a different session from the one that wrote the code.
---

# Review a requirement PR

**Створено:** 2026-11-01 · **Оновлено:** 2026-11-12

You are an independent reviewer. You did not write this code. Your job is to find what is wrong or
missing, not to confirm the author's summary.

## 1. Load

1. `AGENTS.md` (hard rules, Definition of Done).
2. The PR: title, body, diff, CI status (GitHub tools). Take the requirement ID from the title.
3. The requirement file `docs/requirements/<module>/<ID>.md` (for a card: the slice of the target
   release, `<ID>.<release key>.md`) and only the sections of `docs/requirements/00-general.md` it
   relies on.

Read the requirement **before** the PR body, so the author's framing does not anchor you.

**Re-review** (owner, 2026-11-12): check only the fixes and your own previous findings — the diff since the
head you last reviewed — not the whole PR again. There are at most two rounds; see «5. Report».

## 2. Check coverage

Build a table: every acceptance criterion and edge case in the requirement → the test that covers it →
does the test actually assert the behaviour (not just render)? Missing or weak rows are findings.
Time-dependent tests: a test must not re-read `Date.now()` to choose a time window (rate limits, expiry): it fixes the time once per test or injects a clock (re-reading it made CI flaky at minute boundaries, PR #92).
If the PR covers only part of the requirement, the body must say which criteria are left.
Mutation testing is required only for critical modules: data isolation, money, authentication, encryption
(owner, 2026-11-12); do not ask for it elsewhere.

## 3. Check the hard rules

A finding is blocking only if it is a security bypass, data loss or leak, or a violation of the requirement
the PR claims (its FR/AC) or of a shared rule (AGENTS.md, П-rules) (owner, 2026-11-12). Everything else is
non-blocking.

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
- Design before code: any change under `apps/` or `packages/` for a release whose design the owner has
  not yet approved and whose development the owner has not started (PoC: started 2026-11-06; AGENTS.md,
  «Process: design before code») — blocking.
- UI: empty/loading/error states, «Приховати суми» (from MVP; not in PoC), breakpoints of the target
  release, i18n uk/en, accessibility; existing design-system elements reused.
- Ledger: any write to journal tables outside `ledger`, unbalanced entries, edits instead of reversals,
  texts or merchant names stored in the journal (ARC-11).
- Module card not updated when the public interface or events changed.
- Owner decision: a PR changing requirements, AGENTS.md or skills states in its body the owner decision it
  implements, and the change matches that decision; a PR that acts on the cloud or production (applies
  infrastructure, deploys or releases to production, or changes the workflows that do this or their trust
  settings: OIDC, production secrets store; or production DNS) has the owner's approval on that PR — a comment
  from the owner's own GitHub account with a line that is exactly «Схвалюю» or «Approved», or the owner's
  decision from chat recorded in the PR body as a line `Рішення власника (YYYY-MM-DD): схвалено …` (owner,
  2026-11-12) — otherwise blocking. Infrastructure code that is only validated (no apply), CI check jobs and
  the local environment need no approval. The decision is also in the decision log (`docs/decisions/`).
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
locally if needed. Drop findings you cannot support. Integration tests: Cloud sessions have no Docker, so `pnpm db:test` fails there unless the admin URL is given:
`WS_TEST_PG_ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres pnpm db:test run -- pnpm --filter @willowsum/api exec vitest run --config vitest.integration.config.ts <files>`
(`infra/local/README.md`).


## 5. Report

Post one PR review:
- **Blocking** — only as defined in «3. Check the hard rules»; each with file:line and the failing path.
- **Non-blocking** — everything else. The author lists them under «Follow-ups» in the PR body or opens an
  issue; they never start a new round by themselves.
- A recurring class of finding: propose the CI check or test that would catch it (non-blocking).
- The coverage table.
- Questions for the owner where the requirement itself is unclear on a real product question; small
  details the author decided and recorded are not owner questions.

Name the head commit you reviewed (full SHA) at the top of the review. End the review with the verdict on a
line of its own: `Verdict: Changes requested` if anything is blocking, otherwise `Verdict: Ready`; post it as
the review summary. A security review (sensitive areas) ends instead with a line `Security verdict: Ready` or
`Security verdict: Changes requested`. Never write these lines inside quotes or code, and never write a line
«Схвалюю» or «Approved»: that line is the owner's alone. The daily check of `main` (ADR-0008) reads exactly
these lines.

Post the review as one comment of this shape (a combined short re-review confirmation carries both verdict
lines, each on its own line):

```
Reviewed head: <full SHA>

<findings: Blocking, Non-blocking, coverage table, questions>

Verdict: Ready            (or: Verdict: Changes requested)
---
_Generated by [Claude Code](https://claude.ai/code)_
```

**At most two rounds** (owner, 2026-11-12). If something blocking remains after round 2, give a ready fix
with a test in the review (a patch or exact code) and the verdict `Changes requested`; after the author
applies it, confirm that specific fix briefly, with a verdict that names the final head SHA.

The authoring agent merges only after «Ready» given on the commit being merged: it compares the SHA your
review names with the PR head, and any later commit needs a re-review of that commit (owner, 2026-11-12).
Once the merge conditions in AGENTS.md step 7 hold: do not ask the owner to confirm the merge; merge
at once and tell the owner it is merged. A PR labelled `sensitive` (CI sets it from file paths) also needs
a separate security review — say so if it has not had one; other PRs need none (owner, 2026-11-12).
