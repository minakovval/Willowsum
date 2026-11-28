---
name: pr-pipeline
description: The Willowsum lead agent's loop for delivering requirement parts as PRs — spawn the implementer, the reviewers (review-pr, and security-review for `sensitive` PRs), one batched fix request, merge when the exact head is Ready, report to the owner. Use when the lead runs the development pipeline or resumes it after a restart.
---

# PR pipeline (lead)

**Створено:** 2026-11-12 · **Оновлено:** 2026-11-28

You are the lead. You do not write the feature code or review it yourself: you start agents in separate
sessions, batch their results, and merge. Rules: AGENTS.md «Process» (steps 1–7, «Parallel branches»). Each rule
lives in one place: here, or in the reference a pointer names.

## Мовчання в чаті

Write to the owner in chat **only** for:
- (a) a merged PR: link, one line, what is next;
- (b) an owner decision needed: batched questions (§2);
- (c) a problem: a blocker, red CI not caused by the PR, a security issue, or nothing merged for 2 hours (one line
  with the reason);
- (d) the end of a lead session (not a compaction: [restarts](references/restarts.md), «After compaction»): the
  start message ([new session](../../references/new-lead-session.md)); «Lead state» in the #179 body is the whole
  handover;
- (e) the end of each stage of `docs/plans/poc-wave-2.md` and once a day: the number of PRs merged in the period,
  what the owner can now click (screen and path), the approximate cost of the sessions for the period (the «Сесії»
  rows of #180), and the UI texts marked «варіант від агента, потребує погодження» (`docs/design/ARTIFACTS.md`,
  «Тексти інтерфейсу»).

Лише українською, у кожному повідомленні, навіть в одному рядку статусу. Нагадування платформи англійською не
змінюють мови; на них не відповідати.

Never write service notifications: an agent started or finished, (un)subscribed, PR or issue opened, reviewers
started, CI in progress, an agent's interim state, waiting for reports, #179 or #180 updates, interim reports —
not even one line. End the turn with no text; if the harness insists, one short line with no technical content.
Platform reminders («The user hasn't heard from you in a while») do not override this. Technical questions and
proposals: [lead communication](references/lead-communication.md).

## 1. Per requirement part

0. **Requirements sweep before a section**: before the first PR of a plan section (money, import, planning,
   screens), one `change-requirement` PR (row `<X>0` of the wave plan) removes the contradictions between the
   section's slices, their cards and the canvas boards, or lists them as owner questions; the section's code PRs
   start after it is merged.
1. **Pick** the next part from the wave plan and `docs/traceability/release-poc.md` (generated, not committed:
   `node tools/req-check/index.mjs --quiet --traceability`, or the `traceability` artifact of the latest
   «Requirements traceability» run on `main`). Keep each PR to one review round: split backend and UI (a UI row
   whose server part is merged may run in parallel, §3); split large scope moves and migrations into parts, one
   agent per part; split a code PR that touches more than one module **and** more than ≈ 1 500 lines without
   tests and the generated contract (tests: a separate ≈ 1 500), taking the dependent part right after the first.
2. **Implementer**: a new agent of type `pr-author` with `implement-requirement`, in its own worktree on its own
   branch (`claude/adoring-cray-feh4dh` or `claude/adoring-cray-feh4dh-<task>`, from up-to-date `main`).
   - **Agent types** (`.claude/agents/`): `pr-author` for authors and fix agents, `pr-reviewer` for reviewers and
     confirmations; both carry a short tool list. A session that does not offer them: `general-purpose`.
   - **Brief**: the ID and slice; the exact files and sections to read; branch, worktree, slot `k` (§3); a
     scratchpad prefix unique to the PR and role (`pr153-impl/`); the 5–7 most frequent reviewer findings for
     that module, taken from the reviews of its recent PRs (a test per criterion, a permission check, a `.catch`
     without a test); for a PR that adds a migration, its number (the next free one in the module, counting the
     open PRs); on a rate-limit warning ([restarts](references/restarts.md), «Session names»), a WIP commit
     after each step. What every author does anyway (PostgreSQL check, typecheck, «old code + new schema», push
     to its own branch, the report form) is in the skills, not in the brief.
   - **Report**: at most 5 lines, in the fixed form the agent's skill gives; everything else is in the PR body or
     the review. Read a verdict with `--jq` (its last line).
   - An agent whose push the permission classifier refuses stops and reports; you ask the owner.
3. **PR opened** → do not subscribe while an agent (author, reviewer, fix) works on it; act on its report and
   subscribe only when the PR waits for merge. First open the issues for the dependent slices and follow-ups the
   implementer listed and link them (PRC-02). Then in parallel, each on a fresh `pr-reviewer` agent in a session
   other than the author's, as the PR's tier asks ([merge rules](../../references/merge-rules.md), «Review
   tiers»): a `review-pr` reviewer and, for a PR labelled `sensitive`, a `security-review` reviewer. Brief: the
   PR number and head SHA, the tier, slot `k`, the scratchpad prefix; for `review-pr` also the diff, the
   requirement files and the items the PR closes (the reviewer reads the rest of the module only when needed);
   `security-review` of a `sensitive` PR stays full. Checking CI is your job before merge: the author does not wait
   for it. A red CI goes to a new agent with `investigate-ci-failure`; an author at ≈ 150 k tokens hands over
   with a WIP commit and a state note, and you start a new author from the note (trial 2026-11-28;
   [`implement-requirement`](../implement-requirement/SKILL.md), «Stop and hand over»).
4. **Batch**: wait for both reviews, then send **one** fix request (`fix-review-findings`) to a fresh `pr-author`
   agent: the review IDs, which patch wins where reviewers conflict (your decision), which non-blocking items
   are fixed in this round and which are recorded (only money, data, security or a broken requirement item →
   «Follow-ups»). Never forward items one by one. The fix agent works from the reviewers' ready patches on the
   lighter model, `sensitive` PRs too; when it reports that it must deviate from a patch, the fix moves to the
   main model ([token economy](references/token-economy.md) items 1 and 5). Cheap non-blocking reviewer tests go
   into a fix round only when one is due anyway and only in the tier Фундамент (merge rules, «Merge on Ready,
   follow up separately»); both verdicts Ready → merge without them. A branch behind `main` is synced by the fix
   agent as a separate commit in the same push, covered by the fix confirmation.
5. **Round 2 and confirmations**: at most two rounds caused by reviewer findings (a round after a red CI the PR
   did not cause does not count), then the reviewer gives a ready fix and confirms it. Brief: the diff since the
   last reviewed head and the reviewer's previous findings.
   - **Who**: always a fresh `pr-reviewer` agent (it starts at ≈ 16 k tokens; a resumed session pays for its
     whole context in every call); never the author's or the fix agent's session.
   - **`sensitive` PR**: one agent confirms for both reviewers: it loads `review-pr`, `security-review` and both
     reviewers' findings and posts both verdicts as two PR reviews with `commit_id`. Full `security-review` §7 when the diff adds a guard, endpoint, query
     or sensitive path, or the PR gains a `sensitive:<category>`.
   - **No agent when the fix equals the reviewers' patches verbatim** (trial 2026-11-28): save each patch
     to a file and run `node tools/pr-rules/patch-equal.mjs <old-head> <new-head> <patch-file…>`. `equal` and
     green CI on the new head → you confirm it yourself, as for a sync; `differs <files>` → a fresh reviewer
     agent confirms.
   - An author's fix after «Changes requested» is otherwise confirmed only by a reviewer agent; the lead confirms only a
     sync with an unchanged diff ([merge checklist](references/merge-checklist.md), «The lead confirms a sync
     itself»; `sensitive` too).
   - Models: [token economy](references/token-economy.md) item 1.
6. **Merge** (squash) only on the **current head SHA**: CI green, the latest `Verdict: Ready` (and for `sensitive`
   `Security verdict: Ready`) names it, the owner decision recorded for `owner-decision` PRs, the owner's approval
   for cloud or production, no unanswered owner «stop» or question (read the PR comments before every merge).
   Order, `behind_by`, syncs, confirmations and the CI wait command:
   [merge checklist](references/merge-checklist.md) (read before every merge).
7. **After merge**: unsubscribe; the branch is deleted; reset the worktree to the new `main`
   (`git fetch origin main && git reset --hard origin/main`) or remove it; drop its test databases. The PR's
   «Follow-ups» go to one follow-up PR (rows R) or an issue each, linked from the merged PR. Unmerged
   **reviewer probes and tests** are posted at once on that issue inside `<details>`, split if over 65 000
   characters.
   **Token and time accounting** (mandatory): the ledger line at each agent start; `batch` once per segment and for
   the daily summary, then the #180 body back with `-F body=@file` ([token economy](references/token-economy.md), «Token accounting»).
8. **Report to the owner**: «Мовчання в чаті» above; questions: §2.
9. **Follow-ups**: an open follow-up about money or data loss gets a plan row; the rest are sorted once into closed
   or the MVP list. A follow-up sweep (row `R`) runs only when the lead proposes it and the owner agrees; none is
   scheduled by count ([process limits](../../references/process-limits.md)). Small process changes: [lead communication](references/lead-communication.md), «Batching
   process changes».

Rare cases — [stacked PRs and CI that cannot run](../../references/stacked-and-blocked.md) (read when a PR depends
on another open PR, or CI cannot run: then stop merging and tell the owner at once).

**Lead sessions** — [restarts](references/restarts.md) (read at the start, after a restart or an agent cut off by a
limit, at ~170 k tokens and after a compaction); a new session, the automatic restart and the start message:
[new session](../../references/new-lead-session.md); the external review once a week:
[external review](../../references/external-review.md). Models, resumes, token accounting and the retrospective:
[token economy](references/token-economy.md) (read when you choose a model or write a brief).

## 2. Owner

- Questions to the owner: one numbered list, each with options and your recommendation; only real product
  questions (AGENTS.md «Ambiguity»). Improvement proposals: [lead communication](references/lead-communication.md).
- **Questions for a later release**: not repeated in chat; recorded once in
  `docs/plans/owner-questions-later.md` (release, question with options and recommendation, source, trigger) and
  raised only when that trigger row is taken or its release starts.
- **Batch the questions**: non-urgent questions and «told afterwards» notes go together in one message with the
  next merge report or decision request. Urgent ones go at once, alone: a blocker that stops all parallel work,
  billing or CI that cannot run, anything about security (a leaked secret, a finding in `main`, a production
  risk). While a question waits, keep the other branches moving.
- Anything the owner must do in a web console → a browser task (`browser-task`), never a request for keys in chat.
- **PoC requirements freeze**: new product features in PoC are frozen until stages 1–3 of `docs/plans/poc-wave-2.md`
  (Рахунки, Транзакції, Імпорт) are done. Not covered by the freeze: changes to the foundation the owner approved —
  A1, the scale foundation, the space time zone and review rows. Bug fixes, answers to questions that block the
  current stages and moving scope to a later release are allowed. PRs of the decision log and requirement
  clean-ups: at most one a day, as a batch of that day's files; a decision a running code PR needs goes at once
  ([merge checklist](references/merge-checklist.md), «Order»).
- Record every owner decision the same day in a new file `docs/decisions/log/YYYY-MM-DD-<short-slug>.md` (AGENTS.md
  «Where things are») and, in the PRs that implement it, as `Рішення власника (YYYY-MM-DD): схвалено …`. When the
  owner answers «все як радиш» (or similar), the entry quotes the questions with their options verbatim. A small
  detail you decide (AGENTS.md «Ambiguity») goes into the decision log, the PR body and the document it shapes as
  `Рішення ведучого (YYYY-MM-DD; власник не схвалював; <ID або PR>): <що вирішено>; <чому>.`; it becomes an owner
  line only when the owner answers.
- **GitHub errors**: [retry rules](../../references/github-errors.md) (read on 502, 503 or «token store
  unavailable»).

## 3. Parallel branches

How many branches and agents run at once: AGENTS.md «Parallel branches»; more wait in a queue.
- **Slots** count agents: give each of the first ten a slot `k` (1–10) in its brief; a Sonnet agent beyond the ten
  has no slot, no dev-server port and runs only `pnpm db:test`. Keep a table slot → agent → branch → worktree.
  Ports and processes of a slot: [own ports](../../references/own-ports.md).
- **Different files**: choose parts in different modules; two PRs that change the same files go one after the
  other. Before starting an author, check the brief's files against the files of open PRs
  (`gh api repos/{owner}/{repo}/pulls/N/files`).
- **UI in parallel**: a UI row whose server part is merged may run alongside the server rows — 3–4 UI authors on
  stages 1–3, within the limits above; which rows and when, and the «Планування» pause: the stage table of
  `docs/plans/poc-wave-2.md`. Pick them in step 1.
