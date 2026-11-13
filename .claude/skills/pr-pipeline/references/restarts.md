# Restarts

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-13

Moved out of `pr-pipeline` SKILL.md (owner, 2026-11-13); session names added (owner, 2026-11-13, #178). Read when the container restarted, you resume the pipeline, or a lead session starts or finishes.

The container can restart and agents' context is lost. Recover state from durable sources, not memory:
- open PRs and their heads: `gh api 'repos/{owner}/{repo}/pulls?state=open&per_page=100' --jq '.[] | [.number, .head.ref, .head.sha] | @tsv'` (GraphQL, so `gh pr list`, is blocked in cloud sessions);
- the latest reviews per PR (`gh api repos/{owner}/{repo}/pulls/<n>/reviews`), their verdicts and SHAs;
- CI status of each head; finished agents' output files in the session scratchpad;
- worktrees (`git worktree list`) and test databases (`pnpm db:test list`).
Then continue from the first step that is not done; re-subscribe to open PRs.

**New lead session** (owner, 2026-11-13): after a compaction or 8–10 merged PRs the lead writes its state to the
GitHub issue «Lead state» (open PRs with heads and verdicts, running work, owner questions, follow-ups, next plan
rows) and tells the owner to start a new session. The new lead reads that issue first, then the sources above.

**Session names** (owner, 2026-11-13; #178): every lead session is named `Willowsum · ведучий N · <з чого починає>`,
e.g. `Willowsum · ведучий 2 · хвиля 2 з рядка 3` (N is one more than the previous lead's number).
- At start, before other work: `get_session` (no `session_id`) gives this session's id and title; rename it with
  `set_session_title` (that id, the name «Lead state» proposes, or one in the format above). Then record the
  starting token usage in #180 ([token economy](token-economy.md), «Token accounting»).
- Before finishing: record the session's usage and its difference in #180; write into «Lead state» the name for
  the next session (`Willowsum · ведучий N+1 · <з чого почати>`); then rename yourself with «(завершено)»
  appended to the current title, e.g. `Willowsum · ведучий 2 · хвиля 2 з рядка 3 (завершено)`.
