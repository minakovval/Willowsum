# Token economy (model choice and briefs)

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-27

Read when you choose a model for an agent or write a brief, after every merge, after a compaction, and when a lead
session starts or finishes.

1. **Model by role and risk.** Main model = Opus; lighter = Sonnet; the lead stays on Opus. Tiers:
   [merge rules](../../../references/merge-rules.md), «Review tiers».

   | Role | Sonnet | Opus | Fable |
   | --- | --- | --- | --- |
   | Author | tiers Функціональність (screens, components), Документи, Локальні інструменти; follow-up sweeps (rows R); flaky-test fixes | server PRs; sensitive features; a screen with money logic; finding the root cause of a flaky test | the design of A1 and the amendments to ADR-0002 and ADR-0015; wave planning (`plan-wave`) |
   | Fix (`fix-review-findings`) | every fix, `sensitive` PRs too: a fresh agent that applies the reviewers' ready patches; status checks | only after the Sonnet agent reports that it must deviate from a patch | — |
   | `review-pr`, first review | a PR **without** `sensitive` that is tests, docs, process, flaky tests, or a screen or UI component (the tiers Функціональність, Документи, Локальні інструменти) | every other PR that changes code, tools or workflows; a screen with money logic; a `.claude/`- or AGENTS.md-only PR that touches a security rule (hard rules, review procedures, approvals, secrets, sensitive paths) | — |
   | `security-review`, first review | a PR whose diff changes only test titles and/or requirement wording with no item added or removed: you check it mechanically on the diff (strict list: `security-review` §0 «Light confirmation»); any other changed line → Opus | a PR that is only `sensitive:money`, `schema`, `pipeline` or `infrastructure`; everything not in the other columns | a PR labelled `sensitive:permissions`, `auth` or `encryption` |
   | Confirmation (who: SKILL.md step 5) | the diff since the last reviewed head changes only tests, texts or a merge of `main` (`sensitive` PRs too) | the diff changes code | never |

   - **Fable limits**: near 90 % of the Fable limit the first security reviews go to
     Opus and you tell the owner. Fable draws on the subscription limit about twice as fast per token, with
     longer turns: short briefs that state the goal; compare its rows in #180 by the per-model split.
   - **Sonnet reviews, mandatory mitigations**: a Sonnet confirmation that finds a change to code outside tests
     stops and hands back to you, and the confirmation goes to Opus; a Sonnet reviewer checks that no assertion
     was removed or weakened (the test diff against the head it last reviewed) and says so in its report; for a
     screen, the 1280 px screenshot is compared with the board (`screen-from-canvas` §6).
   - Mutation testing: `security-review` §4.
   - Decisions behind the table: `docs/decisions/log/2026-11-20-owner-fable-usage.md`,
     `2026-11-20-owner-sonnet-reviews.md`, `2026-11-27-owner-process-review-35.md`, `2026-11-27-owner-rules-rewrite.md`.
2. A first review and every confirmation go to a fresh agent with a narrow brief (SKILL.md step 5). At most two
   rounds (AGENTS.md step 5).
3. Reviewers rely on green CI for full suites: locally only the tests of the changed code (plus integration tests
   for database changes).
4. Briefs point agents at exact files and sections instead of «read everything» and repeat nothing the agent's
   skill already says; agent types with short tool lists and the brief's contents: SKILL.md step 2; small PRs and
   splitting: AGENTS.md step 5, SKILL.md step 1.
5. Never resume a reviewer; resume an implementing agent only while its context is under ≈ 100 k tokens: every
   call of a resumed agent re-reads its whole context. Otherwise a fresh agent with the diff, the findings and
   the patch.
6. Cost of rounds: one confirmation agent for both verdicts of a `sensitive` PR saves ≈ 80–90 k per sync
   (SKILL.md step 5); no sync at all: [merge checklist](merge-checklist.md), «Sync only when needed».

## Token accounting

Mandatory. The tables live in the **body** of #180, never in comments: read the body right before each edit (`gh api repos/{owner}/{repo}/issues/180 --jq .body >
<file>`), add the row with `tools/token-report … append` (it keeps every other byte), write it back with
`gh api -X PATCH repos/{owner}/{repo}/issues/180 -F body=@<file>` (`-F`, not `-f`: `-f` sends the literal
`@<file>` and erases the tables) and check that the old rows and the new one are there. Keep a running tally in
the scratchpad (`tokens.tsv`: PR, role, log path, `duration_ms`, `subagent_tokens`) so a compaction loses nothing.
The `--note` of the PR row also gives the model per role in short form, e.g. `a:S r:O` (a author, r reviewer, s
security, f fix; S Sonnet, O Opus, F Fable): the next process review measures the cost of Opus reviews on test-only PRs.

Numbers (#178): `subagent_tokens` in a completion notice is the agent's final context, not its spend (kept for
comparison); the spend is the `usage` of every model call in its log `tasks/<agentId>.output`, each `message.id`
once, per `message.model`. A resumed agent's notice shows its last run only: sum every run.
`get_session` → `usage` includes the agents; the lead's own share: `session` on `~/.claude/projects/<dir>/<id>.jsonl`.

**Script**: `tools/token-report` ([README](../../../../tools/token-report/README.md);
tests `node --test 'tools/token-report/**/*.test.mjs'`). Save each merged PR's agent numbers in `tokens.tsv` **right
after the merge**: agent logs vanish with the container; run `pr` for the batch rows (item 2) while the logs exist.
```bash
node tools/token-report/index.mjs pr --pr <n> --type <код|UI|вимоги|процес|виправлення> --rounds "<раунди>" \
  --run role=author,log=<tasks/…output>,ms=<duration_ms>,tokens=<subagent_tokens> \
  --run role=review,log=<…>,ms=<…>,tokens=<…>  [one --run per agent run] \
  --branch <PR branch>   # or --ci-runs <file> with the JSON of the runs API
node tools/token-report/index.mjs append --body <#180 body file> --row "<| … |>"
node tools/token-report/index.mjs append --body <#180 body file> --sessions --segment "ведучий N" \
  --start <keep/snap-N-start.json> --end <keep/snap-N-end.json> --prs <#a,#b | none> [--note "<текст>"]
node tools/token-report/index.mjs session ~/.claude/projects/<dir>/<session id>.jsonl [--since <ISO>]
node tools/token-report/index.mjs archive --body <#180 body file> --out <archive.md>
```
- `pr` prints the row of «PR» (PR | Тип | Раунди | subagent_tokens | cache read, млн | output, тис. | Час автора |
  Час рецензій | CI, хв | Примітка) and one line per model; the note gets `моделі: opus 4,1 млн / fable 1,2 млн
  cache read` and `--note`; paste only the row line. Roles `author` and `fix` add to «Час
  автора», `review`, `security` and `confirm` to «Час рецензій». CI is the sum of `run_started_at` → `updated_at`
  of every Actions run of the branch. It fails (exit 1) on a log without `usage`, a line that is not JSON, a runs
  page shorter than `total_count`, a type outside the five, or CI = 0 for a `код`, `UI` or `виправлення` PR; a lost log → the row by hand with «журнал втрачено».
- **Note and body size**: one line, at most 120
  characters in «PR» and 250 in «Сесії» (`--note` counts; no per-agent list — the numbers stay in the logs). When
  the body would exceed 55 000 characters (GitHub allows 65 536), `append` fails: `archive` moves all «PR» rows
  with the header to `<archive.md>` and leaves the header and «Архів рядків PR: <посилання>»; the lead creates
  the archive issue, fills the link and PATCHes the body; new rows go under the header as before.

1. **Segment**: the unit is the segment between compactions, «ведучий N». At its
   start — a new session or a compaction — save the `get_session` result (no `session_id`) to
   `keep/snap-N-start.json` and post it as a snapshot comment on #180 (lead name, time, `usage` with `cost_usd`).
   At its end — the next compaction or the end of the session — save `keep/snap-N-end.json` and add the «Сесії»
   row with `append --sessions` (above): cache read, output and USD are the snapshot difference, agents included;
   «Час агентів» and CI are the sums of the segment's PR rows; a lost snapshot file is rebuilt in the short form
   from its #180 comment ([README](../../../../tools/token-report/README.md)). The row includes the agents, as the rows since «ведучий 3» do; the lead's own
   share (`session --since <start>`) goes into the retrospective.
2. **PR.** In a batch every 3 merges, with the #179 state update (not after each merge), append the script's rows
   to «PR»: every author, fix, reviewer and confirmation run of each PR (follow-up and fix agents included).
3. **Analysis**: no weekly «Аналіз» note; the process review ([restarts](restarts.md))
   draws its conclusions from #180: which PR types cost most (sum and per PR, tokens and time) and the lead's share.

## Session retrospective

With the process review and at the end of a session (not at a compaction: [restarts](restarts.md), «After
compaction»): a comment on #180 — conclusions; productivity (tokens, time, the lead's share, the costliest PRs);
proposals with risks, downsides and mitigations (→ #178, each with its link); risks — plus the «Сесії»
row («Token accounting» item 1; written at a compaction too) and a short note to the owner in chat.
[Example](https://github.com/minakovval/Willowsum/issues/180#issuecomment-6877918729).
