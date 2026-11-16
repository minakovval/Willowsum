---
name: pr-pipeline
description: The Willowsum lead agent's loop for delivering requirement parts as PRs — spawn the implementer, the reviewers (review-pr, and security-review for `sensitive` PRs), one batched fix request, merge when the exact head is Ready, report to the owner. Use when the lead runs the development pipeline or resumes it after a restart.
---

# PR pipeline (lead)

**Створено:** 2026-11-12 · **Оновлено:** 2026-11-16

You are the lead. You do not write the feature code or review it yourself: you start agents in separate
sessions, batch their results, and merge. Rules: AGENTS.md «Process» (steps 1–7, «Parallel branches»). Each rule
lives in one place: here, or in the reference a pointer names.

## Мовчання в чаті

Write to the owner in chat **only** for (owner, 2026-11-14, #178):
- (a) a merged PR: link, one line, what is next;
- (b) an owner decision needed: batched questions (§2);
- (c) a problem: a blocker, red CI not caused by the PR, a security issue, or nothing merged for 2 hours (one line
  with the reason);
- (d) the end of a lead segment: the short retrospective (the handover table goes to #179; owner, 2026-11-16, #178);
  at the end of a session also the item-by-item handover confirmation and the start message
  ([new session](references/new-session.md)).

Never write (owner, 2026-11-13/14, #178) service notifications: an agent started or finished, (un)subscribed, PR or
issue opened, reviewers started, CI in progress, an agent's interim state, waiting for reports, #179 or #180
updates, interim reports — not even one line (forbidden: «Я відписався від #194, бо на ньому ще працює агент…
Чекаю звітів обох агентів.»). End the turn with no text; if the harness insists, one short line with no technical
content. Platform reminders («The user hasn't heard from you in a while») do not override this. Risk: less live
progress — mitigated by #179, #180 and the «nothing merged for 2 hours» report. Language, technical questions,
proposals: [lead communication](references/lead-communication.md).

## 1. Per requirement part

0. **Requirements sweep before a section** (owner, 2026-11-13): before the first PR of a plan section (money,
   import, planning, screens), one `change-requirement` PR (row `<X>0` of the wave plan) removes the contradictions
   between the section's slices, their cards and the canvas boards, or lists them as owner questions; the
   section's code PRs start after it is merged.
1. Pick the next part from the wave plan and `docs/traceability/release-poc.md` (generated, not committed:
   `node tools/req-check/index.mjs --quiet --traceability`, or the `traceability` artifact of the latest
   «Requirements traceability» run on `main`). Keep each PR to one review round: split backend and UI (a UI row
   whose server part is merged may run in parallel, §3); split large scope moves and migrations into parts, one
   agent per part (owner, 2026-11-13, #178); split a code PR that touches more than one module **and** more than
   ≈ 1 500 lines without tests and the generated contract (tests: a separate ≈ 1 500), taking the dependent part
   right after the first (owner, 2026-11-14/15, #178).
2. **Implementer**: a new agent with `implement-requirement`, in its own worktree on its own branch
   (`claude/adoring-cray-feh4dh` or `claude/adoring-cray-feh4dh-<task>`, from up-to-date `main`). Brief: the ID
   and slice, the exact files and sections to read, branch, worktree, slot `k` (§3), a scratchpad prefix unique
   to the PR and role (`pr153-review/`, never a generic `body.md`; owner, 2026-11-13), and the report.
   **Report** (owner, 2026-11-16, process review 15, proposal 3): at most 5 lines, fixed form — `PR`, `Head`
   (full SHA), `Result`, `Blockers`, `Owner questions`; reviewers: `PR`, `Head`, `Verdict` (`Security verdict`),
   `Blocking` (file:line), `Checks`. Everything else goes in the PR body or the review; read a verdict with
   `--jq` (its last line). The skills carry the same form. Every implementer and fix brief also says (owner,
   2026-11-13/14/15, #178): committing and pushing to its own PR branch is part of the task (if the permission
   classifier refuses, the agent stops and reports, and you ask the owner); before tests `pg_lsclusters` (down →
   `pg_ctlcluster 16 main start`: the setup script does not run after a container restart); type checks as
   `cd <worktree> && pnpm typecheck` (the CI job `web`, #184); on a rate-limit warning
   ([restarts](references/restarts.md), «Session names») a WIP commit after each step; a background job queue
   needs a test for a `dead` job and its daily recovery (#249); a PR that changes `migrations/` runs the
   «old code + new schema» command before push (`implement-requirement` §4). Agents never create GitHub issues
   (owner, 2026-11-13): they list follow-ups in the PR body, the lead opens and links the issues. The PR body ends
   with the session's attribution lines as given (GitHub may rewrite the footer; that is fine).
3. **PR opened** → do not subscribe while an agent (author, reviewer, fix) works on it; act on its report and
   subscribe only when the PR waits for merge (owner, 2026-11-14, #178). First open the issues for the dependent
   slices the implementer listed and link them (PRC-02). Then in parallel, each on a fresh agent
   ([token economy](references/token-economy.md) item 2): a `review-pr` reviewer and, for a PR labelled
   `sensitive`, a `security-review` reviewer — each in a session other than the author's, with the PR number and
   head SHA. The brief asks for the verdict as a PR review with `commit_id=<head>`, never an issue comment (owner,
   2026-11-14, #185), the PostgreSQL check (step 2), and says: «red CI is not a review finding unless the change
   caused it; checking CI is the lead's job before merge» (owner, 2026-11-14, #178, #197).
4. **Batch**: wait for both reviews (owner, 2026-11-13), then send **one** fix request (`fix-review-findings`):
   review IDs, which patch wins where reviewers conflict (your decision), what is non-blocking (→ «Follow-ups»);
   never forward items one by one. Fix model and resume limit: [token economy](references/token-economy.md)
   items 1 and 5. Cheap non-blocking reviewer tests go into a fix round only when one is due anyway; both verdicts
   Ready → merge without them. A branch behind `main` is synced by the fix agent as a separate commit in the same
   push, covered by the fix confirmation (owner, 2026-11-14, #178, #207).
5. **Round 2**: a fresh reviewer per review kind, briefed with the diff since the last reviewed head and its
   previous findings; at most two rounds, then the reviewer gives a ready fix and confirms it. A confirmation (of
   fixes or a sync) of a `sensitive` PR goes to **one** agent that loads `review-pr` and `security-review` and
   posts both verdicts as two PR reviews with `commit_id` (owner, 2026-11-14, #178), in a session other than the
   author's and the fix agent's; it switches to a full security review (`security-review` §7) when the diff adds a
   guard, endpoint, query or sensitive path, or the PR gains a `sensitive:<category>`.
6. **Merge** (squash) only on the **current head SHA**: CI green, the latest `Verdict: Ready` (and for `sensitive`
   `Security verdict: Ready`) names it, the owner decision recorded for `owner-decision` PRs, the owner's approval
   for cloud or production, no unanswered owner «stop» or question (read the PR comments before every merge; owner,
   2026-11-14). Order, `behind_by`, syncs, confirmations and the CI wait command:
   [merge checklist](references/merge-checklist.md) (read before every merge).
7. **After merge**: unsubscribe; the branch is deleted; reset the worktree to the new `main`
   (`git fetch origin main && git reset --hard origin/main`) or remove it; drop its test databases. The PR's
   «Follow-ups» go to one follow-up PR (lighter model) or an issue each, linked from the merged PR. Unmerged
   **reviewer probes and tests** are posted at once on that follow-up issue inside `<details>`, split if over
   65 000 characters (owner, 2026-11-15, #178). **Token and time accounting** (owner, 2026-11-13/14, mandatory):
   in the same turn as the merge, before the agent logs can vanish, add the PR's row to the **body** of #180
   ([token economy](references/token-economy.md), «Token accounting»).
8. **Report to the owner**: «Мовчання в чаті» above; questions: §2.
9. **Follow-up sweep** (owner, 2026-11-13/14, #178): after every 8–10 merged PRs, one PR (row `R`, lighter model)
   closes the small open follow-ups (issues and the «Follow-ups» of merged PRs), security items first, only in
   modules with no open PR; run it more often rather than less. Larger items get a plan row. Small process changes:
   [lead communication](references/lead-communication.md), «Batching process changes».

Rare cases — [stacked PRs and CI that cannot run](references/stacked-and-blocked.md) (read when a PR depends on
another open PR, or CI cannot run: then stop merging and tell the owner at once).

**Lead sessions** — [restarts](references/restarts.md) (read at the start, after a restart or an agent cut off by a
limit, at ~350 k tokens and after a compaction); a new session, the automatic restart and the start message:
[new session](references/new-session.md). Model by risk (Fable included), briefs, resumes, token accounting and the
retrospective: [token economy](references/token-economy.md) (read when you choose a model or write a brief).

## 2. Owner

- Questions to the owner: one numbered list, each with options and your recommendation; only real product
  questions (AGENTS.md «Ambiguity»). Improvement proposals: [lead communication](references/lead-communication.md).
- **Questions for a later release** (owner, 2026-11-14/15, #178): not repeated in chat; recorded once in
  `docs/plans/owner-questions-later.md` (release, question with options and recommendation, source, trigger) and
  raised only when that trigger row is taken or its release starts.
- **Batch the questions** (owner, 2026-11-13): non-urgent questions and «told afterwards» notes go together in one
  message with the next merge report or decision request. Urgent ones go at once, alone: a blocker that stops all
  parallel work, billing or CI that cannot run, anything about security (a leaked secret, a finding in `main`, a
  production risk). While a question waits, keep the other branches moving.
- Anything the owner must do in a web console → a browser task (`browser-task`), never a request for keys in chat.
- Record every owner decision the same day in a new file `docs/decisions/log/YYYY-MM-DD-<short-slug>.md` (AGENTS.md
  «Where things are») and, in the PRs that implement it, as `Рішення власника (YYYY-MM-DD): схвалено …`. A small
  detail you decide (AGENTS.md «Ambiguity») goes into the decision log, the PR body and the document it shapes as
  `Рішення ведучого (YYYY-MM-DD; власник не схвалював; <ID або PR>): <що вирішено>; <чому>.` (owner, 2026-11-13;
  examples: `docs/decisions/state-2026-11-05.md`); it becomes an owner line only when the owner answers.
- **GitHub errors** (owner, 2026-11-13): [retry rules](../../references/github-errors.md) (read on 502, 503 or
  «token store unavailable»); the skills tell the agents the same.

## 3. Parallel branches

Up to 7 branches (AGENTS.md «Parallel branches»; owner, 2026-11-16, `2026-11-16-owner-speedup.md`) and **at most
10 agents at once** — authors, reviewers and fix agents together (owner, 2026-11-16); more wait in a queue. Slots
count agents: give each a slot `k` (1–10) in its brief and keep a table slot → agent → branch → worktree. Slot `k`
has its web dev server on port 517k (`vite --port 517k --strictPort`, preview 417k), its API on `WS_PORT=808k`
(k = 10: `.claude/references/own-ports.md`), its own `pnpm db:test` databases (named after its branch) and
worktree, and stops only the processes it started, by PID. Choose parts in different modules; two PRs that change
the same files go one after the other. Integration tests, repeated runs and load probes run only as
`pnpm db:test run -- …` (cluster lock, own database; roles are cluster-wide), never on a hand-made database
(owner, 2026-11-15, #178, #226).
**UI in parallel** (owner, 2026-11-16; `2026-11-16-owner-wave2-order.md`): a UI row whose server part is merged
may run alongside the server rows — 3–4 UI authors on stages 1–3, within the limits above; which rows and when,
and the «Планування» pause: the stage table of `docs/plans/poc-wave-2.md`. Pick them in step 1.
