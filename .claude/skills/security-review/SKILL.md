---
name: security-review
description: Security review of a Willowsum pull request labelled `sensitive` (auth, permissions, encryption, money, schema, pipeline, infrastructure) — checks the requirement's security properties with tests, mutation testing for critical modules, and posts one review ending in «Security verdict». Use when asked for a security review of a PR. Must run in a different session from the one that wrote the code.
---

# Security review of a sensitive PR

**Створено:** 2026-11-12 · **Оновлено:** 2026-11-13

You are an independent security reviewer. You did not write this code. Your job is to show, with tests,
whether the security properties the requirement claims really hold. This review is separate from the
`review-pr` review and runs in its own session (AGENTS.md, «Process», step 5).

## 0. Scope

- Only PRs labelled `sensitive` (CI sets it and `sensitive:<category>` from file paths) need this review. A PR
  without the label: say so and stop.
- Review the security properties of the requirement the PR claims and of the shared rules it touches
  (AGENTS.md «Hard rules»: data access, privacy, vault, crypto, money). Correctness outside them is for
  `review-pr`.
- **Security properties only** (owner, 2026-11-13): requirement coverage, logic, test naming and style are
  `review-pr`'s; generic checks are CI's. Do not re-run req-check, `--views`, `--coverage`, typecheck, lint,
  formatting or other generic checks, and do not report on them.
- **Light confirmation** (owner, 2026-11-13): when the PR is `sensitive` only because test titles or comments
  changed in sensitive paths (no logic), confirm that with a diff check instead of a full review: for every
  sensitive file, `git diff origin/main...<head> -- <file>` shows only changed test titles (`describe` / `it` /
  `test` strings) or comment lines, and the same file with those lines stripped is unchanged
  (`git diff -G'.' --word-diff` helps). A title counts only as the literal string argument: no change to the
  call itself (`.skip`, `.only`, `.todo`, `.fails`, `.each`, `.concurrent`, `.runIf`/`.skipIf`, a new or removed
  `it`/`describe`) and no `${…}` expression in it. A comment counts only when it is not a directive: any added,
  removed or changed `eslint-disable`/`eslint-enable`/`eslint `/`global`, `@ts-ignore`/`@ts-expect-error`/
  `@ts-nocheck`, `@vitest-environment`/`@jest-environment`, `prettier-ignore`, `gitleaks:allow`, `istanbul` or
  `c8` ignore, `@type`/`@typedef` in a `.js`/`.mjs` file, a shebang, or a `#` line in YAML that is not a comment
  (inside a block scalar) → full review. Then post one short review: «Light confirmation: only test titles /
  comments in <files>», `Reviewed head: <SHA>` and the verdict line. Any logic, assertion, fixture or
  configuration change in a sensitive path → full review.
- The owner decision and the owner's approval for cloud or production are checked by `review-pr`, not here.
- **Round 2** checks only the fixes and your own round-1 findings (the diff since the head you last
  reviewed). At most two rounds (see «7. Rounds»).

## 1. Load

1. `AGENTS.md` «Hard rules» and «Process», step 5–7.
2. The requirement file (for a card: the slice of the target release), before the PR body.
3. The PR: labels, head SHA (`gh pr view <n> --json headRefOid,labels`), the diff, CI status.
4. The module card(s) and only the code the diff touches, plus the guards it relies on.

## 2. Work in isolation

- Your own git worktree in the session scratchpad on the PR head:
  `git worktree add <scratchpad>/pr<n>-sec/worktree <head SHA>`; `pnpm install --frozen-lockfile` there.
- Your own database: `pnpm db:test`; integration tests only as
  `pnpm db:test run -- pnpm --filter @willowsum/api exec vitest run --config vitest.integration.config.ts <files>`
  (roles are shared by the cluster; the command queues runs, `infra/local/README.md`).
- No Docker (cloud sessions): `pnpm db:test` fails unless the admin URL is given:
  `WS_TEST_PG_ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres pnpm db:test run -- pnpm --filter @willowsum/api exec vitest run --config vitest.integration.config.ts <files>`.
- **Rely on CI for the full suites** (owner, 2026-11-13): do not rerun the full suites (`pnpm test`,
  `pnpm test:integration`, `pnpm test:e2e`, all of `tools/*`): CI runs them on the head. Run only the tests of the
  files the PR touches, plus mutation testing (critical modules), browser checks and targeted checks of a path you
  suspect. The review states in one line what it relied on CI for: the jobs and their result on the reviewed head
  («CI relied on: requirements, web, api, e2e — green on <SHA>»; a job not finished or red is named as such).
- Servers, databases and background processes: only your slot's ports, your own `pnpm db:test` databases and
your own PIDs — [own ports](../../references/own-ports.md) (read when you start any of them).
- Scratchpad files (owner, 2026-11-13): only under a prefix or subfolder unique to the PR and role
  (`pr153-sec/`: worktree, tests, patches, review text), never a generic name like `body.md`.

## 3. Properties → tests

Build a table: every security property (from the requirement's FR/AC and the hard rules the PR touches) →
the test that proves it → the mutant that test kills. Examples: a member of another household gets 404, not
403, and no counts; a wrong password and an unknown user give the same answer and timing class; an amount
never passes through a JS `number`; a secret never reaches a log line.

A property without a test that fails when the guard is removed is a gap. Write the missing test.

## 4. Mutation testing and output files

Critical modules only (data isolation, money, authentication, encryption): weaken one guard at a time, run
the relevant suite, restore, and write a test for every survivor; defects as `it.fails` plus a verified patch,
all in scratchpad files with `// ===== FILE: <path> =====` headers and no secret-shaped literals —
[procedure](references/mutation-and-output.md) (read when you mutate or hand over tests and patches).

## 6. Report

Post **one** review with event `COMMENT` (not «approve» or «request changes»):

- the head commit reviewed, full SHA, at the top;
- the table property → test → mutant (killed / survivor → new test);
- **Blocking** — only a security bypass, data loss or leak, or a violation of a security property the PR's
  requirement claims; each with file:line, the failing path, the `it.fails` test and the patch file;
- **Non-blocking** — everything else (the author lists it under «Follow-ups»);
- where the output files are (scratchpad path) and how to apply them.

Post the review as one comment of this shape (a combined short re-review confirmation with the `review-pr`
review carries both verdict lines, each on its own line):

```
Reviewed head: <full SHA>

<findings: table property → test → mutant, Blocking, Non-blocking, output file paths>

Security verdict: Ready

---
_Generated by [Claude Code](https://claude.ai/code)_
```

When something blocks, the verdict line is `Security verdict: Changes requested` instead.

The last two lines of the review are exactly the verdict and the footer:

```
Security verdict: Ready
---
_Generated by [Claude Code](https://claude.ai/code)_
```

(or `Security verdict: Changes requested` when anything is blocking). The verdict line stands on its own
line, outside quotes and code. Never write «Схвалюю» or «Approved». The daily check (ADR-0008) reads this line
and compares the SHA with the merged head.

GitHub 502 / 503 / «token store unavailable» → [retry rules](../../references/github-errors.md) (read when it
happens: retry with backoff; check that a review, comment, issue or PR did not land before posting it again).

## 7. Rounds

- Round 2: only the fixes and your round-1 findings, on the new head SHA.
- If something blocking remains after round 2: give a ready fix with its test, verdict
  `Security verdict: Changes requested`; after the author applies it, confirm that fix briefly, with a verdict
  that names the final head SHA.
- **Confirmation round** (owner, 2026-11-13; after a fix commit, your ready fix or a `sync-branch` merge):
  follow `review-pr` «6. Confirmation rounds» — the diff since your last reviewed head only; a merge commit
  proven mechanical by the tree comparison (the first output line of `git merge-tree --write-tree M^1 M^2`
  equals `git rev-parse M^{tree}`) is confirmed in one line, otherwise review only the hand resolution;
  `Reviewed head: <new>` and `Previous reviewed head: <old>` at the top. Re-run the mutants only for guards the diff touches.
- A full security review instead when the history was rewritten, the diff adds a guard, endpoint, query or
  sensitive path beyond the findings, or the PR gained a `sensitive:<category>` since your last review.

## 8. Clean up

Remove your worktree (`git worktree remove --force <path>`), drop your databases (`pnpm db:test list`,
`pnpm db:test drop <name>`), and make sure no mutant was committed or pushed. Return a short report
to the lead: 10–15 lines, no narrative (owner, 2026-11-13) — PR, reviewed head SHA (full), security verdict,
blocking items with file:line, output file paths, owner questions. Details stay in the review.
