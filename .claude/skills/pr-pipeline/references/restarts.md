# Restarts

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-16

Read when the container restarted, you resume the pipeline, the context was compacted, or a lead session starts or
finishes (a new session: also [new session](new-session.md)).

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
the current PRs to merge (1–2 PRs fewer per segment) and keeps «Lead state» current, so the compaction loses little.

**Lead state** (owner, 2026-11-16, process review 15, proposal 5): one place — the **body** of #179, rewritten in
full each time (`gh api -X PATCH repos/{owner}/{repo}/issues/179 -F body=@<file>`); the state is never posted as a
comment. It holds: open PRs with full heads and verdicts, running agents and their branches, owner questions,
follow-ups, the next plan rows, the next session or segment name, and a link to «Черга змін процесу» (#178).
Rewrite it after every 3 merges, whenever an owner question changes and, from the 350 k stop, before each long
step. Рішення ведучого (2026-11-16; власник не схвалював; #PRNUM): the handover tables stay comments on #179 — they
are the history the owner keeps (2026-11-16: «таблиця потрібна для відстеження історії»), not the state.

**After compaction** (owner, 2026-11-15, #178,
[comment 6897443899](https://github.com/minakovval/Willowsum/issues/178#issuecomment-6897443899)): at ~400 k tokens
the platform compacts the context automatically (`CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000`, set by the owner); the
lead does not stop the session. The `SessionStart` hook (`.claude/settings.json`, matcher `compact`) reminds the
agent; the lead then, in the same session:
1. re-reads «Lead state» (#179), the `pr-pipeline` skill and [lead-communication.md](lead-communication.md)
   («Ukrainian only» and the rest: after a compaction the lead twice wrote to the owner in English; owner,
   2026-11-16, `2026-11-16-owner-sensitive-sync-language-card.md`), then the sources above as needed;
2. becomes lead N+1 (the numbering continues) and renames the session with `set_session_title` to
   `Willowsum · ведучий N+1 · <з чого продовжує>`;
3. posts the retrospective of lead N ([token economy](token-economy.md), «Session retrospective»), adds its
   «Сесії» row to #180 and records the new segment's start («Token accounting» item 1);
4. posts the handover table on #179 («Handover template»; the table stays at every handover, a compaction
   included: owner, 2026-11-16, #178, «ні, таблиця потрібна для відстеження історії»): «Передано» is «Lead state»
   as kept current, «Прийнято» is what lead N+1 re-read and did; the chat gets only the short retrospective;
5. continues the pipeline. A lead number that is a multiple of 3 starts with the «Process review» below.

**Session names** (owner, 2026-11-13, #178): every lead is `Willowsum · ведучий N · <з чого починає>`, e.g.
`Willowsum · ведучий 2 · хвиля 2 з рядка 3`; N is one more than the previous lead's, whether it ended in a
compaction or a session. At start, before other work: `get_session` (no `session_id`) gives the id and title;
rename with `set_session_title` (the name «Lead state» proposes, or this format); record the starting snapshot
([token economy](token-economy.md), «Token accounting» item 1). Check `get_session` →
`external_metadata.rate_limit_info`: on a warning, at most 2–3 authors at once (reviews are not cut), and agents
commit WIP after each step (SKILL.md step 2; owner, 2026-11-14, #178). **After a limit cut-off** (owner,
2026-11-15, #178): `send_later` at `rate_limit_info.resetsAt` + 5 minutes to resume; delete that scheduled task
(`delete_trigger`) after the wake-up.

**Process review** (owner, 2026-11-15, #178): «кожна третя сесія при запуску має ретроспективно передивитись всі
покращення і зміни в процесах». A lead whose number is a multiple of 3 (from lead 9; after a compaction, the new
number) does it after the start steps, before new tasks (≈ 100–150 k tokens, 1–2 PRs fewer), and reviews:
1. every accepted process change since session 1 (#178, `docs/decisions/log/`, AGENTS.md, the skills) — rational,
   needed, useful, optimal? — on the data of #180 (tokens, time, rounds);
2. the current instructions (AGENTS.md, `pr-pipeline` and `references/`, the other skills, `.claude/references/`):
   contradictions, duplication, outdated or unneeded text, what to simplify or shorten;
3. the handovers of the last 5 leads: what «Lead state», start messages and confirmations lost or got wrong.
Result: a comment on #180 with conclusions and proposals (each with risks, downsides, mitigations); the proposals go
to «Черга змін процесу» (#178); no rule changes without an owner decision.

**Handover confirmation** (owner, 2026-11-13/14/15/16, #178,
[comment 6899108018](https://github.com/minakovval/Willowsum/issues/178#issuecomment-6899108018)): every handover
between leads, a compaction included, is confirmed item by item as a comment on #179 with **only** the table below
— the 10 fixed items in this order, no other rows or free text (owner, 2026-11-16, process review 15, proposal 5).
The finishing lead fills «Передано», the new lead «Прийнято»: what was done and where, with a link; not acted on →
«не виконано» and why; a summary does not count. At a new session the confirmation also goes to the owner in chat
in full; at a compaction the chat gets only the short retrospective (SKILL.md «Мовчання в чаті» (d)). Item 4 lists
the segment's decisions and each retrospective proposal with its link in #178 (or «не внесено до #178» and why).
An item that is not a whole row's state (a plan row, a follow-up, an owner question) carries «перенесено N разів»:
one more than in the previous table. An item carried **≥ 3 handovers** goes to the owner with options (owner,
2026-11-16, #178): do it in the next 2 plan rows / move it to `docs/plans/owner-questions-later.md` / close it —
in the next batch of owner questions; it is not carried further until the owner answers. Before the handover,
every file in the scratchpad `keep/` goes to a branch or an issue (item 7). Test database names are not handed
over: they do not survive a new container.
```markdown
| № | Пункт | Передано (хто завершує: що, де, посилання) | Прийнято (новий ведучий: що зроблено, де) | Перенесено N разів |
| --- | --- | --- | --- | --- |
| 1 | Відкриті PR: номер, повний head SHA, вердикти, наступний крок | | | |
| 2 | Агенти й незавершена робота: гілка, WIP-коміт запушено | | | |
| 3 | Питання власнику (посилання) | | | |
| 4 | Рішення сесії (власника й ведучого: файл або відкритий PR); пропозиції ретро — кожна з посиланням на #178 | | | |
| 5 | Follow-ups: issues і списки злитих PR | | | |
| 6 | Наступні рядки плану | | | |
| 7 | Файли з `keep/`: гілка або issue | | | |
| 8 | Ліміт (`rate_limit_info`) і лічильник перезапусків | | | |
| 9 | #180: знімок, рядки PR, рядок «Сесії», ретроспектива | | | |
| 10 | Назва наступної сесії або сегмента | | | |
```

**Owner decisions in documents** (owner, 2026-11-13): each is recorded in a document (decision log, skill, AGENTS.md,
requirement) and carried into the rules it changes (SKILL.md §2), never only in memory; check it before a handover.
