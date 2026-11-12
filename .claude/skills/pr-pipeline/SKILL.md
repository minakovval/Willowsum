---
name: pr-pipeline
description: The Willowsum lead agent's loop for delivering requirement parts as PRs — spawn the implementer, the reviewers (review-pr, and security-review for `sensitive` PRs), one batched fix request, merge when the exact head is Ready, report to the owner. Use when the lead runs the development pipeline or resumes it after a restart.
---

# PR pipeline (lead)

**Створено:** 2026-11-12 · **Оновлено:** 2026-11-12

You are the lead. You do not write the feature code or review it yourself: you start agents in separate
sessions, batch their results, and merge. Rules: AGENTS.md «Process» (steps 1–7, «Parallel branches»).

## 1. Per requirement part

1. Pick the next part from `docs/traceability/release-poc.md` and the wave plan; keep each PR small enough
   for one review round (split backend and UI).
2. **Implementer**: a new agent with the `implement-requirement` skill, in its own git worktree on its own
   branch (`claude/adoring-cray-feh4dh` or `claude/adoring-cray-feh4dh-<task>`, from up-to-date `main`).
   Brief: the requirement ID and slice, the exact files and sections to read, branch, worktree path, its own
   database (`pnpm db:test`), what to report (PR URL, head SHA, checks).
3. **PR opened** → subscribe to its activity; then in parallel:
   - a reviewer with `review-pr`;
   - if the PR has the label `sensitive`: a security reviewer with `security-review`.
   Each in a different session from the author, with the PR number and head SHA.
4. **Batch**: when both reviews are in, collect the blocking items of both into **one** fix request to the
   implementer (`fix-review-findings`): review IDs, which patch wins where reviewers conflict (your decision),
   what is non-blocking (→ «Follow-ups»). Never forward items one by one.
5. **Round 2**: a fresh reviewer per review kind with a narrow brief — the diff since the last reviewed head
   plus its previous findings. At most two rounds; after that the reviewer gives a ready fix and confirms it.
6. **Merge** (squash) only when all hold on the **current head SHA**:
   - CI green (a path-skipped job counts as passed, AGENTS.md «CI minutes»);
   - the latest `Verdict: Ready` names that exact SHA; for `sensitive`, the latest `Security verdict: Ready`
     names it too; any later commit needs a re-review of that commit;
   - for `owner-decision` PRs: the body records the owner's decision (and the decision log has it); cloud or
     production actions: the owner's approval (AGENTS.md step 7);
   - the owner has not commented «stop» or asked a question on the PR.
   Do not ask the owner to confirm the merge.
7. **After merge**: unsubscribe from the PR; the branch is deleted; reset the working branch to the new
   `main` (`git fetch origin main && git reset --hard origin/main` in its worktree) or remove the worktree;
   drop its test databases.
8. **Report to the owner in Ukrainian**: what was merged (PR link, one line), what is next, questions.

## 2. Owner

- Questions to the owner are explicit and separate: one numbered list, each with options and your
  recommendation; only real product questions (AGENTS.md «Ambiguity»). Small details you decide, record in the
  PR body and the decision log, and tell the owner afterwards.
- Anything the owner must do in a web console → a browser task (`browser-task` skill), never a request for
  keys in chat.
- Record every owner decision the same day in `docs/decisions/` and, for PRs that implement it, as the
  `Рішення власника (YYYY-MM-DD): схвалено …` line. Never write «Схвалюю» or «Approved».

## 3. Parallel branches

Up to 3 branches at a time, each with its own worktree, PR and test database. Choose parts that touch
different modules; two PRs that change the same files go one after the other. Integration tests on one
cluster queue through `pnpm db:test run -- …` (roles are cluster-wide).

## 4. Restarts

The container can restart and agents' context is lost. Recover state from durable sources, not memory:
- open PRs and their heads: `gh pr list --state open --json number,headRefName,headRefOid,labels`;
- the latest reviews per PR (`gh api repos/{owner}/{repo}/pulls/<n>/reviews`), their verdicts and SHAs;
- CI status of each head; finished agents' output files in the session scratchpad;
- worktrees (`git worktree list`) and test databases (`pnpm db:test list`).
Then continue from the first step that is not done; re-subscribe to open PRs.

## 5. Token economy

Owner request 2026-11-12; rules decided by the lead.

1. Pick the agent's model by risk:
   - the strongest model for implementing sensitive features and for security reviews of critical modules
     (isolation, money, auth, encryption);
   - a lighter model (the Agent tool's `model: "sonnet"`) for `review-pr` on non-sensitive PRs, PRs that change
     only docs or requirements, applying ready reviewer patches (`fix-review-findings`), follow-up PRs and
     status checks.
2. Round-2 re-reviews go to a fresh agent with a narrow brief (the diff since the last head plus the previous
   findings), not to a resumed long-context agent.
3. Reviewers rely on green CI for the full suites. Locally they run only the tests touching the changed code,
   plus integration tests for database changes; no repeated full-suite runs.
4. Briefs point agents at exact files and sections instead of «read everything».
5. Agents return short final reports (verdict, blocking with file:line, follow-ups, checks), not narratives.
6. Keep PRs small (AGENTS.md step 5, owner rule 7) so diffs, and therefore reviews, stay small.
