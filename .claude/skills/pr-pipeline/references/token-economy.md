# Token economy (model choice and briefs)

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-14

Moved out of `pr-pipeline` SKILL.md (owner, 2026-11-13); token accounting and agent resume limit added (owner, 2026-11-13, #178, #180); real agent spend, time accounting, the script `tools/token-report` and the fix model rule added (owner, 2026-11-14, #178). Read when you choose a model for an agent or write a brief, after every merge, and when a lead session starts or finishes.

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
     checks. A fix from ready patches goes to a fresh agent on the lighter model; if it must deviate from a
     patch, it stops and reports to the lead, and the fix moves to the strong model (owner, 2026-11-14, #178; in
     #191 the reviewer's patch deadlocked).
2. Every review, first or repeat, goes to a fresh agent with a narrow brief (owner, 2026-11-13): for round 2
   the diff since the last head plus the previous findings. A long-context reviewer is never resumed.
3. Reviewers rely on green CI for the full suites. Locally they run only the tests touching the changed code,
   plus integration tests for database changes; no repeated full-suite runs.
4. Briefs point agents at exact files and sections instead of «read everything».
5. Agents return short final reports (verdict, blocking with file:line, follow-ups, checks), not narratives.
6. Keep PRs small (AGENTS.md step 5, owner rule 7) so diffs, and therefore reviews, stay small. Split large
   scope moves and migrations into parts: one agent, one part (owner, 2026-11-13, #178).
7. Resume an implementing agent at most 2 times (owner, 2026-11-13, #178). A third round of fixes goes to a
   fresh agent with a short brief: the diff, the findings, the patch. Every resume re-reads the agent's whole
   context: in lead session 1 the most expensive tasks were authors resumed many times (110, 70, 68 and 61
   million input tokens; #180, retrospective).
8. **Workflow experiment** (owner, 2026-11-14, #178): once, a Workflow «супровідник» takes one PR without
   `sensitive` from implementation to ready-to-merge, only after the owner's separate consent in chat for that
   exact run; compare its tokens and time with the #180 rows of similar PRs before deciding on more.
9. Not adopted (owner, 2026-11-14: «ок, тоді діємо як радиш. 6 не робимо»): (3) the lead confirming code-PR
   syncs itself, and (6) a cap on the number of parallel code PRs.

## Token accounting

Mandatory (owner, 2026-11-13/14; issue «Облік токенів», #180). The lead keeps the tables in the body of #180: read
the current body right before each edit (`gh api repos/{owner}/{repo}/issues/180 --jq .body > <file>`), append
the new row to the end of its table in that file, keeping everything else as it is, and write it back with
`gh api -X PATCH repos/{owner}/{repo}/issues/180 -F body=@<file>` (`-F`, not `-f`: `-f` sends the literal text
`@<file>` and erases the tables). Check the result shows both the old rows and the new one. Keep a running tally in the session
scratchpad (`tokens.tsv`: PR, role, log path, `duration_ms`, `subagent_tokens`) so a compaction does not lose it.

What the numbers mean (#178, comments 6873807074 and 6866721229):
- `subagent_tokens` in an agent's completion notice is its context size at the end, not its spend; it stays in
  #180 only for comparison. The real spend is the sum of `usage` (`cache_read_input_tokens`,
  `cache_creation_input_tokens`, `input_tokens`, `output_tokens`) of every model call in the agent's log
  `tasks/<agentId>.output`, each `message.id` once — 30–90 times more (the lead's estimate, [#180 «Токени агентів»](https://github.com/minakovval/Willowsum/issues/180); not measured in #178).
- A resumed agent's notice shows only its last run: sum `duration_ms` (and `subagent_tokens`) of every run.
- `get_session` usage never included the agents, and since 2026-11-14 it returns no `usage` at all: the lead's
  own spend is the sum of its session transcript `~/.claude/projects/<dir>/<session id>.jsonl` (#180, comment
  6874092809).

**Script** (owner, 2026-11-14, #178, comment 6873950124): `tools/token-report` (tests: `node --test
'tools/token-report/**/*.test.mjs'`). Run it **right after the merge**: agent logs vanish with the container.
```bash
node tools/token-report/index.mjs pr --pr <n> --type <код|UI|вимоги|процес|виправлення> --rounds "<раунди>" \
  --run role=author,log=<tasks/…output>,ms=<duration_ms>,tokens=<subagent_tokens> \
  --run role=review,log=<…>,ms=<…>,tokens=<…>  [one --run per agent run] \
  --branch <PR branch>   # or --ci-runs <file> with the JSON of the runs API
node tools/token-report/index.mjs session ~/.claude/projects/<dir>/<session id>.jsonl [--since <ISO>]
```
Roles: `author` and `fix` add to «Час автора», `review`, `security` and `confirm` to «Час рецензій». It prints the
row of the table «PR» (PR | Тип | Раунди | subagent_tokens | Агенти: cache read, млн | Агенти: output, тис. |
Час автора, хв | Час рецензій, хв | CI, хв | Примітка); `--note` adds to the note. CI minutes are the sum of
`run_started_at` → `updated_at` of every GitHub Actions run of the branch
(`gh api "repos/{owner}/{repo}/actions/runs?branch=<b>&per_page=100"`). A log without any `usage` field, a line
that is not JSON, or a runs page shorter than `total_count` fails the run (exit 1) instead of counting zero:
then record the row by hand with «журнал втрачено» in the note.

1. **Session.** At start, post the snapshot as a comment on #180 (session name, time, the `session` sum of the
   transcript so far); before finishing, add the session's row to the table «Сесії»: period and the difference
   (end minus start). It is the lead alone; the agents are the sum of the PR rows.
2. **PR.** In the same turn as the merge (owner, 2026-11-13; not as a later step), append the script's row to
   the table «PR» (the existing rows stay): every author, fix, reviewer and confirmation run of that PR
   (follow-up and fix agents of the same PR included).
3. **Weekly.** Once a week (the first session after 7 days since the last analysis) add a short «Аналіз» note
   to #180: which PR types cost most (sum and per PR, tokens and time), and the lead's own share (the session
   sums against the agents' sums). A change of process it suggests goes to the queue «Черга змін процесу» (#178).
