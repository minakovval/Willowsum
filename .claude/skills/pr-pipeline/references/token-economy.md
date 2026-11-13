# Token economy (model choice and briefs)

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-13

Moved out of `pr-pipeline` SKILL.md without change (owner, 2026-11-13). Read when you choose a model for an agent or write a brief.

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
