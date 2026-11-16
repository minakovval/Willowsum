# Token economy (model choice and briefs)

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-16

Read when you choose a model for an agent or write a brief, after every merge, after a compaction, and when a lead
session starts or finishes.

Owner request 2026-11-12. Each item carries its source: most are owner decisions, «lead» marks the lead's own.

1. Pick the agent's model by risk:
   - the strongest model for implementing sensitive features; security reviews of critical modules (isolation,
     auth, encryption) on the main model, except the highest-risk PRs and every `sensitive:money` PR (see Fable);
     fixes and confirmations stay on the lighter model working from ready patches (owner, 2026-11-16: a faster
     fix model was considered and declined);
   - **Fable** (owner, 2026-11-14/15, #178): **only** root-cause searches of flaky tests and the security review
     of the highest-risk PRs (sign-in, encryption, data isolation of the household/space) and of `sensitive:money` PRs. Other security reviews
     are on the main model, as is everything else (architecture rows, vault encryption, statement import,
     requirement sweeps, follow-ups, docs, sync confirmations). **Fable limit (owner, 2026-11-16, `2026-11-16-owner-speedup.md`, #331): at most 2 Fable tasks at once in total.
     The security review of every PR labelled `sensitive:money` runs on Fable, with no condition on the number
     of authors. The other Fable uses (flaky-test root causes, the reviews of sign-in, encryption and
     data-isolation PRs) keep the earlier rule: at most one at a time and only while at most 3 authors run
     (owner, 2026-11-16, 9a). (lead decision, not approved by the owner, 2026-11-16, #331: both uses share the 2; money reviews have priority; a flaky-test search starts only if fewer than 2 Fable tasks run, else it waits or goes to the main model).** **Mutation testing of critical modules is mandatory on any model.**
     A security review already started on Fable (#266) is finished on Fable. Fable draws on the same 100 USD
     subscription limit and spends it faster (about ×2 price per token, longer turns); its briefs are short and
     state the goal. Compare Fable rows with similar PRs in #180 by the per-model split (see «Token accounting»);
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
5. Short final reports, not narratives: SKILL.md step 2.
6. Small PRs and how to split them: AGENTS.md step 5, SKILL.md step 1.
7. Resume an implementing agent at most 2 times (owner, 2026-11-13, #178). A third round of fixes goes to a
   fresh agent with a short brief: the diff, the findings, the patch. Every resume re-reads the agent's whole
   context (#180, lead session 1).
8. Workflow «супровідник» experiment: closed, not adopted (owner, 2026-11-16: «6 ок»; [log](../../../../docs/decisions/log/2026-11-16-owner-sync-confirm-215.md)).
9. Not adopted (owner, 2026-11-14): (6) a cap on the number of parallel code PRs. (3) the lead confirming code-PR
   syncs itself was not adopted then and is adopted in a narrow form (owner, 2026-11-16, «1 а»;
   [log](../../../../docs/decisions/log/2026-11-16-owner-sync-confirm-215.md)); the rule: [merge checklist](merge-checklist.md),
   «Code PR after a sync, lead confirms».
10. Rate limit at session start: [restarts](restarts.md), «Session names».
11. Cost of rounds (owner, 2026-11-14, #178): one confirmation agent for both verdicts of a `sensitive` PR saves
    ≈ 80–90 k context per sync; the rules for it, the sync by the fix agent, cheap reviewer tests and splitting
    code PRs: SKILL.md steps 1, 4 and 5.

## Token accounting

Mandatory (owner, 2026-11-13/14, #180). The lead keeps the tables, including every PR and session row, in the
**body** of #180, never as comments (owner, 2026-11-15, #178): read the current body right before each edit
(`gh api repos/{owner}/{repo}/issues/180 --jq .body > <file>`), add the row with
`node tools/token-report/index.mjs append --body <file> --row "<row>"` (`--sessions` for the table «Сесії»; owner,
2026-11-15, #178, [comment 6899108018](https://github.com/minakovval/Willowsum/issues/178#issuecomment-6899108018)),
which keeps everything else byte for byte, and write it back with
`gh api -X PATCH repos/{owner}/{repo}/issues/180 -F body=@<file>` (`-F`, not `-f`: `-f` sends the literal text
`@<file>` and erases the tables). Check the result shows both the old rows and the new one. Keep a running tally in
the session scratchpad (`tokens.tsv`: PR, role, log path, `duration_ms`, `subagent_tokens`) so a compaction does
not lose it.

What the numbers mean (#178):
- `subagent_tokens` in an agent's completion notice is its context size at the end, not its spend; it stays in
  #180 only for comparison. The real spend is the sum of `usage` (`cache_read_input_tokens`,
  `cache_creation_input_tokens`, `input_tokens`, `output_tokens`) of every model call in the agent's log
  `tasks/<agentId>.output`, each `message.id` once — 30–90 times more (the lead's estimate in #180, not measured).
- Spend per model (owner, 2026-11-15, #178): every assistant record carries `message.model`
  (e.g. `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-fable-5-2`); the script sums `usage` per model, each
  `message.id` once. A record without a model counts as `unknown`.
- A resumed agent's notice shows only its last run: sum `duration_ms` (and `subagent_tokens`) of every run.
- `get_session` → `usage` includes the agents; it may be absent at session start (owner, 2026-11-14, #178). The
  lead's own share is `tools/token-report session` on its transcript `~/.claude/projects/<dir>/<session id>.jsonl`
  (#180).

**Script** (owner, 2026-11-14, #178): `tools/token-report` (tests: `node --test
'tools/token-report/**/*.test.mjs'`). Run it **right after the merge**: agent logs vanish with the container.
```bash
node tools/token-report/index.mjs pr --pr <n> --type <код|UI|вимоги|процес|виправлення> --rounds "<раунди>" \
  --run role=author,log=<tasks/…output>,ms=<duration_ms>,tokens=<subagent_tokens> \
  --run role=review,log=<…>,ms=<…>,tokens=<…>  [one --run per agent run] \
  --branch <PR branch>   # or --ci-runs <file> with the JSON of the runs API
node tools/token-report/index.mjs session ~/.claude/projects/<dir>/<session id>.jsonl [--since <ISO>]
node tools/token-report/index.mjs append --body <#180 body file> --row "<| … |>" [--sessions]
node tools/token-report/index.mjs archive --body <#180 body file> --out <archive.md>
```
Per-model split (owner, 2026-11-15, #178): after the row, `pr` prints one line per model (model, model calls,
cache read, cache creation, input, output), and the row's «Примітка» gets `моделі: opus 4,1 млн / fable 1,2 млн
cache read`; the row columns are unchanged. `session` prints the same lines after the total. The #180 PR rows note
the per-model split. Paste only the row line into #180. The row's «Примітка» is at most one line (owner, 2026-11-15,
#178): detail stays in the agent logs and the PR comments.

Size of the #180 body (owner, 2026-11-16, #178; GitHub allows 65 536 characters): `pr` no longer puts the per-agent
list «автор 293 276, рецензія …» into the note (the numbers stay in the agent logs; `--note` and «журнал втрачено» stay),
and `append` refuses (exit 1) a row whose «Примітка» is longer than 120 characters (`--note` counts). When the body
after appending would exceed 55 000 characters, `append` fails and the lead moves the «PR» table to an archive
issue: `archive --body <file> --out <archive.md>` writes all rows of the «PR» table (with its header) to `<archive.md>`,
leaves in the body the table header and the line «Архів рядків PR: <посилання>», and keeps every other byte; the lead
creates the archive issue from `<archive.md>`, puts its link into that line and PATCHes the body. New rows then go
under the header as before. Decision: `docs/decisions/log/2026-11-16-owner-180-size.md`.
Roles: `author` and `fix` add to «Час автора», `review`, `security` and `confirm` to «Час рецензій». It prints the
row of the table «PR» (PR | Тип | Раунди | subagent_tokens | Агенти: cache read, млн | Агенти: output, тис. |
Час автора, хв | Час рецензій, хв | CI, хв | Примітка); `--note` adds to the note. CI minutes are the sum of
`run_started_at` → `updated_at` of every GitHub Actions run of the branch
(`gh api "repos/{owner}/{repo}/actions/runs?branch=<b>&per_page=100"`). A log without any `usage` field, a line
that is not JSON, or a runs page shorter than `total_count` fails the run (exit 1) instead of counting zero:
then record the row by hand with «журнал втрачено» in the note.

1. **Segment** (owner, 2026-11-15, #178): the unit is the segment between compactions, row label «ведучий N»
   (one lead number; the numbering continues across compactions). At its start — a new session or a compaction —
   post the snapshot as a comment on #180 (lead name, time, the `session` sum of the transcript so far); at its end
   — the next compaction or the end of the session — add its row to the table «Сесії»: period (compaction to
   compaction) and the difference (end minus start; `session --since <start>` gives it from one transcript). The snapshot and this row are the `session` sum of the lead's own transcript, so the lead
   alone; the agents are the sum of the PR rows (`get_session` → `usage`, above, includes both).
2. **PR.** In the same turn as the merge (owner, 2026-11-13; not as a later step), append the script's row to
   the table «PR» (the existing rows stay): every author, fix, reviewer and confirmation run of that PR
   (follow-up and fix agents of the same PR included).
3. **Analysis** (owner, 2026-11-15, #178): no weekly «Аналіз» note; the process review (every 3rd lead number,
   [restarts](restarts.md), «Process review») draws its conclusions from #180: which PR types cost most (sum and per
   PR, tokens and time), and the lead's own share (the session sums against the agents' sums).

## Session retrospective

At the end of every lead segment — each compaction and the end of a session (owner, 2026-11-14/15, #178): a
comment on #180 in four parts — conclusions; productivity (tokens, time, the lead's share, the costliest PRs);
improvement proposals, each with its risks, downsides and mitigations; risks. The segment's «Сесії» row is added with
`token-report append --sessions` («Token accounting»). Tell it to the owner briefly in chat. Its process proposals go to «Черга змін
процесу» (#178). Example: [#180, retrospective of «ведучий 3»](https://github.com/minakovval/Willowsum/issues/180#issuecomment-6877918729).
