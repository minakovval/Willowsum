# Restarts

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-15

Moved out of `pr-pipeline` SKILL.md (owner, 2026-11-13); session names, handover confirmation and owner decisions in documents added (owner, 2026-11-13, #178); context limit, «Lead state» cadence and PostgreSQL check added (owner, 2026-11-14, #178); rate limit at start, WIP commits and the session retrospective added (owner, 2026-11-14, #178); the lead starting the next session itself and the 350 k stop added (owner, 2026-11-14, #178); the process review every 3rd session added (owner, 2026-11-15, #178, comment 6892387923). Read when the container restarted, you resume the pipeline, or a lead session starts or finishes.

The container can restart and agents' context is lost. Recover state from durable sources, not memory:
- open PRs and their heads: `gh api 'repos/{owner}/{repo}/pulls?state=open&per_page=100' --jq '.[] | [.number, .head.ref, .head.sha] | @tsv'` (GraphQL, so `gh pr list`, is blocked in cloud sessions);
- the latest reviews per PR (`gh api repos/{owner}/{repo}/pulls/<n>/reviews`), their verdicts and SHAs;
- CI status of each head; finished agents' output files in the session scratchpad;
- worktrees (`git worktree list`) and test databases (`pnpm db:test list`); the PostgreSQL cluster
  (`pg_lsclusters`; down → `pg_ctlcluster 16 main start`: the setup script does not run when a container restarts).
Then continue from the first step that is not done; re-subscribe only to open PRs that wait for merge (no agent on them).
An agent cut off by a limit or a restart: save its uncommitted work at once with a WIP commit on its branch (in its
worktree: `git add -A && git commit -m "WIP: <task> (agent cut off)"`, then push), and brief the next agent from it
(owner, 2026-11-14, #178; #197).

**350 k stop** (owner, 2026-11-14, #178, [comment 6883744259](https://github.com/minakovval/Willowsum/issues/178#issuecomment-6883744259):
«так, погоджуюсь»): from ~350 k tokens of context the lead takes no new tasks and only brings the current PRs to
merge; the new-session limit stays ~400 k (or compaction, or 8–10 merged PRs). Reason: in lead 4 the 400 k limit
fired with 3–4 PRs in work and finishing them took the context to ≈ 480 k. Risks and mitigation: 1–2 PRs fewer per
session and more frequent handovers; the lead starts the next session itself, a start costs ≈ 100–150 k tokens.

**New lead session** (owner, 2026-11-13/14): when the context reaches ~400 k tokens (`get_session` →
`external_metadata.context_usage.used_tokens`), after a compaction or after 8–10 merged PRs, whichever comes first,
the lead writes its state to the GitHub issue «Lead state» (open PRs with heads and verdicts, running work, owner
questions, follow-ups, next plan rows) and starts the new session itself («Automatic restart» below). The new lead reads that issue
first, then the sources above. «Lead state» is also updated during the session, after every 3 merges and whenever
an owner question changes (owner, 2026-11-14), so a lost container loses little.

**Session names** (owner, 2026-11-13; #178): every lead session is named `Willowsum · ведучий N · <з чого починає>`,
e.g. `Willowsum · ведучий 2 · хвиля 2 з рядка 3` (N is one more than the previous lead's number).
- At start, before other work: `get_session` (no `session_id`) gives this session's id and title; rename it with
  `set_session_title` (that id, the name «Lead state» proposes, or one in the format above). Then record the
  starting token usage in #180 ([token economy](token-economy.md), «Token accounting»). Check `get_session` →
  `external_metadata.rate_limit_info`: on a warning, at most 2–3 authors at once (reviews are not cut), and agents
  commit WIP after each step (SKILL.md step 2; owner, 2026-11-14, #178).
- Before finishing: post the session retrospective on #180 and tell it to the owner briefly in chat
  ([token economy](token-economy.md), «Session retrospective»); record the session's usage and its difference in #180; write into «Lead state» the name for
  the next session (`Willowsum · ведучий N+1 · <з чого почати>`); then rename yourself with «(завершено)»
  appended to the current title, e.g. `Willowsum · ведучий 2 · хвиля 2 з рядка 3 (завершено)`.

**Automatic restart** (owner, 2026-11-14, #178, [comment 6880323389](https://github.com/minakovval/Willowsum/issues/178#issuecomment-6880323389):
«так, дозволяю»). When the new-session rule fires, the finishing lead starts the next lead session itself:
1. First, in this order: «Lead state» (#179) current, the snapshot and the retrospective in #180, «(завершено)» in
   its own title.
2. `create_session` with the start message below as `prompt`, the title `Willowsum · ведучий N+1 · <з чого почати>`,
   the same environment (omit `environment_id`: it is inherited) and the same repository (`source_url`).
3. The new session's ID goes into #179 and, briefly, to the owner in chat.
4. **Limit** (the counter and the third-restart steps below are the lead's mechanism: Рішення ведучого (2026-11-14; власник не схвалював; #230)): at most 2 automatic restarts in a row without an answer from the owner; the third only after the
   owner answers. The finishing lead then asks in chat and gives the start message in one code block, so the owner
   can also start it. The start message states the count: «N-й автоматичний перезапуск із 2».
5. Risks and mitigations: a chain of sessions runs without the owner — the handover confirmation is always posted
   on #179 too, and an owner «stop» in PR comments is checked before every merge (SKILL.md step 6); costs grow
   unnoticed — every session posts its snapshot in #180.

**Start message** (owner, 2026-11-14): the whole first message for the new session, also given to the owner in one
code block, ready to copy without edits, whenever the owner starts the session. It names the session (`Willowsum · ведучий N+1 · <з чого почати>`),
tells it to read «Lead state» (#179), the process queue (#178) and token accounting (#180) and to work by
`.claude/skills/pr-pipeline`, lists the start steps (rename, starting usage in #180, item-by-item handover
confirmation with links, on #179 too after an automatic restart), names the first tasks and any owner question
still open, and for an automatic restart states its count («1-й автоматичний перезапуск із 2»). For a session whose
number is a multiple of 3 (9, 12, …) it says that the session starts with the process review («Process review»
below) before new pipeline tasks (owner, 2026-11-15, #178, comment 6892387923). It always includes the line
«Технічних повідомлень у чаті не пиши (pr-pipeline, «Мовчання в чаті»).» (owner, 2026-11-14). The owner should not
have to write or edit anything.

**Process review** (owner, 2026-11-15, #178, comment 6892387923): «кожна третя сесія при запуску має ретроспективно передивитись всі
покращення і зміни в процесах». A lead session whose number is a multiple of 3 — the first is lead 9, lead 8 does
not review — does this after the usual start steps:
1. **Process changes since session 1.** Every accepted improvement — owner and lead decisions in #178,
   `docs/decisions/log/`, AGENTS.md, the skills: is it rational, needed, useful, optimal? Conclusions rest on the data
   in #180 (tokens, time, rounds).
2. **Current instructions.** AGENTS.md, `pr-pipeline` and its `references/`, the other skills, `.claude/references/`:
   contradictions, duplication, outdated or unneeded text, what can be simplified or shortened.
3. **Handovers of the last 5 sessions.** Errors in «Lead state» (#179), start messages and handover confirmations:
   what was lost or inaccurate, what the new session had to rebuild (e.g. session 7: lead 6's file
   `keep/sec241-tests.mjs` was lost with its container).
4. **Result.** A report to the owner as a comment on #180: conclusions and proposals, each with its risks, downsides
   and mitigations. Proposals go to «Черга змін процесу» (#178); the lead changes no rule without an owner decision.
Рішення ведучого (2026-11-15; власник не схвалював; #178): перегляд — до нових задач конвеєра; ціна ≈ 100–150 тис.
токенів контексту, тому сесія перегляду зіллє на 1–2 PR менше.

**Handover confirmation** (owner, 2026-11-13): every handover between lead sessions is confirmed to the owner in
chat in full (after an automatic restart, always also as a comment on #179; owner, 2026-11-14), item by item — the finishing lead for what it hands over, the new lead for what it took over. For
each item: what was done with it and where it is recorded (skill or instruction file, PR or issue, with a link).
An item not acted on is marked «не виконано» with the reason. A shortened summary does not count.

**Owner decisions in documents** (owner, 2026-11-13): every owner decision is recorded in a concrete document (the
decision log, a skill, AGENTS.md, a requirement) and carried into the rules it changes (SKILL.md §2). The lead
never keeps a decision only in session memory: before a handover, check that each decision of the session is in
a file or an open PR, and list where.
