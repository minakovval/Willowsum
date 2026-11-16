# Token economy (model choice and briefs)

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-16

Read when you choose a model for an agent or write a brief, after every merge, after a compaction, and when a lead
session starts or finishes.

Owner request 2026-11-12. Each item carries its source: most are owner decisions, «lead» marks the lead's own.

1. Pick the agent's model by risk and by the PR's tier ([merge rules](../../../references/merge-rules.md), «Review
   tiers»). Рішення ведучого (2026-11-16; власник не схвалював; [log](../../../../docs/decisions/log/2026-11-16-owner-process-light.md)): the tier Фундамент keeps the models below (main model, Fable for its uses); authors and
   `review-pr` reviewers of the tiers Функціональність (screens, components), Документи and Локальні інструменти run
   on the lighter model, which for those tiers replaces «every review … of a PR that changes code … stays on the main
   model» below; security reviews stay as below; why: the owner asked for cost by risk (brief «легший процес,
   надійна база», item 5):
   - **implementing** sensitive features: the main model (Рішення ведучого (2026-11-16; власник не схвалював;
     #360): «the strongest model» of the earlier text is the main model, since Fable has only the uses below);
   - **fixes and confirmations**: the lighter model working from ready reviewer patches (`fix-review-findings`),
     a fresh agent per fix; if it must deviate from a patch, it stops and reports, and the fix moves to the main
     model (owner, 2026-11-14, #178; #191 deadlocked; a faster fix model was declined: owner, 2026-11-16);
     follow-up PRs and status checks also on the lighter model;
   - **security reviews**: the main model, except the Fable uses below; **mutation testing of critical modules
     is mandatory on any model**;
   - **Fable** (owner, 2026-11-16, Ultra, [log](../../../../docs/decisions/log/2026-11-16-owner-ultra-fable-fingerprints.md), items 1–3) only for:
     (a) the design of A1 and the amendments to ADR-0002 and ADR-0015; (b) the security review of every PR that
     **writes** sums, balances or postings — a money PR that only reads (a directory, read-only queries, like #338)
     goes to the main model with mutation testing; the lead decides by the diff, in doubt Fable (owner, 2026-11-16,
     process review 15, proposal 2); (c) the security reviews of sign-in, encryption and data isolation of the
     household or space, not queued behind (b); (d) wave planning (`plan-wave`). At most 4 Fable tasks at once.
     Everything else — flaky-test root causes, other architecture rows, implementing vault encryption, statement
     import, requirement sweeps, follow-ups, docs, sync confirmations — is on the main model; the lead stays on
     Opus; parallelism as in AGENTS.md (7 branches, 10 agents). Fable draws on the Ultra subscription limit about
     twice as fast per token, with longer turns: short briefs that state the goal; compare its rows in #180 by the
     per-model split;
   - **reviews** (owner, 2026-11-13): a `review-pr` of a PR whose every file passes `isDocsOnly` (merge checklist)
     and none is a test or code may use a lighter model; every review and confirmation of a PR that changes code,
     tools or workflows stays on the main model, as does a `.claude/`- or AGENTS.md-only PR that touches a security
     rule (hard rules, review procedures, approvals, secrets, sensitive paths) (lead, follow-up of #166).
2. A first review goes to a fresh agent with a narrow brief. A re-review **resumes the same reviewer session**
   when only the fixes changed since its last head (the brief: the diff since that head and its previous findings);
   a **fresh reviewer** when more changed — a sync with non-mechanical changes, new scope, a rewritten history
   (owner, 2026-11-16, «2 а», [log](../../../../docs/decisions/log/2026-11-16-owner-process-light.md); it replaces
   «a long-context reviewer is never resumed», owner, 2026-11-13). At most two rounds either way (AGENTS.md step 5).
3. Reviewers rely on green CI for full suites: locally only the tests of the changed code (plus integration tests
   for database changes).
4. Briefs point agents at exact files and sections instead of «read everything»; reports in the fixed ≤ 5-line
   form (SKILL.md step 2); small PRs and splitting: AGENTS.md step 5, SKILL.md step 1.
5. Resume an implementing agent at most 2 times (owner, 2026-11-13, #178): every resume re-reads its whole
   context (#180, lead session 1); a third round of fixes goes to a fresh agent with the diff, the findings and
   the patch.
6. Cost of rounds (owner, 2026-11-14, #178): one confirmation agent for both verdicts of a `sensitive` PR saves
   ≈ 80–90 k per sync (SKILL.md steps 1, 4, 5); no sync at all: [merge checklist](merge-checklist.md), «Sync only
   when needed».

## Token accounting

Mandatory (owner, 2026-11-13/14, #180). The tables live in the **body** of #180, never in comments (owner,
2026-11-15, #178): read the body right before each edit (`gh api repos/{owner}/{repo}/issues/180 --jq .body >
<file>`), add the row with `tools/token-report … append` (it keeps every other byte), write it back with
`gh api -X PATCH repos/{owner}/{repo}/issues/180 -F body=@<file>` (`-F`, not `-f`: `-f` sends the literal
`@<file>` and erases the tables) and check that the old rows and the new one are there. Keep a running tally in
the scratchpad (`tokens.tsv`: PR, role, log path, `duration_ms`, `subagent_tokens`) so a compaction loses nothing.

Numbers (#178): `subagent_tokens` in a completion notice is the agent's final context, not its spend (kept for
comparison); the spend is the `usage` of every model call in its log `tasks/<agentId>.output`, each `message.id`
once, per `message.model` (owner, 2026-11-15). A resumed agent's notice shows its last run only: sum every run.
`get_session` → `usage` includes the agents; the lead's own share: `session` on `~/.claude/projects/<dir>/<id>.jsonl`.

**Script** (owner, 2026-11-14, #178): `tools/token-report` ([README](../../../../tools/token-report/README.md);
tests `node --test 'tools/token-report/**/*.test.mjs'`). Run `pr` **right after the merge**: agent logs vanish with
the container.
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
  cache read` (owner, 2026-11-15) and `--note`; paste only the row line. Roles `author` and `fix` add to «Час
  автора», `review`, `security` and `confirm` to «Час рецензій». CI is the sum of `run_started_at` → `updated_at`
  of every Actions run of the branch. It fails (exit 1) on a log without `usage`, a line that is not JSON, a runs
  page shorter than `total_count`, a type outside the five, or CI = 0 for a `код`, `UI` or `виправлення` PR
  (owner, 2026-11-16, process review 15, proposal 4); a lost log → the row by hand with «журнал втрачено».
- **Note and body size** (owner, 2026-11-15/16, #178, `2026-11-16-owner-180-size.md`): one line, at most 120
  characters in «PR» and 250 in «Сесії» (`--note` counts; no per-agent list — the numbers stay in the logs). When
  the body would exceed 55 000 characters (GitHub allows 65 536), `append` fails: `archive` moves all «PR» rows
  with the header to `<archive.md>` and leaves the header and «Архів рядків PR: <посилання>»; the lead creates
  the archive issue, fills the link and PATCHes the body; new rows go under the header as before.

1. **Segment** (owner, 2026-11-15/16, #178): the unit is the segment between compactions, «ведучий N». At its
   start — a new session or a compaction — save the `get_session` result (no `session_id`) to
   `keep/snap-N-start.json` and post it as a snapshot comment on #180 (lead name, time, `usage` with `cost_usd`).
   At its end — the next compaction or the end of the session — save `keep/snap-N-end.json` and add the «Сесії»
   row with `append --sessions` (above): cache read, output and USD are the snapshot difference, agents included;
   «Час агентів» and CI are the sums of the segment's PR rows; a lost snapshot file is rebuilt in the short form
   from its #180 comment ([README](../../../../tools/token-report/README.md)). Рішення ведучого (2026-11-16;
   власник не схвалював; #360): the row includes the agents, as the rows since «ведучий 3» do; the lead's own
   share (`session --since <start>`) goes into the retrospective.
2. **PR.** In the same turn as the merge (owner, 2026-11-13), append the script's row to «PR»: every author, fix,
   reviewer and confirmation run of that PR (follow-up and fix agents of the same PR included).
3. **Analysis** (owner, 2026-11-15, #178): no weekly «Аналіз» note; the process review ([restarts](restarts.md))
   draws its conclusions from #180: which PR types cost most (sum and per PR, tokens and time) and the lead's share.
   Рішення ведучого (2026-11-16; власник не схвалював; [log](../../../../docs/decisions/log/2026-11-16-owner-process-light.md)): once stage 1 of `docs/plans/poc-wave-2.md` is done, compare with the pace from 2026-11-16 on, not earlier days (owner, 2026-11-16, Ultra, item 4): the mean time
   from opening a PR to its merge, review sessions per PR and cost per merged PR (from #180); if one of them did not
   improve, tell the owner in two or three lines; why: the brief's «Як перевірити, що спрацювало».

## Session retrospective

At the end of every lead segment (each compaction and the end of a session; owner, 2026-11-14/15, #178): a comment
on #180 — conclusions; productivity (tokens, time, the lead's share, the costliest PRs); proposals with risks,
downsides and mitigations (→ #178 and item 4 of the handover table); risks — plus the «Сесії» row («Token
accounting» item 1) and a short note to the owner in chat. [Example](https://github.com/minakovval/Willowsum/issues/180#issuecomment-6877918729).
