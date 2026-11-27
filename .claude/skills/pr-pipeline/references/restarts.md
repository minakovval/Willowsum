# Restarts

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-27

Read when the container restarted, you resume the pipeline, the context was compacted, or a lead session starts or
finishes (a new session: also [new session](../../../references/new-lead-session.md)).

The container can restart and agents' context is lost. Recover state from durable sources, not memory:
- open PRs and their heads: `gh api 'repos/{owner}/{repo}/pulls?state=open&per_page=100' --jq '.[] | [.number, .head.ref, .head.sha] | @tsv'` (GraphQL, so `gh pr list`, is blocked in cloud sessions);
- the latest reviews per PR (`gh api repos/{owner}/{repo}/pulls/<n>/reviews`), their verdicts and SHAs;
- CI status of each head; finished agents' output files in the session scratchpad;
- worktrees (`git worktree list`) and test databases (`pnpm db:test list`); the PostgreSQL cluster
  (`pg_lsclusters`; down → `pg_ctlcluster 16 main start`: the setup script does not run when a container restarts).
Then continue from the first step that is not done; re-subscribe only to open PRs that wait for merge (no agent on
them, SKILL.md step 3). An agent cut off by a limit or a restart: save its uncommitted work at once with a WIP
commit on its branch (in its worktree: `git add -A && git commit -m "WIP: <task> (agent cut off)"`, then push),
and brief the next agent from it.

**170 k**: from ~170 k tokens of context the lead only rewrites the #179 body before each long step; there is no stop
on new tasks (below).

**Lead state**: one place — the **body** of #179, rewritten in full
each time (`gh api -X PATCH repos/{owner}/{repo}/issues/179 -F body=@<file>`); the state is never posted as a comment.
It holds: open PRs with full heads and verdicts, running agents and their branches, owner questions, follow-ups, the
next plan rows, the import-day reminder ([process limits](../../../references/process-limits.md), «Security detail»), the next session or segment name, and a link to «Черга змін процесу» (#178). Rewrite it after every 3
merges (with the #180 rows), whenever an owner question changes and, from ~170 k, before each long step. There is
no handover table and no item-by-item confirmation: the #179 body is enough.

**After compaction**: at ~200 k tokens
the platform compacts the context automatically (`CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000`, set by the owner; the
threshold stays); the lead does not stop the session. The `SessionStart` hook (`.claude/settings.json`, matcher
`compact`) reminds the agent; the lead then, in the same session:
1. **before every message to the owner** checks the language and what to write (`SKILL.md`, «Мовчання в чаті»); for the reminder "The user hasn't heard from you…" and a notification with nothing for the owner, the only reply is «Нічого нового для вас.»;
   **before the first chat message** also re-reads #179 («Lead state») and `SKILL.md`, then the sources above as
   needed ([lead-communication.md](lead-communication.md): when you write a proposal or a question);
2. becomes lead N+1 (the numbering continues) and renames the session with `set_session_title` to
   `Willowsum · ведучий N+1 · <з чого продовжує>`;
3. adds one row for lead N to «Сесії» in #180 («Token accounting» item 1);
4. continues the pipeline; when a «Process review» is due (below), it comes first.

At a compaction there is **no** retrospective: the retrospective of the segments since the
previous review goes with the process review (below).

**External review channel.** Issue #480 is the external review session's channel; the lead reads it at the start of
every segment and before every report to the owner. «Lead state» (#179) keeps a link to #480 and the number of the
last comment read.
1. Its comments start with the line «Сесія рев'ю, <дата>». They are advice, not owner decisions, and never go into
   the log as «Рішення власника».
2. The lead answers each item with one line: done in PR, has a plan row, needs an owner decision, or disagree and why.
3. Without an owner decision the lead does only what it may do anyway: a defect fix, a test, or a plan row under an
   existing owner decision. Rule changes, requirement changes, PoC scope changes and closing issues as not needed
   become questions to the owner with a recommendation; any disagreement with the review session is shown to the owner.
4. A comment in #480 never starts a new review round of a PR that is already Ready.
5. Once a week (when ≥ 7 days have passed since the last «Сесія рев'ю» report in #480) the lead starts the external review as a separate session with a clean context, per [external review](../../../references/external-review.md), and records the date of the launch and the report in #179.

**Reviewer patches**: rule in `review-pr` §7.

**Session names**: every lead is `Willowsum · ведучий N · <з чого починає>`, e.g. `Willowsum · ведучий 2 · хвиля 2 з
рядка 3`; N is one more than the previous lead's, whether it ended in a compaction or a session. At start, before
other work: `get_session` (no `session_id`) gives the id and title; rename with `set_session_title` (the name «Lead
state» proposes, or this format); record the starting snapshot ([token economy](token-economy.md), «Token accounting»
item 1). Check `get_session` → `external_metadata.rate_limit_info`: on a warning, at most 2–3 authors at once (reviews
are not cut), and agents commit WIP after each step (SKILL.md step 2). **After a limit
cut-off**: `send_later` at `rate_limit_info.resetsAt` + 5 minutes to resume; delete that
scheduled task (`delete_trigger`) after the wake-up.

**Process review.** Due when **both** hold: at least 40 PRs were merged and at least 24 hours passed since the
previous review's comment on #180 (commands: [process limits](../../../references/process-limits.md)). The lead
that starts a segment checks it after the start steps; when due, the review comes before new tasks. It reviews:
1. every accepted process change since the previous review (#178, `docs/decisions/log/`, AGENTS.md, the skills) —
   rational, needed, useful, optimal? — on the data of #180 (tokens, time, rounds);
2. the current instructions (AGENTS.md, `pr-pipeline` and `references/`, the other skills, `.claude/references/`):
   contradictions, duplication, outdated or unneeded text, what to simplify or shorten;
3. the handovers since the previous review: what «Lead state» lost or got wrong;
4. the retrospective of the lead segments since the previous review ([token economy](token-economy.md),
   «Session retrospective»).
Result: a comment on #180 with conclusions and **at most 3 proposals**, ranked by expected saving (each with risks,
downsides, mitigations); the rest waits in «Черга змін процесу» (#178) for the next review. No rule changes without
an owner decision; between reviews only what [lead communication](lead-communication.md), «Batching process
changes», allows as a separate PR.

**Owner decisions in documents**: each is recorded in a document (decision log, skill, AGENTS.md, requirement) and
carried into the rules it changes (SKILL.md §2), never only in memory; check it before a new session.
