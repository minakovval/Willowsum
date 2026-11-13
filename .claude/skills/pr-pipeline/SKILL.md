---
name: pr-pipeline
description: The Willowsum lead agent's loop for delivering requirement parts as PRs — spawn the implementer, the reviewers (review-pr, and security-review for `sensitive` PRs), one batched fix request, merge when the exact head is Ready, report to the owner. Use when the lead runs the development pipeline or resumes it after a restart.
---

# PR pipeline (lead)

**Створено:** 2026-11-12 · **Оновлено:** 2026-11-13

You are the lead. You do not write the feature code or review it yourself: you start agents in separate
sessions, batch their results, and merge. Rules: AGENTS.md «Process» (steps 1–7, «Parallel branches»).

## 1. Per requirement part

0. **Requirements sweep before a section** (owner, 2026-11-13): before the first PR of a plan section (money,
   import, planning, screens), open one `change-requirement` PR that removes the contradictions between the
   section's requirement slices, their cards and the canvas boards (or lists them as owner questions); its row is
   `<X>0` in the wave plan. The section's code PRs start after it is merged.
1. Pick the next part from the wave plan and `docs/traceability/release-poc.md` (generated, not committed:
   `node tools/req-check/index.mjs --quiet --traceability`, or the `traceability` artifact of the latest
   «Requirements traceability» run on `main`); keep each PR small enough for one review round (split backend
   and UI).
2. **Implementer**: a new agent with the `implement-requirement` skill, in its own git worktree on its own
   branch (`claude/adoring-cray-feh4dh` or `claude/adoring-cray-feh4dh-<task>`, from up-to-date `main`).
   Brief: the requirement ID and slice, the exact files and sections to read, branch, worktree path, its slot
   `k` (1–4: dev-server port 517k, API port 808k, its own `pnpm db:test` databases, its own PIDs — «3. Parallel
   branches»), and the report it returns: 10–15 lines, no narrative (owner, 2026-11-13) — PR, head SHA (full),
   result, blockers, owner questions; details go in the PR body or the review. Reviewer briefs ask for the same
   short report.
   The PR body ends with the session's attribution lines exactly as given in the session's instructions; GitHub
   may rewrite the footer, which is fine. Give every agent a scratchpad prefix or subfolder unique
   to the PR and role (`pr153-review/`, owner, 2026-11-13): a generic `body.md` was overwritten by another agent twice.
3. **PR opened** → subscribe to its activity; then in parallel:
   - a reviewer with `review-pr`;
   - if the PR has the label `sensitive`: a security reviewer with `security-review`.
   Each in a different session from the author, with the PR number and head SHA.
4. **Batch**: wait until both reviews are in (owner, 2026-11-13), then collect the blocking items of both
   into **one** fix request to the implementer (`fix-review-findings`): review IDs, which patch wins where
   reviewers conflict (your decision), what is non-blocking (→ «Follow-ups»). Never forward items one by one.
5. **Round 2**: a fresh reviewer per review kind with a narrow brief — the diff since the last reviewed head
   plus its previous findings. At most two rounds; after that the reviewer gives a ready fix and confirms it.
6. **Merge** (squash): the lead merges only when all hold on the **current head SHA** — both verdicts Ready
   on that exact head (`review-pr`, and `security-review` for `sensitive`) and CI green (owner, 2026-11-13):
   - CI green (a path-skipped job counts as passed, AGENTS.md «CI minutes»);
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
   Branch behind or conflicting with `main` → the `sync-branch` skill (merge, never rebase), then a confirmation
   round on the merge (`review-pr` «6. Confirmation rounds»: tree comparison, verdict on the new head).
7. **After merge**: unsubscribe from the PR; the branch is deleted; reset the working branch to the new
   `main` (`git fetch origin main && git reset --hard origin/main` in its worktree) or remove the worktree;
   drop its test databases. The non-blocking items left at merge (the PR's «Follow-ups») go to one follow-up
   PR (an implementer on a lighter model, «Token economy») or to an issue each, linked from the merged PR.
8. **Report to the owner in Ukrainian**: what was merged (PR link, one line), what is next, questions
   (batched, «2. Owner»).
9. **Follow-up sweep** (owner, 2026-11-13): after every 8–10 merged PRs, one PR (row `R` of the wave plan, an
   implementer on a lighter model) closes the small open follow-ups: issues labelled or listed as follow-ups and
   the «Follow-ups» lists of the merged PRs. Larger items get a plan row of their own instead.

**Stacked PRs** (owner, 2026-11-13): a PR that needs another open PR still targets `main`. Branch it from the
parent's branch and say in its body which PR it waits for; it is merged only after the parent. After the
parent squash-merges, bring the child up to date with `sync-branch` (merge `origin/main`, never rebase): its
diff against `main` becomes its own commits only. Then get a merge-only confirmation from its reviewers on
the new head (`review-pr` «6. Confirmation rounds») before step 6.

**CI cannot run** (owner, 2026-11-13; e.g. GitHub Actions blocked by billing or an outage, the run's
annotations say so): stop merging. Local runs never replace CI and never count as green. Report it to the
owner at once (what is blocked, the run link and annotation, what the owner can do), keep reviews going, and
merge only after CI runs green on the exact head (`investigate-ci-failure`).

## 2. Owner

- Questions to the owner are explicit and separate: one numbered list, each with options and your
  recommendation; only real product questions (AGENTS.md «Ambiguity»).
- **Batch the questions** (owner, 2026-11-13): collect non-urgent questions (and the «told afterwards» notes
  on small details) and send them together about every 2–3 hours, in one message. Urgent ones go at once,
  alone: a blocker that stops all parallel work, billing or CI that cannot run, and anything about security (a
  leaked secret, a security finding in `main`, a production risk). While a question waits, keep the other
  branches moving. Small details you decide, record in the
  PR body and the decision log, and tell the owner afterwards.
- Anything the owner must do in a web console → a browser task (`browser-task` skill), never a request for
  keys in chat.
- Record every owner decision the same day in a new file `docs/decisions/log/YYYY-MM-DD-<short-slug>.md` (a
  numeric suffix if the name is taken; owner, 2026-11-13; `state-2026-11-05.md` is the archive) and, for PRs that implement it, as the
  `Рішення власника (YYYY-MM-DD): схвалено …` line. Never write «Схвалюю» or «Approved».
- A small detail you decide (AGENTS.md «Ambiguity») goes into the decision log, and into the PR body and the
  skill or document it shapes, as one entry of this form (owner, 2026-11-13):
  `Рішення ведучого (YYYY-MM-DD; власник не схвалював; <ID або PR>): <що вирішено>; <чому>.`
  (examples: `docs/decisions/state-2026-11-05.md`). Change it to an owner line only when the owner answers.

**GitHub errors** (owner, 2026-11-13): on HTTP 502 or 503, or «token store unavailable», retry with backoff
(wait about 10 s, 30 s, then 90 s; at most 3 retries), then report the failure instead of looping. Before
retrying a call that is not idempotent — a comment, an issue, a merge — check whether the first attempt landed
(`gh api repos/{owner}/{repo}/issues/<n>/comments`, the open issues, `gh api repos/{owner}/{repo}/pulls/<n> --jq
.merged`); act again only when it did not. Unsubscribing, labels and PATCHes are idempotent: retry as they are.
Brief the agents you start to do the same (their skills say so).

## 3. Parallel branches

Up to 3 branches at a time, each with its own worktree, PR and test database. **At most 3–4 agents at once**
(owner, 2026-11-13), implementers and reviewers together; more wait in a queue. Give each agent a slot `k`
(1–4) in its brief and keep a table slot → agent → branch → worktree: its web dev server on port 517k
(`vite --port 517k --strictPort`, preview 417k), its API on `WS_PORT=808k`, its own `pnpm db:test` databases
(named after its branch) and its own worktree; it stops only the processes it started, by PID (the skills that
start servers or databases say how). Choose parts that touch
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
   - reviews (owner, 2026-11-13): a `review-pr` of a PR that changes **only docs and requirement text** may use
     a lighter, cheaper model (the Agent tool's model option). Docs-only means every changed file is one that
     `isDocsOnly` in `tools/pr-rules/lib/ci-paths.mjs` accepts (the job `changes` skips all heavy jobs: `docs/`,
     `design/`, `.claude/`, root `*.md`, the PR template) and none is a test or code. Every review of a PR
     that changes code, tools or workflows, and every confirmation round of such a PR (round 2, merge-only
     confirmations), stays on the main model;
   - a lighter model for applying ready reviewer patches (`fix-review-findings`), follow-up PRs and status
     checks.
2. Round-2 re-reviews go to a fresh agent with a narrow brief (the diff since the last head plus the previous
   findings), not to a resumed long-context agent.
3. Reviewers rely on green CI for the full suites. Locally they run only the tests touching the changed code,
   plus integration tests for database changes; no repeated full-suite runs.
4. Briefs point agents at exact files and sections instead of «read everything».
5. Agents return short final reports (verdict, blocking with file:line, follow-ups, checks), not narratives.
6. Keep PRs small (AGENTS.md step 5, owner rule 7) so diffs, and therefore reviews, stay small.
