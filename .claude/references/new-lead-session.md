# New lead session

**Створено:** 2026-11-16 · **Оновлено:** 2026-11-16

Read when a lead session must end and a new one start (a compaction: [restarts](../skills/pr-pipeline/references/restarts.md)). Moved from
`restarts.md` unchanged (process review 15, proposal 5), then out of the skill to keep it within its size limit.

**When**: only when the container is lost or the compaction did not happen by ~450 k
tokens (`get_session` → `external_metadata.context_usage.used_tokens`). The finishing lead (if it still can) starts
no new tasks, lets the in-flight agents finish, then:
1. the retrospective ([token economy](../skills/pr-pipeline/references/token-economy.md), «Session retrospective») and the segment's «Сесії» row in
   #180 («Token accounting» item 1);
2. «Lead state» (#179) rewritten, with the name for the next session `Willowsum · ведучий N+1 · <з чого почати>`;
   every file in the scratchpad `keep/` goes to a branch or an issue first; test database names are not handed
   over: they do not survive a new container;
3. «(завершено)» appended to its own title, e.g. `Willowsum · ведучий 2 · хвиля 2 з рядка 3 (завершено)`;
4. starts the next session itself («Automatic restart»). The new lead reads #179 first, then the recovery sources
   in [restarts](../skills/pr-pipeline/references/restarts.md).

**Automatic restart**: `create_session` with the start message below as `prompt`, the
title `Willowsum · ведучий N+1 · <з чого почати>`, the same environment (omit `environment_id`: it is inherited)
and the same repository (`source_url`). The new session's ID goes into #179 and, briefly, to the owner in chat.
**Limit**: at most 2 automatic restarts in a row without an answer from the
owner; the third only after the owner answers — the finishing lead asks in chat and gives the start message in one
code block, so the owner can start it. Risks and mitigations: a chain of sessions runs without the owner — the
«Lead state» is always in the #179 body and an owner «stop» is checked before every merge (`pr-pipeline` step 6); costs
grow unnoticed — every segment adds its «Сесії» row in #180.

**Start message**: the whole first message for the new session, also given to the
owner in one code block, ready to copy without edits whenever the owner starts the session. It names the session
(`Willowsum · ведучий N+1 · <з чого почати>`); tells it to read «Lead state» (#179), the process queue (#178) and
token accounting (#180) and to work by `.claude/skills/pr-pipeline`; lists the start steps (rename, starting
snapshot saved to a file); names the
first tasks and any open owner question; for an automatic restart states its count («1-й автоматичний перезапуск
із 2»); tells it to check whether a process review is due ([restarts](../skills/pr-pipeline/references/restarts.md)); and always
includes «Технічних повідомлень у чаті не пиши (pr-pipeline, «Мовчання в чаті»).» The owner edits nothing.
