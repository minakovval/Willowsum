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
3. The requirement: `node tools/req-check/index.mjs --show <ID>@<release>` (the view of the target release,
   its dependencies, the decisions that cite it, its coverage line), not the source `<ID>.md`, which merges
   every release; for one not migrated yet, its single file. Plus only the sections of `docs/requirements/00-general.md` it
   relies on.

Read the requirement **before** the PR body, so the author's framing does not anchor you.

**Scope on a `sensitive` PR** (owner, 2026-11-13): you cover the requirement (FR, AC, EC and their tests), the
logic and the tests. Security properties (data isolation, authentication, permissions, encryption, secrets,
money guards) are the `security-review` session's: do not duplicate its work; a security suspicion you notice
goes into your review as one pointer line for that reviewer, not as your own finding. The owner decision and
the owner's approval for cloud or production stay with you on every PR (the security reviewer does not check
them). On a PR without the label
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

Go through [the full checklist](references/hard-rules-checklist.md) (read at every review; it lists the
blocking cases of each area): money (no floats, dated rates), plans (entitlement interface, `402`), scope and
roles (no leak of out-of-scope records, counts or sums), audit, privacy, vault, security, module boundaries,
design before code, UI states and i18n, ledger (ARC-11), module card, **owner decision and the owner's approval
for cloud or production** (checked here, also on `sensitive` PRs; lead, follow-up of #166), tests never skipped
or weakened, requirement changes (`--impact`, sources only, views regenerated, traceability files never
committed), new dependencies justified.



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

Servers, databases and background processes: only your slot's ports, your own `pnpm db:test` databases and
your own PIDs — [own ports](../../references/own-ports.md) (read when you start any of them).

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

GitHub 502 / 503 / «token store unavailable» → [retry rules](../../references/github-errors.md) (read when it
happens: retry with backoff; check that a review, comment, issue or PR did not land before posting it again).

## 6. Confirmation rounds

A short round covers only the diff since the head you last reviewed; a `sync-branch` merge is proven
mechanical by a tree comparison; the verdict names the new head. Procedure and when a full re-review is due:
[confirmation rounds](references/confirmation-rounds.md) (read when you confirm a fix or a merge).

