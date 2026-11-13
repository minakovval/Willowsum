# Token economy (model choice and briefs)

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-13

Moved out of `pr-pipeline` SKILL.md (owner, 2026-11-13); token accounting added (owner, 2026-11-13, #180). Read when you choose a model for an agent or write a brief, after every merge, and when a lead session starts or finishes.

Owner request 2026-11-12; rules decided by the lead.

1. Pick the agent's model by risk:
   - the strongest model for implementing sensitive features and for security reviews of critical modules
     (isolation, money, auth, encryption);
   - reviews (owner, 2026-11-13): a `review-pr` of a PR that changes **only docs and requirement text** may use
     a lighter, cheaper model (the Agent tool's model option). Docs-only means every changed file is one that
     `isDocsOnly` in `tools/pr-rules/lib/ci-paths.mjs` accepts (the job `changes` skips all heavy jobs: `docs/`,
     `design/`, `.claude/`, root `*.md`, the PR template) and none is a test or code. Every review of a PR
     that changes code, tools or workflows, and every confirmation round of such a PR (round 2, merge-only
     confirmations), stays on the main model. A PR that changes only `.claude/` or AGENTS.md but touches a
     security rule (hard rules, review or security-review procedure, approvals, secrets, sensitive paths) also
     stays on the main model (lead, follow-up of #166);
   - a lighter model for applying ready reviewer patches (`fix-review-findings`), follow-up PRs and status
     checks.
2. Every review, first or repeat, goes to a fresh agent with a narrow brief (owner, 2026-11-13): for round 2
   the diff since the last head plus the previous findings. A long-context reviewer is never resumed.
3. Reviewers rely on green CI for the full suites. Locally they run only the tests touching the changed code,
   plus integration tests for database changes; no repeated full-suite runs.
4. Briefs point agents at exact files and sections instead of «read everything».
5. Agents return short final reports (verdict, blocking with file:line, follow-ups, checks), not narratives.
6. Keep PRs small (AGENTS.md step 5, owner rule 7) so diffs, and therefore reviews, stay small.

## Token accounting

Mandatory (owner, 2026-11-13; issue «Облік токенів», #180). The lead keeps the tables in the body of #180: read
the current body right before each edit and change only the table it adds a row to (`gh api -X PATCH
repos/{owner}/{repo}/issues/180 -f body=@<file>`; a PATCH is idempotent). Keep a running tally in the session
scratchpad (`tokens.tsv`: PR, role, `subagent_tokens`) so a compaction does not lose it.

1. **Session.** At start and before finishing, call `get_session` (no `session_id`) and read `usage`:
   `cache_read_tokens`, `output_tokens`, `cost_usd`. At start, add the session's row to the table «Сесії» with
   the start snapshot in «Примітка»; before finishing, fill in the difference (end minus start) and the period.
   The difference covers the lead and all its agents.
2. **PR.** In the same turn as the merge (owner, 2026-11-13; not as a later step), add a row to the table «PR»: PR, type (код / UI / вимоги /
   процес / виправлення), review rounds, agents' tokens = the sum of `subagent_tokens` from the completion
   notices of the author, every reviewer and every confirmation agent of that PR (follow-up and fix agents of
   the same PR included).
3. **Weekly.** Once a week (the first session after 7 days since the last analysis) add a short «Аналіз» note
   to #180: which PR types cost most (sum and per PR), and the lead's own share (the session differences minus
   the sum of agents' tokens). A change of process it suggests goes to the queue «Черга змін процесу» (#178).
