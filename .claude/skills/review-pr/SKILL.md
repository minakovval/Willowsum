---
name: review-pr
description: Review a Willowsum pull request against its requirement file in docs/requirements/ and the hard rules in AGENTS.md. Use when asked to review a PR or branch that implements a requirement ID. Must run in a different session from the one that wrote the code.
---

# Review a requirement PR

**Створено:** 2026-11-01 · **Оновлено:** 2026-11-13

You are an independent reviewer. You did not write this code. Your job is to find what is wrong or
missing, not to confirm the author's summary.

## 1. Load

1. `AGENTS.md` (hard rules, Definition of Done).
2. The PR: title, body, diff, CI status (GitHub tools). Take the requirement ID from the title.
3. The requirement: for a migrated requirement, the generated **view** of the target release,
   `docs/requirements/<module>/<ID>.<release key>.md` (not the source `<ID>.md`, which merges every release);
   for one not migrated yet, its single file. Plus only the sections of `docs/requirements/00-general.md` it
   relies on.

Read the requirement **before** the PR body, so the author's framing does not anchor you.

**Scope on a `sensitive` PR** (owner, 2026-11-13): you cover the requirement (FR, AC, EC and their tests), the
logic and the tests. Security properties (data isolation, authentication, permissions, encryption, secrets,
money guards) are the `security-review` session's: do not duplicate its work; a security suspicion you notice
goes into your review as one pointer line for that reviewer, not as your own finding. On a PR without the label
you check the hard rules in full («3. Check the hard rules»).

**Re-review** (owner, 2026-11-12): check only the fixes and your own previous findings — the diff since the
head you last reviewed — not the whole PR again. There are at most two rounds; see «5. Report» and
«6. Confirmation rounds».

Scratchpad files (owner, 2026-11-13): only under a prefix or subfolder unique to the PR and role
(`pr153-review/`), never a generic name like `body.md`. You do not edit the PR body.

## 2. Check coverage

Build a table: every acceptance criterion and edge case in the requirement → the test that covers it →
does the test actually assert the behaviour (not just render)? Missing or weak rows are findings. Start from
`node tools/req-check/index.mjs --coverage` (tests named by item, e.g. `BUD-03@PoC AC2`), then read the tests.
A test named by a number that is not the item it tests is non-blocking unless it hides a missing criterion.
Time-dependent tests: a test must not re-read `Date.now()` to choose a time window (rate limits, expiry): it fixes the time once per test or injects a clock (re-reading it made CI flaky at minute boundaries, PR #92).
If the PR covers only part of the requirement, the body must say which criteria are left.
Mutation testing is required only for critical modules: data isolation, money, authentication, encryption
(owner, 2026-11-12); do not ask for it elsewhere.

## 3. Check the hard rules

A finding is blocking only if it is a security bypass, data loss or leak, or a violation of the requirement
the PR claims (its FR/AC) or of a shared rule (AGENTS.md, П-rules) (owner, 2026-11-12). Everything else is
non-blocking.

- Money: any `number`, `parseFloat`, `Math.round` or float arithmetic on amounts; currency conversion
  without a dated rate.
- Plans: plan names or numeric limits in code; missing entitlement check; a limit that hides or
  deletes data; wrong error (`402 PLAN_LIMIT_REACHED`).
- Scope and roles: queries without household/role/scope filter; counts, sums, totals, search results,
  exports or error messages that reveal out-of-scope records; missing permission tests per role.
- Audit: data changes without an audit entry.
- Privacy: personal data in logs, analytics, errors; real data or secrets in fixtures.
- Vault: plaintext of highly sensitive items reaching the server; CVV/PIN stored.
- Security: own crypto, injection, missing step-up where the requirement asks for it, unsafe file handling.
- Module boundaries: imports of another module's internals or tables; provider SDKs outside adapters;
  domain layer depending on database, HTTP or file system.
- Design before code: any change under `apps/` or `packages/` for a release whose design the owner has
  not yet approved and whose development the owner has not started (PoC: started 2026-11-06; AGENTS.md,
  «Process: design before code») — blocking.
- UI: empty/loading/error states, «Приховати суми» (from MVP; not in PoC), breakpoints of the target
  release, i18n uk/en, accessibility; existing design-system elements reused.
- Ledger: any write to journal tables outside `ledger`, unbalanced entries, edits instead of reversals,
  texts or merchant names stored in the journal (ARC-11).
- Module card not updated when the public interface or events changed.
- Owner decision: a PR changing requirements, AGENTS.md or skills states in its body the owner decision it
  implements, and the change matches that decision; a PR that acts on the cloud or production (applies
  infrastructure, deploys or releases to production, or changes the workflows that do this or their trust
  settings: OIDC, production secrets store; or production DNS) has the owner's approval on that PR — a comment
  from the owner's own GitHub account with a line that is exactly «Схвалюю» or «Approved», or the owner's
  decision from chat recorded in the PR body as a line `Рішення власника (YYYY-MM-DD): схвалено …` (owner,
  2026-11-12) — otherwise blocking. Infrastructure code that is only validated (no apply), CI check jobs and
  the local environment need no approval. The decision is also in the decision log: a new file in
  `docs/decisions/log/` (`YYYY-MM-DD-<short-slug>.md`, owner, 2026-11-13); a new entry appended to the archive
  `docs/decisions/state-2026-11-05.md` instead is a finding.
  Exemption (AGENTS.md step 7, owner, 2026-11-13): a mechanical sync of an AGENTS.md list that a test
  requires (a CI job name in the job list, a skill's name with its own `description` line in «Skills») needs
  no owner decision, only a note in the body. Confirm from the diff that a claimed mechanical sync changes
  only those list names or entries; anything else needs the owner's decision (blocking otherwise).
- Tests: any skipped, disabled or weakened test; acceptance tests edited to fit the code. «Load», «flake» or
  «timeout under load» is not an explanation of an intermittent failure (owner, 2026-11-13): a skip,
  quarantine or raised timeout without a stated root cause (reproduced, compared with `main`) or a separately
  tracked issue with the evidence is a finding (#146: a shared `test/.tmp` race).
- Requirement changes (PRC-01, PRC-02): run `node tools/req-check/index.mjs --impact <changed ID>` for
  each changed requirement, slice, screen or shared rule; every affected slice is updated in this PR or
  listed in the PR body as follow-up with an issue link (PRC-02 criterion 7) — otherwise blocking. Only
  sources were edited: a view changed without its source, or not equal to what the source generates, is
  blocking (CI's `view-stale`). For a changed card part, its «Реліз» line matches its row in the module
  README, the views are complete for their release, scope removed from PoC moved to PoC v2, and the views
  were regenerated (`node tools/req-check/index.mjs --views` and `node --test tools/req-check`: 0 errors, no
  diff). `docs/traceability/` and `docs/validation/req-check-report.md` are not committed (owner, 2026-11-13):
  a PR that adds them back is blocking; CI generates them. An implementation PR adds its tests to «Перевіряється»
  in the source, not in a view.
- Requirement-change PR without code (`change-requirement`, owner, 2026-11-12): one pass, on a lighter
  model, with the fixed checklist of `change-requirement` step 8; report each row. To check a move, run the
  same `--move` on a scratch copy of `main` and compare, or read the old and new views side by side
  (`git diff origin/main -- '<module>/<ID>.*.md'`). A security review is needed only for moved or reworded
  lines that state a protection, and covers only those lines.
- New dependencies or services without justification.

## 4. Verify, do not speculate

For each suspected defect, trace a concrete path (input or caller → wrong result). Run the relevant tests
locally if needed. Drop findings you cannot support. Integration tests: Cloud sessions have no Docker, so `pnpm db:test` fails there unless the admin URL is given:
`WS_TEST_PG_ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres pnpm db:test run -- pnpm --filter @willowsum/api exec vitest run --config vitest.integration.config.ts <files>`
(`infra/local/README.md`).

**Rely on CI for the full suites** (owner, 2026-11-13): do not rerun the full suites (`pnpm test`,
`pnpm test:integration`, `pnpm test:e2e`, all of `tools/*`): CI runs them on the head. Run only the tests of the
files the PR touches, plus mutation testing (critical modules), browser checks and targeted checks of a path you
suspect. The review states in one line what it relied on CI for: the jobs and their result on the reviewed head
(«CI relied on: requirements, web, api, e2e — green on <SHA>»; a job not finished or red is named as such).

**Own ports, databases and processes** (owner, 2026-11-13): up to 3–4 agents run at once, so the lead gives you
a slot `k` (1–4; none given → ask, or use 4). Use only your slot: the web dev server
`pnpm --filter @willowsum/web exec vite --port 517k --strictPort` (5171–5174; preview `--port 417k`), the API with
`WS_PORT=808k`, and `WS_API_ORIGIN=http://localhost:808k` for the web proxy. Test databases only through
`pnpm db:test` from your own worktree: their names carry your branch (`ws_t_<branch>_<random>`; `HEAD` in a
detached worktree, shared with other reviewers); record the names it prints and drop only those. Start a server in the background and record its PID (`echo $! >> <scratchpad>/pr<n>-<role>/pids`); stop only
your own PIDs (`kill $(cat <scratchpad>/pr<n>-<role>/pids)`), never `pkill`, `killall`, a kill by port or process
name, or `pnpm local:down` (it stops the shared environment). `pnpm test:e2e` picks free ports by itself.

## 5. Report

Post one PR review:
- **Blocking** — only as defined in «3. Check the hard rules»; each with file:line and the failing path.
- **Non-blocking** — everything else. The author lists them under «Follow-ups» in the PR body or opens an
  issue; they never start a new round by themselves. You may mark an item «cheap and safe to fold in»; the
  lead decides whether it goes in before merge (AGENTS.md step 7, owner, 2026-11-13).
- A recurring class of finding: propose the CI check or test that would catch it (non-blocking).
- The coverage table.
- Questions for the owner where the requirement itself is unclear on a real product question; small
  details the author decided and recorded are not owner questions.

Name the head commit you reviewed (full SHA) at the top of the review. End the review with the verdict on a
line of its own: `Verdict: Changes requested` if anything is blocking, otherwise `Verdict: Ready`; post it as
the review summary. A security review (sensitive areas) ends instead with a line `Security verdict: Ready` or
`Security verdict: Changes requested`. Never write these lines inside quotes or code, and never write a line
«Схвалюю» or «Approved»: that line is the owner's alone. The daily check of `main` (ADR-0008) reads exactly
these lines.

Post the review as one comment of this shape (a combined short re-review confirmation carries both verdict
lines, each on its own line):

```
Reviewed head: <full SHA>

<findings: Blocking, Non-blocking, coverage table, questions>

Verdict: Ready

---
_Generated by [Claude Code](https://claude.ai/code)_
```

When something blocks, the verdict line is `Verdict: Changes requested` instead.

**Report to the lead** (owner, 2026-11-13): 10–15 lines, no narrative — PR, reviewed head SHA (full), verdict, blocking items with file:line, owner questions. Details go in the PR body
or the review, not in the report.

**At most two rounds** (owner, 2026-11-12). If something blocking remains after round 2, give a ready fix
with a test in the review (a patch or exact code) and the verdict `Changes requested`; after the author
applies it, confirm that specific fix briefly, with a verdict that names the final head SHA.

The lead merges (AGENTS.md step 7, owner, 2026-11-13) only after «Ready» given on the commit being merged:
it compares the SHA your review names with the PR head, and any later commit needs a re-review of that
commit (owner, 2026-11-12). Once the merge conditions in AGENTS.md step 7 hold, the lead does not ask the
owner to confirm the merge; it merges at once and tells the owner. A PR labelled `sensitive` (CI sets it from file paths) also needs
a separate security review — say so if it has not had one; other PRs need none (owner, 2026-11-12).

**GitHub errors** (owner, 2026-11-13): on HTTP 502 or 503, or «token store unavailable», retry with backoff
(wait about 10 s, 30 s, then 90 s; at most 3 retries), then report the failure instead of looping. Before
retrying a call that is not idempotent — posting a review, a comment or an issue, opening a PR — check whether
the first attempt landed: list the PR's reviews (`gh api repos/{owner}/{repo}/pulls/<n>/reviews`), its comments
(`gh api repos/{owner}/{repo}/issues/<n>/comments`), the issues (`gh api 'repos/{owner}/{repo}/issues?state=open&creator=<you>'`)
or the open PRs of the branch (`gh api 'repos/{owner}/{repo}/pulls?head=<owner>:<branch>'`) and look for your text
or head SHA; post again only when it is not there. A PATCH of a PR body, adding labels and `git push` (never
`--force`) are idempotent: retry them as they are.

## 6. Confirmation rounds

Owner, 2026-11-13. A short round N covers only the diff since the last head you reviewed (`<old>`), after a
fix commit, a ready fix you gave, or a `sync-branch` merge (`<new>` = the PR head now).

1. Check `git merge-base --is-ancestor <old> <new>`. Then read `git diff <old> <new>` minus what a merge
   brought from `main` (step 3): each of your previous blocking findings is fixed and has its test; nothing
   else changed that you have not reviewed; CI is green on `<new>`.
2. A fresh agent with a narrow brief does it (`pr-pipeline`, «Token economy»): the PR, `<old>`, `<new>`, the
   previous findings.
3. **Merge commit from `sync-branch`**: prove it adds nothing unreviewed by comparing trees. For the merge
   `M` (`M^1` = `<old>`, the branch; `M^2` = the `main` commit): the first output line of
   `git merge-tree --write-tree M^1 M^2` is the tree of a clean merge; compare it with
   `git rev-parse M^{tree}`. Equal → the merge is mechanical: confirm in one line. Different, or a conflict → review only `git diff <that tree> M` (the hand resolution), as in step 1.
4. The verdict names the exact head: `Reviewed head: <new>` (full SHA) and `Previous reviewed head: <old>` at
   the top, the verdict line at the end, as in «5. Report». A later commit needs another confirmation.
5. **Full re-review instead** when: `<old>` is not an ancestor of `<new>` (rebase or force-push); the diff
   adds behaviour, files or criteria beyond the findings and the merge resolution; the requirement view of
   the PR's ID changed in `main` since `<old>`; or the round would cover most of the PR anyway.
