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
6. **Merge** (squash) only on the **current head SHA**: CI green, the latest `Verdict: Ready` (and for
   `sensitive` the latest `Security verdict: Ready`) names that exact SHA, the owner decision is recorded for
   `owner-decision` PRs, the owner's approval for cloud or production, no unanswered owner «stop» or question.
   Do not ask the owner to confirm. Ready with only non-blocking items left → merge; they go to follow-ups.
   Behind `main` → `sync-branch`, then a confirmation round. Full list:
   [merge checklist](references/merge-checklist.md) (read before every merge).

7. **After merge**: unsubscribe from the PR; the branch is deleted; reset the working branch to the new
   `main` (`git fetch origin main && git reset --hard origin/main` in its worktree) or remove the worktree;
   drop its test databases. The non-blocking items left at merge (the PR's «Follow-ups») go to one follow-up
   PR (an implementer on a lighter model, «Token economy») or to an issue each, linked from the merged PR.
8. **Report to the owner in Ukrainian**: what was merged (PR link, one line), what is next, questions
   (batched, «2. Owner»).
9. **Follow-up sweep** (owner, 2026-11-13): after every 8–10 merged PRs, one PR (row `R` of the wave plan, an
   implementer on a lighter model) closes the small open follow-ups: issues labelled or listed as follow-ups and
   the «Follow-ups» lists of the merged PRs. Larger items get a plan row of their own instead.

Rare cases — [stacked PRs and CI that cannot run](references/stacked-and-blocked.md) (read when a PR depends on
another open PR, or CI cannot run: then stop merging and tell the owner at once).

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
Shared details: [retry rules](../../references/github-errors.md) (read when it happens).


## 3. Parallel branches

Up to 3 branches at a time, each with its own worktree, PR and test database. **At most 3–4 agents at once**
(owner, 2026-11-13), implementers and reviewers together; more wait in a queue. Give each agent a slot `k`
(1–4) in its brief and keep a table slot → agent → branch → worktree: its web dev server on port 517k
(`vite --port 517k --strictPort`, preview 417k), its API on `WS_PORT=808k`, its own `pnpm db:test` databases
(named after its branch) and its own worktree; it stops only the processes it started, by PID (the skills that
start servers or databases say how). Choose parts that touch
different modules; two PRs that change the same files go one after the other. Integration tests on one
cluster queue through `pnpm db:test run -- …` (roles are cluster-wide).

## 4. Restarts and token economy

- After a restart recover state from durable sources — [restarts](references/restarts.md) (read when you
  resume).
- Model by risk: the strongest model for sensitive features and security reviews of critical modules; a
  lighter one only for `review-pr` of docs-and-requirement-text-only PRs (not when they touch a security
  rule), ready reviewer patches, follow-up PRs and status checks; code reviews and their confirmation rounds
  stay on the main model — [token economy](references/token-economy.md) (read when you choose a model or write
  a brief).

