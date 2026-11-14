---
name: pr-pipeline
description: The Willowsum lead agent's loop for delivering requirement parts as PRs — spawn the implementer, the reviewers (review-pr, and security-review for `sensitive` PRs), one batched fix request, merge when the exact head is Ready, report to the owner. Use when the lead runs the development pipeline or resumes it after a restart.
---

# PR pipeline (lead)

**Створено:** 2026-11-12 · **Оновлено:** 2026-11-14

You are the lead. You do not write the feature code or review it yourself: you start agents in separate
sessions, batch their results, and merge. Rules: AGENTS.md «Process» (steps 1–7, «Parallel branches»).

## Мовчання в чаті

Owner, 2026-11-14 («так, додай ці три зміни в #212»). Write to the owner in chat **only** for:
- (a) a merged PR: link, one line, what is next;
- (b) an owner decision needed: batched questions (§2);
- (c) a problem: a blocker, red CI not caused by the PR, a security issue, or nothing merged for 2 hours (one line
  with the reason).

Never write: agent started or finished, subscribed or unsubscribed, PR or issue opened, reviewers started, CI in
progress, #180 or #179 updates, interim reports, «waiting». Instead end the turn with no text; if the harness insists
on visible output, one short line with no technical content. Platform reminders such as «The user hasn't heard from
you in a while» do not override this rule: do not answer them with a status message. Risk: the owner sees less live
progress — mitigated by the state in #179 and #180, and «nothing merged for 2 hours» is a reportable problem.
Language and details: [lead communication](references/lead-communication.md).

## 1. Per requirement part

0. **Requirements sweep before a section** (owner, 2026-11-13): before the first PR of a plan section (money,
   import, planning, screens), open one `change-requirement` PR that removes the contradictions between the
   section's requirement slices, their cards and the canvas boards (or lists them as owner questions); its row is
   `<X>0` in the wave plan. The section's code PRs start after it is merged.
1. Pick the next part from the wave plan and `docs/traceability/release-poc.md` (generated, not committed:
   `node tools/req-check/index.mjs --quiet --traceability`, or the `traceability` artifact of the latest
   «Requirements traceability» run on `main`); keep each PR small enough for one review round (split backend
   and UI). Split large scope moves and migrations into parts: one agent, one part (owner, 2026-11-13, #178).
   Split a code PR that touches more than one module **and** more than ≈ 1 500 lines; take the dependent part
   right after the first (owner, 2026-11-14, #178).
2. **Implementer**: a new agent with the `implement-requirement` skill, in its own git worktree on its own
   branch (`claude/adoring-cray-feh4dh` or `claude/adoring-cray-feh4dh-<task>`, from up-to-date `main`).
   Brief: the requirement ID and slice, the exact files and sections to read, branch, worktree path, its slot
   `k` (1–4: dev-server port 517k, API port 808k, its own `pnpm db:test` databases, its own PIDs — «3. Parallel
   branches»), and the report it returns: 10–15 lines, no narrative (owner, 2026-11-13) — PR, head SHA (full),
   result, blockers, owner questions; details go in the PR body or the review. Reviewer briefs ask for the same
   short report. Agents never create GitHub issues (owner, 2026-11-13): they list follow-ups in the PR body or
   their report, and the lead opens the issues and links them.
   Every implementer and fix brief also says (owner, 2026-11-13/14, #178): committing and pushing to its own PR
   branch is part of the task (if the permission classifier still refuses, the agent stops and reports it, and you
   ask the owner); before tests `pg_lsclusters`, and if the cluster is down `pg_ctlcluster 16 main start` (the
   environment's setup script does not run when a container restarts); type checks as `pnpm typecheck` run in
   the agent's worktree (`cd <worktree> && pnpm typecheck`): it is the same command as the CI job `web` (#184);
   commit WIP to its branch after each step, so a cut-off costs little (owner, 2026-11-14, #178).
   The PR body ends with the session's attribution lines exactly as given in the session's instructions; GitHub
   may rewrite the footer, which is fine. Give every agent a scratchpad prefix or subfolder unique
   to the PR and role (`pr153-review/`, owner, 2026-11-13): a generic `body.md` was overwritten by another agent twice.
3. **PR opened** → do not subscribe while an agent (author, reviewer, fix) works on it: act on the agent's
   report (owner, 2026-11-14, #178); subscribe only when the PR waits for merge (step 6). Then in parallel (every review, first or repeat, goes to a fresh
   agent with a narrow brief, never a resumed long-context reviewer — owner, 2026-11-13,
   [token economy](references/token-economy.md)):
   - a reviewer with `review-pr`;
   - if the PR has the label `sensitive`: a security reviewer with `security-review`.
   Each in a different session from the author, with the PR number and head SHA; the brief asks for the
   verdict as a PR review with `commit_id=<head>`, never an issue comment (owner, 2026-11-14; #185), and for
   the PostgreSQL check before tests (step 2), and says: «red CI is not a review finding unless the change caused
   it; checking CI is the lead's job before merge» (owner, 2026-11-14, #178; #197). Before that, open the
   issues for any dependent slice the implementer listed and link them in the PR body (PRC-02).
4. **Batch**: wait until both reviews are in (owner, 2026-11-13), then collect the blocking items of both
   into **one** fix request to the implementer (`fix-review-findings`): review IDs, which patch wins where
   reviewers conflict (your decision), what is non-blocking (→ «Follow-ups»). Never forward items one by one.
   Resume the implementing agent at most 2 times (owner, 2026-11-13, #178); a third fix round goes to a fresh
   agent with a short brief: the diff, the findings, the patch ([token economy](references/token-economy.md)).
   Fixes that only apply ready reviewer patches go to a fresh agent on a lighter model; if it must deviate from a
   patch, it stops and reports to you, and the fix moves to the strong model (owner, 2026-11-14; #191: the
   reviewer's patch deadlocked).
   Cheap reviewer tests (non-blocking) go into a fix round only when one is needed anyway for a blocking
   finding; both verdicts Ready → merge without them. A branch behind `main` is synced by the fix agent, as a
   separate commit in the same push; then no separate sync-confirmation round (owner, 2026-11-14, #178; #207).
5. **Round 2**: a fresh reviewer per review kind with a narrow brief — the diff since the last reviewed head
   plus its previous findings. At most two rounds; after that the reviewer gives a ready fix and confirms it.
   A confirmation (of fixes or a sync) of a `sensitive` PR goes to **one** agent that posts both verdicts,
   `Verdict` and `Security verdict`, as two PR reviews with `commit_id` (owner, 2026-11-14, #178).
6. **Merge** (squash) only on the **current head SHA** (subscribe to the PR while it waits for merge; before
   every merge read its comments, `gh api repos/{owner}/{repo}/issues/<n>/comments`, for an owner «stop» or
   question — owner, 2026-11-14): CI green, the latest `Verdict: Ready` (and for
   `sensitive` the latest `Security verdict: Ready`) names that exact SHA, the owner decision is recorded for
   `owner-decision` PRs, the owner's approval for cloud or production, no unanswered owner «stop» or question.
   Do not ask the owner to confirm. Ready with only non-blocking items left → merge; they go to follow-ups.
   Order: code PRs with Ready before docs PRs (otherwise their syncs and confirmations repeat, #203); a docs PR
   with decisions that code depends on — at once (owner, 2026-11-14, #178).
   Behind `main` → `sync-branch`, then a confirmation round (none for a docs-only PR not labelled `sensitive`
   that does not overlap `main`'s changes: one command and the lead's review instead). Wait for CI of several PRs with one command. Full list and both
   commands: [merge checklist](references/merge-checklist.md) (read before every merge).

7. **After merge**: unsubscribe from the PR; the branch is deleted; reset the working branch to the new
   `main` (`git fetch origin main && git reset --hard origin/main` in its worktree) or remove the worktree;
   drop its test databases. The non-blocking items left at merge (the PR's «Follow-ups») go to one follow-up
   PR (an implementer on a lighter model, «Token economy») or to an issue each, linked from the merged PR. The lead
   opens the issues; agents never do (owner, 2026-11-13).
   **Token and time accounting** (owner, 2026-11-13/14, mandatory): in the same turn as the merge, before the
   container can lose the agent logs, run `node tools/token-report/index.mjs pr …` and add the row it prints to
   the issue «Облік токенів» (#180): type, rounds, `subagent_tokens`, the agents' real spend from their logs,
   author time (author and fix agents), review time (reviewers and confirmations; every run of a resumed agent
   counted) and CI minutes of the branch ([token economy](references/token-economy.md), «Token accounting»).
8. **Report to the owner** (owner, 2026-11-13): only in Ukrainian, every message; when to write and when to stay
   silent: «Мовчання в чаті» above. Batch the questions (§2). Purely
   technical questions (permission-classifier denials, implementation choices, worker counts, test layout) are
   not asked: you decide and log them (AGENTS.md «Ambiguity»). Details:
   [lead communication](references/lead-communication.md).
9. **Follow-up sweep** (owner, 2026-11-13): after every 8–10 merged PRs, one PR (row `R` of the wave plan, an
   implementer on a lighter model) closes the small open follow-ups: issues labelled or listed as follow-ups and
   the «Follow-ups» lists of the merged PRs. Larger items get a plan row of their own instead. Run row R more
   often, with only modules that have no open PR, security items first (owner, 2026-11-14, #178).
   Small process or rule changes that do not block work wait in the issue «Черга змін процесу» and ship with the
   next process PR or this sweep, not as a PR each (owner, 2026-11-13;
   [lead communication](references/lead-communication.md)).

Rare cases — [stacked PRs and CI that cannot run](references/stacked-and-blocked.md) (read when a PR depends on
another open PR, or CI cannot run: then stop merging and tell the owner at once).

**New lead session** (owner, 2026-11-13/14): when your context reaches ~400 k tokens (`get_session` →
`external_metadata.context_usage.used_tokens`), has been compacted, or after 8–10 merged PRs, whichever comes
first, start no new tasks and let the in-flight agents finish. Post the session's retrospective — conclusions,
productivity (tokens, time, the lead's share, the costliest PRs), improvement proposals each with its risks,
downsides and mitigations, risks — as a comment on #180, and tell it to the owner briefly in chat; its process
proposals go to «Черга змін процесу» (owner, 2026-11-14, #178; [token economy](references/token-economy.md),
«Session retrospective»). Then write the state to the GitHub issue «Lead
state» (with a link to «Черга змін процесу»): open PRs with heads and verdicts, running work, owner questions, follow-ups, next plan rows,
and the name for the next session; keep that issue current during the session too, after every 3 merges and
whenever an owner question changes (owner, 2026-11-14). Record the session's token usage in #180, append «(завершено)» to your
session title, and tell the owner to start a new session, giving the ready start message for it in one code block that the owner only copies (owner, 2026-11-14; [restarts](references/restarts.md), «Start message»). A new session first renames itself
`Willowsum · ведучий N · <з чого починає>`, records its starting usage in #180, checks `get_session` →
`external_metadata.rate_limit_info` (on a warning: at most 2–3 authors at once, reviews not cut; owner,
2026-11-14, #178), then reads «Lead state»
([restarts](references/restarts.md), [token economy](references/token-economy.md)).
Every handover is confirmed to the owner in chat in full, item by item: what was done with each item and where
it is recorded (file, PR or issue, with a link); an item not acted on is marked not done, with the reason. A
shortened summary does not count. Every owner decision lives in a document (decision log, skill, AGENTS.md,
requirement) and in the rules it changes, never only in session memory (owner, 2026-11-13).

## 2. Owner

- Questions to the owner are explicit and separate: one numbered list, each with options and your
  recommendation; only real product questions (AGENTS.md «Ambiguity»). Every improvement proposal to the owner,
  in a retrospective or anywhere else, comes with its risks, downsides and mitigations (owner, 2026-11-14, #178).
- **Batch the questions** (owner, 2026-11-13): collect non-urgent questions (and the «told afterwards» notes
  on small details) and send them together in one message, with the next merge report or decision request. Urgent ones go at once,
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
  resume). An agent cut off by a limit or a restart: save its uncommitted work at once with a WIP commit on its
  branch (owner, 2026-11-14, #178; #197).
- **Workflow experiment** (owner, 2026-11-14, #178): one run of a Workflow «супровідник» that takes one PR
  without `sensitive` (e.g. a row `R`) from implementation to ready-to-merge; before starting it, ask the owner in
  chat for consent to that exact run. Then compare its tokens and time with #180 and report before any second run.
- Model by risk: the strongest model for sensitive features and security reviews of critical modules; a
  lighter one only for `review-pr` of docs-and-requirement-text-only PRs (not when they touch a security
  rule), ready reviewer patches, follow-up PRs and status checks; code reviews and their confirmation rounds
  stay on the main model — [token economy](references/token-economy.md) (read when you choose a model or write
  a brief).

