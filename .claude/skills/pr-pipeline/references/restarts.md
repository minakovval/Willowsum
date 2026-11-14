# Restarts

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-14

Moved out of `pr-pipeline` SKILL.md (owner, 2026-11-13); session names, handover confirmation and owner decisions in documents added (owner, 2026-11-13, #178); context limit, «Lead state» cadence and PostgreSQL check added (owner, 2026-11-14, #178); rate limit at start, WIP commits and the session retrospective added (owner, 2026-11-14, #178). Read when the container restarted, you resume the pipeline, or a lead session starts or finishes.

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

**New lead session** (owner, 2026-11-13/14): when the context reaches ~400 k tokens (`get_session` →
`external_metadata.context_usage.used_tokens`), after a compaction or after 8–10 merged PRs, whichever comes first,
the lead writes its state to the GitHub issue «Lead state» (open PRs with heads and verdicts, running work, owner
questions, follow-ups, next plan rows) and tells the owner to start a new session. The new lead reads that issue
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

**Start message** (owner, 2026-11-14): when the lead proposes a new session, it gives the owner the whole first message
for it in one code block, ready to copy without edits. It names the session (`Willowsum · ведучий N+1 · <з чого почати>`),
tells it to read «Lead state» (#179), the process queue (#178) and token accounting (#180) and to work by
`.claude/skills/pr-pipeline`, lists the start steps (rename, starting usage in #180, item-by-item handover
confirmation with links), and names the first tasks and any owner question still open. It always includes the line
«Технічних повідомлень у чаті не пиши (pr-pipeline, «Мовчання в чаті»).» (owner, 2026-11-14). The owner should not
have to write or edit anything.

**Handover confirmation** (owner, 2026-11-13): every handover between lead sessions is confirmed to the owner in
chat in full, item by item — the finishing lead for what it hands over, the new lead for what it took over. For
each item: what was done with it and where it is recorded (skill or instruction file, PR or issue, with a link).
An item not acted on is marked «не виконано» with the reason. A shortened summary does not count.

**Owner decisions in documents** (owner, 2026-11-13): every owner decision is recorded in a concrete document (the
decision log, a skill, AGENTS.md, a requirement) and carried into the rules it changes (SKILL.md §2). The lead
never keeps a decision only in session memory: before a handover, check that each decision of the session is in
a file or an open PR, and list where.
