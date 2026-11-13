# Hard-rules checklist («3. Check the hard rules», full text)

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-13

Moved out of `review-pr` SKILL.md without change (owner, 2026-11-13). Read when you review a PR: go through every item that the diff touches.

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
  not yet approved and whose development the owner has not started (PoC: started 2026-11-06; `.claude/references/design-before-code.md` (AGENTS.md links it)) — blocking.
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
  the local environment need no approval. The decision is also in the decision log: a new file in
  `docs/decisions/log/` (`YYYY-MM-DD-<short-slug>.md`, owner, 2026-11-13); a new entry appended to the archive
  `docs/decisions/state-2026-11-05.md` instead is a finding.
  Exemption (AGENTS.md step 7, owner, 2026-11-13): a mechanical sync of an AGENTS.md list that a test
  requires (a CI job name in the job list, a skill's name with its own `description` line in «Skills») needs
  no owner decision, only a note in the body. Confirm from the diff that a claimed mechanical sync changes
  only those list names or entries; anything else needs the owner's decision (blocking otherwise).
- Tests: any skipped, disabled or weakened test; acceptance tests edited to fit the code. «Load», «flake» or
  «timeout under load» is not an explanation of an intermittent failure (owner, 2026-11-13): a skip,
  quarantine or raised timeout without a stated root cause (reproduced, compared with `main`) or a separately
  tracked issue with the evidence is a finding (#146: a shared `test/.tmp` race).
- Requirement changes (PRC-01, PRC-02): run `node tools/req-check/index.mjs --impact <changed ID>` for
  each changed requirement, slice, screen or shared rule; every affected slice is updated in this PR or
  listed in the PR body as follow-up with an issue link (PRC-02 criterion 7) — otherwise blocking. Only
  sources were edited: a view changed without its source, or not equal to what the source generates, is
  blocking (CI's `view-stale`). For a changed card part, its «Реліз» line matches its row in the module
  README, the views are complete for their release, scope removed from PoC moved to PoC v2, and the views
  were regenerated (`node tools/req-check/index.mjs --views` and `node --test tools/req-check`: 0 errors, no
  diff). `docs/traceability/` and `docs/validation/req-check-report.md` are not committed (owner, 2026-11-13):
  a PR that adds them back is blocking; CI generates them. An implementation PR adds its tests to «Перевіряється»
  in the source, not in a view.
- Requirement-change PR without code (`change-requirement`, owner, 2026-11-12): one pass, on a lighter
  model, with the fixed checklist of `change-requirement` step 8; report each row. To check a move, run the
  same `--move` on a scratch copy of `main` and compare, or read the old and new views side by side
  (`git diff origin/main -- '<module>/<ID>.*.md'`). A security review is needed only for moved or reworded
  lines that state a protection, and covers only those lines.
- New dependencies or services without justification.
