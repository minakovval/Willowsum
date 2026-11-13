# Merge conditions and owner approval (AGENTS.md step 7, full text)

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-13

Moved out of AGENTS.md without change (owner, 2026-11-13: shorter AGENTS.md and skills). Read when you merge a PR, write an «Owner decision» section, or a PR acts on the cloud or production.

7. The lead merges the PR (squash) only when CI is green on the latest commit and both verdicts are Ready
   on the exact head: the review session gave «Ready» (plus the security review for sensitive areas) **on the
   commit being merged** (owner, 2026-11-13): before merging, compare the SHA each review names with the PR head; any later
   commit, even a small fix, needs a re-review of that fix (owner, 2026-11-12). PRs that change requirements, AGENTS.md or
   skills (label `owner-decision`) are merged only when the PR body records the owner's decision they implement (and the decision
   log in `docs/decisions/` has it). A purely mechanical sync of a list in AGENTS.md that a test requires needs no
   owner decision: only adding or removing a CI job name in the job list of step 6, or a skill's name with its
   own `description` line in «Skills» (AGENTS.md and `.claude/references/skills-list.md`); nothing else qualifies. The PR body still notes it under «Owner
   decision» as a mechanical sync. Any change to a rule needs one (owner, 2026-11-13). For a docs-only PR that moves scope between releases, a security review (when needed) covers only the moved lines that state a protection (owner, 2026-11-12). The owner's approval on the PR is needed only for what acts on the
   cloud or production. It is either a comment from the owner's own GitHub account with a line that is exactly
   «Схвалюю» or «Approved», or the owner's decision from chat recorded in the PR body as a line
   `Рішення власника (YYYY-MM-DD): схвалено …` (owner, 2026-11-12). Agents never write a «Схвалюю» or
   «Approved» line, and write the body line only for a decision the owner actually gave. Approval is needed for: applying
   infrastructure (`tofu apply`), deploying or releasing to production, and changing the workflows that do
   this or the trust settings they use (OIDC trust, the production secrets store) or production DNS. Code
   that is only validated (infrastructure as code without apply, KMS and access rules described as code),
   CI check jobs and the local environment need no approval (owner, 2026-11-06). If the owner commented
   «stop» or asked a question on the PR, do not merge until they answer. Production releases still need the
   owner's approval. Never push to `main` directly: the free GitHub plan cannot block it, so the process
   is the protection.
   Once these conditions hold: do not ask the owner to confirm the merge; merge at once and tell the
   owner it is merged. **Merge on Ready, follow up separately** (owner, 2026-11-13): when both verdicts are Ready
   and only non-blocking findings remain, the lead merges; those items go to a follow-up PR or issue, not into
   the same PR, so they do not start another review round. Exception: a non-blocking item the reviewer marks as
   cheap and safe to fold in may still be added before merge, at the lead's choice (it then needs a re-review of
   that commit, as above).
