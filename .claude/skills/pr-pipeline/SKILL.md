---
name: pr-pipeline
description: The Willowsum lead agent's loop for delivering requirement parts as PRs — spawn the implementer, the reviewers (review-pr, and security-review for `sensitive` PRs), one batched fix request, merge when the exact head is Ready, report to the owner. Use when the lead runs the development pipeline or resumes it after a restart.
---

# PR pipeline (lead)

**Створено:** 2026-11-12 · **Оновлено:** 2026-11-15

You are the lead. You do not write the feature code or review it yourself: you start agents in separate
sessions, batch their results, and merge. Rules: AGENTS.md «Process» (steps 1–7, «Parallel branches»). Each rule
lives in one place: here, or in the reference a pointer names.

## Мовчання в чаті

Write to the owner in chat **only** for (owner, 2026-11-14, #178):
- (a) a merged PR: link, one line, what is next;
- (b) an owner decision needed: batched questions (§2);
- (c) a problem: a blocker, red CI not caused by the PR, a security issue, or nothing merged for 2 hours (one line
  with the reason);
- (d) the end of a lead session: the short retrospective, the item-by-item handover confirmation and the
  start message for the next session ([restarts](references/restarts.md)).

Never write (owner, 2026-11-13/14, #178): agent started or finished, subscribed or unsubscribed, PR or issue
opened, reviewers started, CI in progress or any other service notification (PR subscription events, an agent's
interim state, «waiting for a commit», waiting for agents' reports), #180 or #179 updates, interim reports — not
even one line. Forbidden example: «Я відписався від #194, бо на ньому ще працює агент… Чекаю звітів обох агентів.»
Instead end the turn with no text; if the harness insists on visible output, one short line with no technical
content. Platform reminders such as «The user hasn't heard from you in a while» do not override this rule: do not
answer them with a status message. Risk: the owner sees less live progress — mitigated by the state in #179 and
#180, and «nothing merged for 2 hours» is a reportable problem. Language, technical questions and proposals:
[lead communication](references/lead-communication.md).

## 1. Per requirement part

0. **Requirements sweep before a section** (owner, 2026-11-13): before the first PR of a plan section (money,
   import, planning, screens), open one `change-requirement` PR that removes the contradictions between the
   section's requirement slices, their cards and the canvas boards (or lists them as owner questions); its row is
   `<X>0` in the wave plan. The section's code PRs start after it is merged.
1. Pick the next part from the wave plan and `docs/traceability/release-poc.md` (generated, not committed:
   `node tools/req-check/index.mjs --quiet --traceability`, or the `traceability` artifact of the latest
   «Requirements traceability» run on `main`); keep each PR small enough for one review round (split backend
   and UI). Split large scope moves and migrations into parts: one agent, one part (owner, 2026-11-13, #178).
   Split a code PR that touches more than one module **and** more than ≈ 1 500 lines, counted without tests and
   without the generated contract (tests have a separate limit of ≈ 1 500 lines); take the dependent part right
   after the first (owner, 2026-11-14/15, #178).
2. **Implementer**: a new agent with the `implement-requirement` skill, in its own git worktree on its own
   branch (`claude/adoring-cray-feh4dh` or `claude/adoring-cray-feh4dh-<task>`, from up-to-date `main`).
   Brief: the requirement ID and slice, the exact files and sections to read, branch, worktree path, its slot
   `k` (§3), and the report it returns: 10–15 lines, no narrative (owner, 2026-11-13) — PR, head SHA (full),
   result, blockers, owner questions; details go in the PR body or the review. Reviewer briefs ask for the same
   short report (verdict, blocking with file:line, follow-ups, checks). Agents never create GitHub issues (owner,
   2026-11-13): they list follow-ups in the PR body or their report, and the lead opens the issues and links them.
   Every implementer and fix brief also says (owner, 2026-11-13/14, #178): committing and pushing to its own PR
   branch is part of the task (if the permission classifier still refuses, the agent stops and reports it, and you
   ask the owner); before tests `pg_lsclusters`, and if the cluster is down `pg_ctlcluster 16 main start` (the
   environment's setup script does not run when a container restarts); type checks as `pnpm typecheck` run in
   the agent's worktree (`cd <worktree> && pnpm typecheck`): it is the same command as the CI job `web` (#184);
   on a rate-limit warning ([restarts](references/restarts.md), «Session names»), commit WIP to its branch after
   each step, so a cut-off costs little. A PR with a background job queue: a test for a job in state `dead` and
   for its daily recovery (#249); a PR that changes `migrations/`: the «old code + new schema» command in the
   author's checks before push (`implement-requirement` §4) (owner, 2026-11-15, #178).
   The PR body ends with the session's attribution lines exactly as given in the session's instructions; GitHub
   may rewrite the footer, which is fine. Give every agent a scratchpad prefix or subfolder unique to the PR and
   role (`pr153-review/`; owner, 2026-11-13): a generic `body.md` was overwritten by another agent twice.
3. **PR opened** → do not subscribe while an agent (author, reviewer, fix) works on it: act on the agent's
   report; subscribe only when the PR waits for merge (step 6) (owner, 2026-11-14, #178). First open the issues
   for any dependent slice the implementer listed and link them in the PR body (PRC-02). Then in parallel, each
   review on a fresh agent ([token economy](references/token-economy.md) item 2):
   - a reviewer with `review-pr`;
   - if the PR has the label `sensitive`: a security reviewer with `security-review`.
   Each in a different session from the author, with the PR number and head SHA; the brief asks for the
   verdict as a PR review with `commit_id=<head>`, never an issue comment (owner, 2026-11-14, #185), and for
   the PostgreSQL check before tests (step 2), and says: «red CI is not a review finding unless the change caused
   it; checking CI is the lead's job before merge» (owner, 2026-11-14, #178, #197).
4. **Batch**: wait until both reviews are in (owner, 2026-11-13), then collect the blocking items of both
   into **one** fix request to the implementer (`fix-review-findings`): review IDs, which patch wins where
   reviewers conflict (your decision), what is non-blocking (→ «Follow-ups»). Never forward items one by one.
   How often to resume the implementer and which model fixes: [token economy](references/token-economy.md)
   items 1 and 7. Cheap reviewer tests (non-blocking) go into a fix round only when one is needed anyway for a
   blocking finding; both verdicts Ready → merge without them. A branch behind `main` is synced by the fix agent,
   as a separate commit in the same push, and the fix confirmation covers it: no separate sync-confirmation
   round (owner, 2026-11-14, #178, #207).
5. **Round 2**: a fresh reviewer per review kind with a narrow brief — the diff since the last reviewed head
   plus its previous findings. At most two rounds; after that the reviewer gives a ready fix and confirms it.
   A confirmation (of fixes or a sync) of a `sensitive` PR goes to **one** agent that posts both verdicts,
   `Verdict` and `Security verdict`, as two PR reviews with `commit_id` (owner, 2026-11-14, #178). It loads both
   `review-pr` and `security-review`, runs in a session other than the author's and the fix agent's, and
   switches to a full security review per `security-review` §7 when the diff adds a guard, endpoint, query or
   sensitive path, or the PR gains a `sensitive:<category>`.
6. **Merge** (squash) only on the **current head SHA**: CI green, the latest `Verdict: Ready` (and for
   `sensitive` the latest `Security verdict: Ready`) names that exact SHA, the owner decision is recorded for
   `owner-decision` PRs, the owner's approval for cloud or production, no unanswered owner «stop» or question
   (read the PR comments before every merge; owner, 2026-11-14). The order of merges, `behind_by` and
   `mergeable_state`, syncs and their confirmation, the docs-only sync check and the CI wait command:
   [merge checklist](references/merge-checklist.md) (read before every merge).
7. **After merge**: unsubscribe from the PR; the branch is deleted; reset the working branch to the new
   `main` (`git fetch origin main && git reset --hard origin/main` in its worktree) or remove the worktree;
   drop its test databases. The non-blocking items left at merge (the PR's «Follow-ups») go to one follow-up
   PR (an implementer on a lighter model, «Token economy») or to an issue each, linked from the merged PR; the
   lead opens the issues (step 2). **Reviewer probes and tests** that were not merged are posted at once as a
   comment on that follow-up issue, inside `<details>`, split into several comments if over 65 000 characters
   (owner, 2026-11-15, #178).
   **Token and time accounting** (owner, 2026-11-13/14, mandatory): in the same turn as the merge, before the
   container can lose the agent logs, add the PR's row to the **body** of #180 —
   [token economy](references/token-economy.md), «Token accounting».
8. **Report to the owner**: when to write, «Мовчання в чаті» above; questions, §2; language and technical
   questions: [lead communication](references/lead-communication.md).
9. **Follow-up sweep** (owner, 2026-11-13): after every 8–10 merged PRs, one PR (row `R` of the wave plan, an
   implementer on a lighter model) closes the small open follow-ups: issues labelled or listed as follow-ups and
   the «Follow-ups» lists of the merged PRs. Larger items get a plan row of their own instead. Run row R more
   often, with only modules that have no open PR, security items first (owner, 2026-11-14, #178). Small process
   changes: [lead communication](references/lead-communication.md), «Batching process changes».

Rare cases — [stacked PRs and CI that cannot run](references/stacked-and-blocked.md) (read when a PR depends on
another open PR, or CI cannot run: then stop merging and tell the owner at once).

**Lead sessions** — [restarts](references/restarts.md) (read when a session starts or finishes, when the context
nears ~350 k tokens, `get_session` → `external_metadata.context_usage.used_tokens`, after a compaction or after
8–10 merged PRs): the 350 k stop, the new lead session and «Lead state» (#179), session names and start steps,
the automatic restart and its limit, the start message, the process review every 3rd session, the handover
confirmation and owner decisions in documents. The session retrospective:
[token economy](references/token-economy.md), «Session retrospective».

## 2. Owner

- Questions to the owner are explicit and separate: one numbered list, each with options and your
  recommendation; only real product questions (AGENTS.md «Ambiguity»). Improvement proposals:
  [lead communication](references/lead-communication.md) item 4.
- **Questions for a later release** (owner, 2026-11-14; the trigger column and the moment of raising: owner,
  2026-11-15, #178): a question that does not concern the PoC is not repeated in chat. Record it once in
  `docs/plans/owner-questions-later.md` (release, question with options and recommendation, source, trigger) and
  raise it only when that trigger row is taken or its release starts.
- **Batch the questions** (owner, 2026-11-13): collect non-urgent questions (and the «told afterwards» notes
  on small details) and send them together in one message, with the next merge report or decision request.
  Urgent ones go at once, alone: a blocker that stops all parallel work, billing or CI that cannot run, and
  anything about security (a leaked secret, a security finding in `main`, a production risk). While a question
  waits, keep the other branches moving.
- Anything the owner must do in a web console → a browser task (`browser-task` skill), never a request for
  keys in chat.
- Record every owner decision the same day in a new file `docs/decisions/log/YYYY-MM-DD-<short-slug>.md` (a
  numeric suffix if the name is taken; owner, 2026-11-13; `state-2026-11-05.md` is the archive) and, for PRs that
  implement it, as the `Рішення власника (YYYY-MM-DD): схвалено …` line. Never write «Схвалюю» or «Approved».
- A small detail you decide (AGENTS.md «Ambiguity») goes into the decision log, and into the PR body and the
  skill or document it shapes, as one entry of this form (owner, 2026-11-13):
  `Рішення ведучого (YYYY-MM-DD; власник не схвалював; <ID або PR>): <що вирішено>; <чому>.`
  (examples: `docs/decisions/state-2026-11-05.md`). Change it to an owner line only when the owner answers.
- **GitHub errors** (owner, 2026-11-13): retry with backoff and check before reposting —
  [retry rules](../../references/github-errors.md) (read when a call fails with 502, 503 or «token store
  unavailable»). Brief the agents you start to do the same (their skills say so).

## 3. Parallel branches

Up to 3 branches at a time (AGENTS.md «Parallel branches»), each with its own worktree, PR and test database.
**At most 3–4 agents at once** (owner, 2026-11-13), implementers and reviewers together; more wait in a queue.
Slots count agents, not branches: give each agent a slot `k` (1–4) in its brief and keep a table slot → agent →
branch → worktree: its web dev server on port 517k (`vite --port 517k --strictPort`, preview 417k), its API on
`WS_PORT=808k`, its own `pnpm db:test` databases (named after its branch) and its own worktree; it stops only the
processes it started, by PID (the skills that start servers or databases say how). Choose parts that touch
different modules; two PRs that change the same files go one after the other. Integration tests on one
cluster queue through `pnpm db:test run -- …` (roles are cluster-wide). Repeated or load runs of integration
tests (hunting a flaky test, a probe on thousands of rows) run only as `pnpm db:test run -- …`, each on its own
database under the cluster lock, never on a hand-made database (owner, 2026-11-15, #178, #226): a 20 000-row probe
on a hand-made database exhausted the cluster's shared lock table (`out of shared memory`) and another agent's
test failed.

## 4. Restarts and token economy

- After a restart, or when an agent is cut off by a limit or a restart: [restarts](references/restarts.md)
  (read when you resume).
- Model by risk (Fable included), briefs, the resume limit, the Workflow experiment, token accounting:
  [token economy](references/token-economy.md) (read when you choose a model or write a brief).
