---
name: review-pr
description: Review a Willowsum pull request against its requirement file in docs/requirements/ and the hard rules in AGENTS.md. Use when asked to review a PR or branch that implements a requirement ID. Must run in a different session from the one that wrote the code.
---

# Review a requirement PR

**Створено:** 2026-11-01 · **Оновлено:** 2026-11-27

You are an independent reviewer. You did not write this code. Your job is to find what is wrong or
missing, not to confirm the author's summary.

## 1. Load

1. `AGENTS.md` (hard rules, Definition of Done).
2. The requirement, **before** the PR body: `node tools/req-check/index.mjs --show <ID>@<release>` (the view of
   the target release, its dependencies, decisions and coverage line), not the source `<ID>.md`; for a
   requirement not migrated yet, its single file. Plus only the `docs/requirements/00-general.md` sections it
   relies on. The ID is in the PR title.
3. The PR: title, body, diff, CI status. Read the rest of the module only when a finding needs it.

**Scope on a `sensitive` PR**: you cover the requirement (FR, AC, EC and their tests), the logic and the tests.
Security properties (data isolation, authentication, permissions, encryption, secrets, money guards) and mutation
testing are the `security-review` session's: a security suspicion you notice goes into your review as one pointer
line for that reviewer, not as your own finding. The owner decision and the owner's approval for cloud or
production stay with you on every PR. On a PR without the label you check the hard rules in full (§3).

**Re-review**: only the fixes and your own previous findings — the diff since the head you last reviewed (§6).
At most two rounds (§5).

Scratchpad files: only under a prefix unique to the PR and role (`pr153-review/`), never a generic name like
`body.md`. You do not edit the PR body, except «Reviewer patches» (§7).

## 2. Check coverage

Build a table: every acceptance criterion and edge case of the requirement → the test that covers it → does the
test assert the behaviour (not just render)? Missing or weak rows are findings. Start from
`node tools/req-check/index.mjs --coverage` (tests named by item, e.g. `BUD-03@PoC AC2`), then read the tests.
- A test named by a number that is not the item it tests is non-blocking unless it hides a missing criterion.
- A test must not re-read `Date.now()` to choose a time window (rate limits, expiry): it fixes the time once or
  injects a clock.
- If the PR covers only part of the requirement, the body must say which criteria are left.
- Mutation testing: never on a `sensitive` PR (the `security-review` session does it), and do not ask for it
  outside critical modules (data isolation, money, authentication, encryption).

## 3. Check the hard rules

A finding is blocking only if it is a security bypass, data loss or leak, or a violation of the requirement
the PR claims (its FR/AC) or of a shared rule (AGENTS.md, П-rules). Everything else is non-blocking.

Go through [the full checklist](references/hard-rules-checklist.md) (read at every review; it lists the
blocking cases of each area): money, plans, scope and roles, audit, privacy, vault, security, module boundaries,
design before code, UI states and i18n, ledger (ARC-11), module card, **owner decision and the owner's approval
for cloud or production** (also on `sensitive` PRs), tests never skipped or weakened, requirement changes
(`--impact`, sources only, views regenerated, traceability files never committed), new dependencies justified.

**UI texts** (a PR that changes `packages/i18n/src/messages/uk.ts`, `apps/web` or `packages/ui`): each new or
changed `uk.ts` string equals, word for word, the chosen text of its screen's «Тексти» block on the canvas (live,
or the snapshot the PR body names); a text the author added there as «варіант від агента, потребує погодження» is
listed in the PR body; `en.ts` translates `uk.ts`; the PR adds no UI text to requirement sources. A screen with no
«Тексти» block yet: the author moves the texts there in this PR. A mismatch breaks the shared rule
(`docs/design/ARTIFACTS.md`, «Тексти інтерфейсу: канва — єдине джерело») and is blocking.

**UI screenshot** (a PR that changes a screen or a shared UI component; rule:
[screen-from-canvas](../screen-from-canvas/SKILL.md) §6): open the 1280 px screenshot whose path the PR body
gives and compare it with the canvas board named in the requirement or card: long names and texts wrap or
truncate as on the board, nothing is one letter per line, overlapped or cut off. Blocking: a missing screenshot
(no path in the body, a file that does not open, not made by the Playwright step, or without long texts) and a
layout break visible in it.

## 4. Verify, do not speculate

For each suspected defect, trace a concrete path (input or caller → wrong result); run the relevant tests if
needed. Drop findings you cannot support.
- Before tests: `pg_lsclusters`; if the cluster is down, `pg_ctlcluster 16 main start`.
- Integration tests and load probes that need the database: only through `pnpm db:test run -- …`, each on its
  own database, never a hand-made one. Cloud sessions have no Docker, so give the admin URL:
  `WS_TEST_PG_ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres pnpm db:test run -- pnpm --filter @willowsum/api exec vitest run --config vitest.integration.config.ts <files>`
  (`infra/local/README.md`).
- **Rely on CI for the full suites**: do not rerun `pnpm test`, `pnpm test:integration`, `pnpm test:e2e` or all
  of `tools/*`. Run only the tests of the files the PR touches, browser checks and targeted checks of a path you
  suspect. The review states in one line what it relied on CI for («CI relied on: requirements, web, api, e2e —
  green on <SHA>»; a job not finished or red is named as such). Red CI is a finding only when the change caused it.
- Servers, databases and background processes: only your slot's ports, your own `pnpm db:test` databases and
  your own PIDs — [own ports](../../references/own-ports.md) (read when you start any of them).

## 5. Report

Post **one** PR review on the head, never an issue comment: write the text to your scratchpad file and run
`gh api repos/{owner}/{repo}/pulls/<n>/reviews -f commit_id=<head SHA> -f event=COMMENT -F body=@<file>`
(`-F` sends the file's text). The same for every confirmation round. Shape:

```
Reviewed head: <full SHA>

<findings: Blocking, Non-blocking, coverage table, questions>

Verdict: Ready

---
_Generated by [Claude Code](https://claude.ai/code)_
```

- **Blocking** — only as defined in §3; each with file:line and the failing path.
- **Non-blocking** — everything else. It is a follow-up only when it is about money, data or security, or
  breaks a requirement item: the author lists it under «Follow-ups» in the PR body and the lead opens the issue.
  Anything smaller the author fixes in the same fix round; with no fix round you apply it per §7 (within its
  limits), or it is not recorded. Non-blocking items never start a new round by themselves. Only in the tier
  Фундамент you may mark an item «cheap and safe to fold in»; the lead decides ([merge rules](../../references/merge-rules.md)).
- A recurring class of finding: propose the CI check or test that would catch it (non-blocking).
- A blocking finding you can fix: give the verified patch and its test (in the review or a scratchpad file the
  review names), so the fix agent applies it as given.
- The coverage table.
- Questions for the owner only where the requirement itself is unclear on a real product question; small details
  the author decided and recorded are not owner questions.
- A `sensitive` PR that has had no security review: say so.

**Verdict line**: the last line before the footer, on its own line, never inside quotes or code:
`Verdict: Changes requested` if anything is blocking, otherwise `Verdict: Ready` (a security review ends with
`Security verdict: …` instead; one agent confirming a `sensitive` PR posts two reviews, one per verdict line).
Never write «Схвалюю» or «Approved»: that line is the owner's alone. The lead merges only on a verdict that
names the PR head, so every later commit needs a confirmation (§6; exceptions: `pr-pipeline` merge checklist).

**At most two rounds.** If something blocking remains after round 2, give a ready fix with a test (a patch or
exact code) and `Verdict: Changes requested`; after the author applies it, confirm that fix briefly, with a
verdict that names the final head SHA.

**Report to the lead**, once, at most 5 lines, in this order — `PR: <url> · Head: <full SHA reviewed>`,
`Verdict: Ready` or `Verdict: Changes requested`, `Blocking: <file:line …, or —>`, `Owner questions: <… or —>`,
`Checks: <what you ran>`. Everything else stays in the review.

GitHub 502 / 503 / «token store unavailable» → [retry rules](../../references/github-errors.md) (read when it
happens: retry with backoff; check that a review, comment, issue or PR did not land before posting it again).

## 6. Confirmation rounds

A short round covers only the diff since the head you last reviewed; a `sync-branch` merge is proven
mechanical by a tree comparison; the verdict names the new head. Procedure and when a full re-review is due:
[confirmation rounds](references/confirmation-rounds.md) (read when you confirm a fix or a merge).

## 7. Reviewer patches

The only exception to «review runs in another session» (AGENTS.md step 5); other skills link here. You apply
small patches to the PR branch yourself:
1. Only in tests, texts, comments, docs, markup and screen styles. Never in a sensitive path, tests included
   (`SENSITIVE_PATHS` in `tools/pr-rules/lib/paths.mjs`, e.g. `tools/pr-rules`, migrations, auth), and never in a
   **security test** or a **rule file**: there a small item goes through the normal fix round (you may hand the
   author the ready patch).
   - Security test = a test file (`.test.` or `.spec.`, its snapshot too) whose name starts with `isolation` or
     has a `security` or `sec<N>…` part, with `.it` or without, **or** is one of: `adr0013-append-only.it.test.ts`,
     `bypass.it.test.ts`, `no-network.test.ts`, `no-network-loaded.test.ts`, `guard.it.test.ts`,
     `guard-coverage.it.test.ts`, `guard-gates.it.test.ts`, `leak-check-guard.test.ts`, `leak-text.test.ts`,
     `redaction.test.ts`.
   - Rule file = `AGENTS.md`, `CLAUDE.md`, `CLAUDE.local.md` and `.claude/**`, in any folder and any letter case.
   - E2e tests (`apps/web/e2e/**`) stay allowed.
   - The check is `reviewerPatchViolations` in `tools/pr-rules/lib/reviewer-patches.mjs` (a helper, not in CI:
     check your own commit against this text).
   - A patch never switches a test off, deletes a test file, removes or changes a test, suite or assertion, and
     never adds a directive comment: the list in [security-review](../security-review/SKILL.md) §0 «Light
     confirmation» applies in full (a changed test title is a text patch and stays allowed).
2. One commit per reviewer per round, at the end of the review. At most 60 lines per PR, added plus deleted,
   across all reviewers; anything larger is a normal author fix round.
3. Every patch is listed in the PR body under «Reviewer patches». The verdict names your new head SHA; the lead
   merges only after green CI on that head.
