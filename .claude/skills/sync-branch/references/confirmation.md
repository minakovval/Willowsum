# Reviewer confirmation after a merge (full text)

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-16

Moved out of `sync-branch` SKILL.md (owner, 2026-11-13); docs-only exception added (owner, 2026-11-13, #178). Read when you request the reviewers' confirmation after a merge.

## 7. Reviewer confirmation

AGENTS.md step 7: «any later commit, even a small fix, needs a re-review of that fix»; the verdict must
name the PR head. It makes no exception for merge commits, so **every** merge into a PR that has a reviewer
verdict needs a confirmation on the new head SHA:

- the merge changed reviewed code of the PR (conflicts, adaptations, auto-merged files both sides touched) →
  ask the reviewers (a fresh agent, narrow brief: the merge commit's diff against the previous head restricted
  to the branch's own files, plus their previous findings) for a short confirmation with a verdict line that
  names the new head; a `sensitive` PR also needs the security reviewer's;
- the merge only brought in files outside the PR → the confirmation is still required, but it is a
  one-line check that the PR's own diff against `main` is unchanged (`git diff origin/main...HEAD --stat`
  before and after), and that the merge's tree equals a clean merge
  (the first output line of `git merge-tree --write-tree HEAD^1 HEAD^2` = `git rev-parse HEAD^{tree}`;
  `review-pr` «6. Confirmation rounds»). Give the reviewers both SHAs.
- exception (owner, 2026-11-13, #178): a docs-only PR not labelled `sensitive` whose files `main`'s changes do
  not touch needs no confirmation agent; the lead checks it with one command and posts the result as a review
  ending in `Verdict: Ready` on the new head ([merge checklist](../../pr-pipeline/references/merge-checklist.md)).
  Report both SHAs to the lead.
- exception (owner, 2026-11-16): a code PR without `sensitive` whose diff is byte-identical before and after the sync, with green CI,
  is confirmed by the lead without an agent: [merge checklist](../../pr-pipeline/references/merge-checklist.md),
  «The lead confirms a sync itself»; likewise a `sensitive` PR whose sync is mechanical, keeps its patch-id, does not
  overlap `main`'s files, has green CI and brought no foundation file (owner, 2026-11-16, «1 б», same section).

Report to the lead in the fixed form of `sync-branch` («Report to the lead»).
