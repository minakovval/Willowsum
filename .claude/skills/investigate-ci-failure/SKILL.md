---
name: investigate-ci-failure
description: Investigate a red or blocked Willowsum CI run on a PR — reproduce locally, check whether `main` fails too, at most one re-run, find the root cause, then show the failing run and the same check green after the fix. Covers billing or infrastructure blocks (annotation messages) and a description-check failure caused by a lost PR body. Use when a CI job fails or does not run on a PR.
---

# Investigate a CI failure

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-13

Input: a PR and its failing (or never started) run. Output: the root cause, a fix (or a separately tracked
issue with the evidence) and the same check green on the new head, or a report to the lead that CI cannot run.
«Load», «flake» or «timeout under load» is never a cause (owner, 2026-11-13). Never skip, quarantine or raise a
timeout without a stated basis, and never weaken a test to get green (AGENTS.md step 6).

Scratchpad files only under a subfolder named after the PR and your role (`pr153-ci/`), never a generic name
like `body.md`.

## 1. Read the run

1. Head SHA and runs: `gh pr view <n> --json headRefOid,statusCheckRollup`; the run:
   `gh run view <run id> --json jobs,conclusion,headSha`; failing logs: `gh run view <run id> --log-failed`.
   Confirm the run is for the current head; a run on an older head is history, not the state.
2. Annotations first: `gh api repos/{owner}/{repo}/check-runs/<job id>/annotations`. They name the special
   cases of section 4.
3. Note the job, step, test name, the first error line and the run link: they go into the report.

## 2. Reproduce

1. In the PR's worktree (or your own, `git worktree add <scratchpad>/pr<n>-ci/worktree <head SHA>`), run the
   same command as the failing step in `.github/workflows/` (same filter and flags), not a wider suite.
   Integration tests on your own database: `pnpm db:test run -- …` (`infra/local/README.md`; without Docker,
   `WS_TEST_PG_ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres`).
2. **Is `main` red too?** Run the same command on `origin/main` and look at the latest runs on `main`
   (`gh run list --branch main --limit 5`, and the daily check). Red on the base → not this PR's failure: say
   so, link the run on `main`, file or find the issue, and tell the lead; do not fix it inside an unrelated PR
   unless the lead asks.
3. Not reproduced locally: compare the CI environment (Node, pnpm, Postgres versions, env variables, which
   tests run together and in what order, the timeout the step gives). Run the suite the way CI runs it,
   repeatedly if the failure is intermittent (a shell loop), until it shows.
4. **At most one re-run** (`gh run rerun <run id> --failed`), and only to collect evidence, never as the fix.
   Green after a re-run is still a failure without a cause: keep going.

## 3. Root cause and fix

1. Find the mechanism: the input, shared state or timing that makes the check fail (#146: tests sharing
   `apps/api/test/.tmp`, one removing the folder while others wrote into it; whole-tree analysis tests that ran
   without a timeout of their own).
2. Fix the cause, with a test that fails before the fix when that is possible. A timeout changes only with a
   stated basis (measured duration, what the test does).
3. Cause outside this PR or too large for it: open a separately tracked issue with the evidence (run link, log
   lines, how to reproduce, what was ruled out) and tell the lead; the PR waits or the lead decides.
4. Show both: the failing run (link and the error line) and the same check green after the fix (the new run on
   the new head, or the local command with its output when CI cannot run, marked as local). The fix commit is
   reviewed like any other (`review-pr` «6. Confirmation rounds»).

## 4. Special cases

- **Billing or infrastructure block.** Annotations such as «The job was not started because recent account
  payments have failed or your spending limit needs to be increased», a runner or service outage, or a job
  that never starts: not a code failure. Do not re-run in a loop and do not change code. Report to the lead
  with the annotation text and run link; the lead stops merging and tells the owner (`pr-pipeline`, «CI
  cannot run»). Local runs never count as CI.
- **Description check failed after a lost PR body.** The job `traceability` (PR description) fails with «The
  description has no «## Requirement» section» or similar while the PR had a full body: another agent may have
  PATCHed the body with its own text (it happened twice on 2026-11-13). Compare the current body
  (`gh pr view <n> --json body`) with the intended one; restore it from the file you wrote for this PR (check
  it names this PR) or from the PR history. Editing the body starts a new run by itself (`pr-description.yml`
  runs on `edited`); a re-run of the old run reads the old body from its event and fails again. Record what
  happened in the report.
- **Path-skipped jobs.** A job that concludes `skipped` passes only when `tools/pr-rules/lib/ci-paths.mjs`
  says the PR did not need it (AGENTS.md «CI minutes»); a wrong skip is a `ci-paths` bug, not a pass.

## 5. Report

To the lead, in a few lines: the failing run (link, job, error line); cause; base red or not; the fix commit
and new head SHA, and the check green on it (run link); or the issue opened; or «CI cannot run» with the
annotation.
