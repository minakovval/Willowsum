# Restarts

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-16

Read when the container restarted, you resume the pipeline, the context was compacted, or a lead session starts or
finishes.

The container can restart and agents' context is lost. Recover state from durable sources, not memory:
- open PRs and their heads: `gh api 'repos/{owner}/{repo}/pulls?state=open&per_page=100' --jq '.[] | [.number, .head.ref, .head.sha] | @tsv'` (GraphQL, so `gh pr list`, is blocked in cloud sessions);
- the latest reviews per PR (`gh api repos/{owner}/{repo}/pulls/<n>/reviews`), their verdicts and SHAs;
- CI status of each head; finished agents' output files in the session scratchpad;
- worktrees (`git worktree list`) and test databases (`pnpm db:test list`); the PostgreSQL cluster
  (`pg_lsclusters`; down → `pg_ctlcluster 16 main start`: the setup script does not run when a container restarts).
Then continue from the first step that is not done; re-subscribe only to open PRs that wait for merge (no agent on
them, SKILL.md step 3). An agent cut off by a limit or a restart: save its uncommitted work at once with a WIP
commit on its branch (in its worktree: `git add -A && git commit -m "WIP: <task> (agent cut off)"`, then push),
and brief the next agent from it (owner, 2026-11-14, #178, #197).

**350 k stop** (owner, 2026-11-14, #178): from ~350 k tokens of context the lead takes no new tasks and only brings
the current PRs to merge. Risks and mitigation: 1–2 PRs fewer per segment; keep «Lead state» (#179) current from
here on, so the compaction at ~400 k («After compaction») loses little.

**After compaction** (owner, 2026-11-15, #178,
[comment 6897443899](https://github.com/minakovval/Willowsum/issues/178#issuecomment-6897443899)): at ~400 k tokens of
context the platform compacts the context automatically (`CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000` on the environment,
set by the owner in Settings); the lead does not stop the session. «Lead state» (#179, with a link to «Черга змін
процесу»: open PRs with heads and verdicts, running work, owner questions, follow-ups, next plan rows) is updated
after every 3 merges, whenever an owner question changes and, from the 350 k stop, before each long step, so the
compaction loses little. After it the `SessionStart` hook (`.claude/settings.json`, matcher `compact`) reminds the
agent; the lead then, in the same session:
1. re-reads «Lead state» (#179) and the `pr-pipeline` skill, then the sources above as needed;
2. becomes lead N+1 — the numbering continues, it does not restart — and renames the session with
   `set_session_title` to `Willowsum · ведучий N+1 · <з чого продовжує>`;
3. posts the retrospective of the finished segment (lead N; [token economy](token-economy.md), «Session
   retrospective») and adds its «Сесії» row to #180, then records the new segment's start in #180 («Token
   accounting» item 1);
4. posts the handover table on #179 («Handover template» below; owner, 2026-11-16, #178: «ні, таблиця потрібна для
   відстеження історії» — the table stays at every handover, a compaction included): «Передано» is «Lead state»
   as kept current, «Прийнято» is what lead N+1 re-read and did; the chat gets only the short retrospective (step 3);
5. continues the pipeline. A lead number that is a multiple of 3 starts with the process review («Process review»
   below), whether it began after a compaction or in a new session.

**New lead session** (owner, 2026-11-15, #178): only when the container is lost or the compaction did not happen
by ~450 k tokens (`get_session` → `external_metadata.context_usage.used_tokens`). The finishing lead (if it still
can) starts no new tasks, lets the in-flight agents finish, posts the retrospective, writes «Lead state» with the
name for the next session and starts it itself («Automatic restart» below). The new lead reads that issue first, then the
sources above.

**Session names** (owner, 2026-11-13, #178): every lead session is named `Willowsum · ведучий N · <з чого починає>`,
e.g. `Willowsum · ведучий 2 · хвиля 2 з рядка 3` (N is one more than the previous lead's number, whether that
lead ended in a compaction or a session).
- At start, before other work: `get_session` (no `session_id`) gives this session's id and title; rename it with
  `set_session_title` (that id, the name «Lead state» proposes, or one in the format above). Then record the
  starting token usage in #180 ([token economy](token-economy.md), «Token accounting» item 1). Check `get_session` →
  `external_metadata.rate_limit_info`: on a warning, at most 2–3 authors at once (reviews are not cut), and agents
  commit WIP after each step (SKILL.md step 2; owner, 2026-11-14, #178).
- **After a limit cut-off** (owner, 2026-11-15, #178): schedule `send_later` at `rate_limit_info.resetsAt` +
  5 minutes to resume, and delete that scheduled task (`delete_trigger`) after the wake-up.
- Before finishing a session (not at a compaction): the retrospective (above); record the segment's usage and its
  difference in #180; write into «Lead state» the name for the next session (`Willowsum · ведучий N+1 · <з чого
  почати>`); then rename yourself with «(завершено)» appended to the current title, e.g.
  `Willowsum · ведучий 2 · хвиля 2 з рядка 3 (завершено)`.

**Automatic restart** (owner, 2026-11-14, #178). When the new-session rule fires, the finishing lead starts the
next lead session itself:
1. First, in this order: «Lead state» (#179) current, the snapshot and the retrospective in #180, «(завершено)» in
   its own title.
2. `create_session` with the start message below as `prompt`, the title `Willowsum · ведучий N+1 · <з чого почати>`,
   the same environment (omit `environment_id`: it is inherited) and the same repository (`source_url`).
3. The new session's ID goes into #179 and, briefly, to the owner in chat.
4. **Limit** (owner, 2026-11-14; the counter and the third-restart steps: owner, 2026-11-15, #178, #230): at most
   2 automatic restarts in a row without an answer from the owner; the third only after the owner answers. The
   finishing lead then asks in chat and gives the start message in one code block, so the owner can also start
   it. The start message states the count: «N-й автоматичний перезапуск із 2».
5. Risks and mitigations: a chain of sessions runs without the owner — the handover confirmation is always posted
   on #179 too, and an owner «stop» in PR comments is checked before every merge (SKILL.md step 6); costs grow
   unnoticed — every session posts its snapshot in #180.

**Start message** (owner, 2026-11-14): the whole first message for the new session, also given to the owner in one
code block, ready to copy without edits, whenever the owner starts the session. It names the session
(`Willowsum · ведучий N+1 · <з чого почати>`), tells it to read «Lead state» (#179), the process queue (#178) and
token accounting (#180) and to work by `.claude/skills/pr-pipeline`, lists the start steps (rename, starting usage
in #180, item-by-item handover confirmation with links, on #179 too after an automatic restart), names the first
tasks and any owner question still open, and for an automatic restart states its count («1-й автоматичний
перезапуск із 2»). For a session whose number is a multiple of 3 (9, 12, …) it says that the session starts with
the process review («Process review» below) before new pipeline tasks (owner, 2026-11-15, #178). It always includes
the line «Технічних повідомлень у чаті не пиши (pr-pipeline, «Мовчання в чаті»).» The owner should not have to
write or edit anything.

**Process review** (owner, 2026-11-15, #178): «кожна третя сесія при запуску має ретроспективно передивитись всі
покращення і зміни в процесах». A lead whose number is a multiple of 3 — the first is lead 9, lead 8 does not
review; after a compaction it is the new number in the same session — does this after the usual start steps and
before new pipeline tasks; it costs ≈ 100–150 k tokens of context, so the review segment merges 1–2 PRs fewer:
1. **Process changes since session 1.** Every accepted improvement — owner and lead decisions in #178,
   `docs/decisions/log/`, AGENTS.md, the skills: is it rational, needed, useful, optimal? Conclusions rest on the data
   in #180 (tokens, time, rounds).
2. **Current instructions.** AGENTS.md, `pr-pipeline` and its `references/`, the other skills, `.claude/references/`:
   contradictions, duplication, outdated or unneeded text, what can be simplified or shortened.
3. **Handovers of the last 5 leads.** Errors in «Lead state» (#179), start messages and handover confirmations:
   what was lost or inaccurate, what the new session had to rebuild.
4. **Result.** A report to the owner as a comment on #180: conclusions and proposals, each with its risks, downsides
   and mitigations. Proposals go to «Черга змін процесу» (#178); the lead changes no rule without an owner decision.

**Handover confirmation** (owner, 2026-11-13/14): every handover between lead sessions is confirmed item by item — the
finishing lead for what it hands over, the new lead for what it took over — always as the table on #179
(«Handover template» below). At a new session the confirmation is also given to the owner in chat in full; at a
compaction the chat gets only the short retrospective and the table stays on #179 (SKILL.md «Мовчання в чаті» (d);
owner, 2026-11-16, #178). For each item: what was done with it and where it is recorded (skill or instruction
file, PR or issue, with a link). An item not acted on is marked «не виконано» with the reason. In the places where
the confirmation is required in full, a shortened summary does not count.

**Handover template** (owner, 2026-11-15, #178,
[comment 6899108018](https://github.com/minakovval/Willowsum/issues/178#issuecomment-6899108018)): the confirmation
is always the table below on #179 — at every handover — with the fixed items in this order; the finishing lead fills
«Передано», the new lead fills «Прийнято». Рішення ведучого (2026-11-15; власник не схвалював; #287): the table is
kept at a compaction too (lead N → N+1 in one session), its «Передано» being «Lead state» kept current from the
350 k stop; because a compaction changes the lead number like any handover. An item that is not a whole row's state (a plan row, a follow-up, an owner question) carries
«перенесено N разів»: the number of handovers it has passed without being done, one more than in the previous table.
An item carried over **≥ 3 handovers** goes to the owner with options (owner, 2026-11-16, #178): do it in the next 2
plan rows / move it to `docs/plans/owner-questions-later.md` / close it; the lead puts the question into the next
batch of owner questions and does not carry the item further until the owner answers.
Before the handover, every file in the scratchpad `keep/` goes to a branch or an issue (linked in item 7); nothing is
handed over in the scratchpad alone. Test database names are not handed over: they do not survive a new container.
```markdown
| № | Пункт | Передано (хто завершує: що, де, посилання) | Прийнято (новий ведучий: що зроблено, де) | Перенесено N разів |
| --- | --- | --- | --- | --- |
| 1 | Відкриті PR: номер, повний head SHA, вердикти, наступний крок | | | |
| 2 | Агенти й незавершена робота: гілка, WIP-коміт запушено | | | |
| 3 | Питання власнику (посилання) | | | |
| 4 | Рішення сесії: власника й ведучого — де записано (файл або відкритий PR) | | | |
| 5 | Follow-ups: issues і списки злитих PR | | | |
| 6 | Наступні рядки плану | | | |
| 7 | Файли з `keep/`: гілка або issue | | | |
| 8 | Ліміт (`rate_limit_info`) і лічильник перезапусків | | | |
| 9 | #180: знімок, рядки PR, рядок «Сесії», ретроспектива | | | |
| 10 | Назва наступної сесії або сегмента | | | |
```

**Owner decisions in documents** (owner, 2026-11-13): every owner decision is recorded in a concrete document (the
decision log, a skill, AGENTS.md, a requirement) and carried into the rules it changes (SKILL.md §2). The lead
never keeps a decision only in session memory: before a handover, check that each decision of the session is in
a file or an open PR, and list where.
