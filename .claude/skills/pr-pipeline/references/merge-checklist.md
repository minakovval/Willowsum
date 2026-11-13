# Merge checklist (step 6, full text)

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-13

Moved out of `pr-pipeline` SKILL.md without change (owner, 2026-11-13). Read when you are about to merge.

6. **Merge** (squash): the lead merges only when all hold on the **current head SHA** — both verdicts Ready
   on that exact head (`review-pr`, and `security-review` for `sensitive`) and CI green (owner, 2026-11-13):
   - CI green (a path-skipped job counts as passed, `.claude/references/ci-minutes.md`);
   - the latest `Verdict: Ready` names that exact SHA; for `sensitive`, the latest `Security verdict: Ready`
     names it too; any later commit needs a re-review of that commit;
   - for `owner-decision` PRs: the body records the owner's decision (and the decision log has it); cloud or
     production actions: the owner's approval (AGENTS.md step 7);
   - the owner has not commented «stop» or asked a question on the PR.
   For a docs-only PR that moves scope between releases (owner, 2026-11-12), a security review covers only the moved lines that state a protection.
   Do not ask the owner to confirm the merge.
   **Merge on Ready, follow up separately** (owner, 2026-11-13): both verdicts Ready and only non-blocking
   findings left → merge; do not send the non-blocking items back to the implementer for the same PR, since
   that starts another review round. Exception: an item the reviewer marks as cheap and safe to fold in may
   still be added before merge, at your choice; that commit then needs a re-review like any other.
   Before every merge, check that the branch is not behind `main`:
   `gh api repos/{owner}/{repo}/compare/main...<head-sha> --jq .behind_by` must print `0`; a «clean» mergeable
   state does not mean the branch is up to date.
   Branch behind (`behind_by` > 0) or conflicting with `main` → the `sync-branch` skill (merge, never rebase), then a confirmation
   round on the merge (`review-pr` «6. Confirmation rounds»: tree comparison, verdict on the new head).
