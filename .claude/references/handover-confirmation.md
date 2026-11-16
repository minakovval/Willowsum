# Handover confirmation

**Створено:** 2026-11-16

Read when leads hand over, a compaction included. Moved from `pr-pipeline/references/restarts.md` to keep the
skill within its size limit; since then only the `keep/` exception for security detail was added.

**Handover confirmation** (owner, 2026-11-13/14/15/16, #178,
[comment 6899108018](https://github.com/minakovval/Willowsum/issues/178#issuecomment-6899108018)): every handover
between leads, a compaction included, is confirmed item by item as a comment on #179 with **only** the table below
— the 10 fixed items in this order, no other rows or free text (owner, 2026-11-16, process review 15, proposal 5).
The finishing lead fills «Передано», the new lead «Прийнято»: what was done and where, with a link; not acted on →
«не виконано» and why; a summary does not count. At a new session the confirmation also goes to the owner in chat
in full; at a compaction the chat gets only the short retrospective (`pr-pipeline` «Мовчання в чаті» (d)). Item 4 lists
the segment's decisions and each retrospective proposal with its link in #178 (or «не внесено до #178» and why).
An item that is not a whole row's state (a plan row, a follow-up, an owner question) carries «перенесено N разів»:
one more than in the previous table. An item carried **≥ 3 handovers** goes to the owner with options (owner,
2026-11-16, #178): do it in the next 2 plan rows / move it to `docs/plans/owner-questions-later.md` / close it —
in the next batch of owner questions; it is not carried further until the owner answers. Before the handover,
every file in the scratchpad `keep/` goes to a branch or an issue (item 7); from MVP (owner, 2026-11-16,
`docs/decisions/log/2026-11-16-rule4-security-detail-from-mvp.md`; until then no exception) except the detail of a
security finding not yet fixed in `main`: it goes to its draft security advisory, or, if that failed, item 7 names it as «лише в
`keep/`, власнику повідомлено» ([process limits](process-limits.md)). Test database names are not handed
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
| 7 | Файли з `keep/`: гілка або issue (подробиці вади безпеки — advisory, з MVP) | | | |
| 8 | Ліміт (`rate_limit_info`) і лічильник перезапусків | | | |
| 9 | #180: знімок, рядки PR, рядок «Сесії», ретроспектива | | | |
| 10 | Назва наступної сесії або сегмента | | | |
```
