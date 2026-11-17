# Stacked PRs and CI that cannot run

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-16

Read when a PR depends on another open PR, or CI cannot run (billing, outage).

**Stacked PRs**: a PR that needs another open PR still targets `main`. Branch it from the
parent's branch and say in its body which PR it waits for; it is merged only after the parent. After the
parent squash-merges, bring the child up to date with `sync-branch` (merge `origin/main`, never rebase): its
diff against `main` becomes its own commits only. Then get a merge-only confirmation from its reviewers on
the new head (`review-pr` «6. Confirmation rounds») before `pr-pipeline` step 6.

**CI cannot run** (e.g. GitHub Actions blocked by billing or an outage, the run's
annotations say so): stop merging. Local runs never replace CI and never count as green. Report it to the
owner at once (what is blocked, the run link and annotation, what the owner can do), keep reviews going, and
merge only after CI runs green on the exact head (`investigate-ci-failure`).
