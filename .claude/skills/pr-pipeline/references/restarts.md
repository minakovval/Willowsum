# Restarts

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-13

Moved out of `pr-pipeline` SKILL.md without change (owner, 2026-11-13). Read when the container restarted or you resume the pipeline.

The container can restart and agents' context is lost. Recover state from durable sources, not memory:
- open PRs and their heads: `gh api 'repos/{owner}/{repo}/pulls?state=open&per_page=100' --jq '.[] | [.number, .head.ref, .head.sha] | @tsv'` (GraphQL, so `gh pr list`, is blocked in cloud sessions);
- the latest reviews per PR (`gh api repos/{owner}/{repo}/pulls/<n>/reviews`), their verdicts and SHAs;
- CI status of each head; finished agents' output files in the session scratchpad;
- worktrees (`git worktree list`) and test databases (`pnpm db:test list`).
Then continue from the first step that is not done; re-subscribe to open PRs.

**New lead session** (owner, 2026-11-13): after a compaction or 8–10 merged PRs the lead writes its state to the
GitHub issue «Lead state» (open PRs with heads and verdicts, running work, owner questions, follow-ups, next plan
rows) and tells the owner to start a new session. The new lead reads that issue first, then the sources above.
