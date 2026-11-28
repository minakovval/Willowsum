# Token economy (model choice and briefs)

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-28

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
   the patch. An author hands over at ≈ 150 k and does not wait for CI
   ([`implement-requirement`](../../implement-requirement/SKILL.md), «Stop and hand over»).
   **Trial (owner, 2026-11-28):** these author rules and the review rules of
   [`review-pr`](../../review-pr/SKILL.md) §5 and §7 run on the next plan section of ≈ 20 code PRs; the result is
   checked at the process review ([decision](../../../../docs/decisions/log/2026-11-28-owner-token-savings-trial-rules.md)).
6. Cost of rounds: one confirmation agent for both verdicts of a `sensitive` PR saves ≈ 80–90 k per sync
   (SKILL.md step 5); no sync at all: [merge checklist](merge-checklist.md), «Sync only when needed».

## Token accounting

Mandatory, **one command per segment** (owner, 2026-11-27). The tables live in the **body** of #180, never in
comments; no per-PR rows by hand, no snapshot comments.

1. **At each agent start** append one line to `keep/ledger.tsv` (scratchpad): `PR<TAB>role<TAB>model<TAB>agentId`
   (role a/r/s/f/c = author/review/security/fix/confirm; model S/O/F; `agentId` as in `tasks/<agentId>.output`; a resumed agent
   is the same line; optional 5th column on the `f`/`c` line: the reason of round 2 — `тест`, `правило`, `безпека` or `інше`). **At a segment start** save the `get_session` result (no `session_id`) to `keep/snap-N-start.json`.
2. **At the end of a segment** (a lead session or a compaction; also before the daily summary) save
   `keep/snap-N-end.json` and run once, while the logs exist:
```bash
gh api repos/{owner}/{repo}/issues/180 --jq .body > keep/body180.md
node tools/token-report/index.mjs batch --ledger keep/ledger.tsv --tasks <tasks dir> --body keep/body180.md \
  --branches "#12=<branch>,…" [--types "#12=UI,…"] --start keep/snap-N-start.json --end keep/snap-N-end.json \
  --segment "ведучий N" --lead <lead transcript.jsonl> [--prs <#a,#b>] [--note "<текст>"] [--dry-run]
gh api -X PATCH repos/{owner}/{repo}/issues/180 -F body=@keep/body180.md   # -F, not -f: -f erases the tables
```
   It adds a «PR» row for each ledger PR without one (the `usage` of every log, each `message.id` once per model;
   durations from the logs; CI from `--branches`; type `код` unless `--types`; note `a:S r:O` + «моделі») and the
   «Сесії» row (cache read total = snapshot difference, agents = sum of the PR rows, the lead alone = `--lead`; output, USD). The PR row also has cache write and input; rounds = 2 when the ledger has an `f` or `c` row. A missing log → the row with what exists,
   «журнал втрачено» and a warning; fix the row by hand or accept it. Check that the old rows and the new ones are
   in the body. Details: [README](../../../../tools/token-report/README.md); tests
   `node --test 'tools/token-report/**/*.test.mjs'`.

Numbers (#178): `subagent_tokens` in a completion notice is the agent's final context, not its spend; the spend is
the `usage` of every model call in the log. `get_session` → `usage` includes the agents; the lead's own share:
`session ~/.claude/projects/<dir>/<id>.jsonl [--since <ISO>]`, for the retrospective.

**Note and body size**: one line, at most 120 characters in «PR» and 250 in «Сесії». When the body would exceed
55 000 characters (GitHub allows 65 536), `batch` fails: `archive --body <file> --out <archive.md>` moves all
«PR» rows to `<archive.md>` and leaves «Архів рядків PR: <посилання>»; the lead creates the archive issue, fills
the link and PATCHes the body. The `pr` and `append` commands stay for a manual row.

**Analysis**: no weekly «Аналіз» note; the process review ([restarts](restarts.md))
   draws its conclusions from #180: which PR types cost most (sum and per PR, tokens and time) and the lead's share.

## Session retrospective

With the process review and at the end of a session (not at a compaction: [restarts](restarts.md), «After
compaction»): a comment on #180 — conclusions; productivity (tokens, time, the lead's share, the costliest PRs);
proposals with risks, downsides and mitigations (→ #178, each with its link); risks — plus the «Сесії»
row (`batch`, «Token accounting»; also at a compaction) and a short note to the owner in chat.
[Example](https://github.com/minakovval/Willowsum/issues/180#issuecomment-6877918729).
