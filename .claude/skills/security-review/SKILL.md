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
- **Round 2** checks only the fixes and your own round-1 findings (the diff since the head you last
  reviewed). At most two rounds (see «5. Rounds»).

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
- **Own ports, databases and processes** (owner, 2026-11-13): up to 3–4 agents run at once, so the lead gives you
  a slot `k` (1–4; none given → ask, or use 4). Use only your slot: the web dev server
  `pnpm --filter @willowsum/web exec vite --port 517k --strictPort` (5171–5174; preview `--port 417k`), the API with
  `WS_PORT=808k`, and `WS_API_ORIGIN=http://localhost:808k` for the web proxy. Test databases only through
  `pnpm db:test` from your own worktree: their names carry your branch (`ws_t_<branch>_<random>`; `HEAD` in a
  detached worktree, shared with other reviewers); record the names it prints and drop only those. Start a server in the background and record its PID (`echo $! >> <scratchpad>/pr<n>-<role>/pids`); stop only
  your own PIDs (`kill $(cat <scratchpad>/pr<n>-<role>/pids)`), never `pkill`, `killall`, a kill by port or process
  name, or `pnpm local:down` (it stops the shared environment). `pnpm test:e2e` picks free ports by itself.
- Scratchpad files (owner, 2026-11-13): only under a prefix or subfolder unique to the PR and role
  (`pr153-sec/`: worktree, tests, patches, review text), never a generic name like `body.md`.

## 3. Properties → tests

Build a table: every security property (from the requirement's FR/AC and the hard rules the PR touches) →
the test that proves it → the mutant that test kills. Examples: a member of another household gets 404, not
403, and no counts; a wrong password and an unknown user give the same answer and timing class; an amount
never passes through a JS `number`; a secret never reaches a log line.

A property without a test that fails when the guard is removed is a gap. Write the missing test.

## 4. Mutation testing (critical modules only)

Only for data isolation, money, authentication and encryption (owner, 2026-11-12); elsewhere skip it.

1. Weaken one guard at a time (drop a `WHERE household_id`, return early from a permission check, compare
   with `==` instead of a constant-time check, round an amount through `number`).
2. Run only the relevant suite. A mutant that no test kills is a **survivor**.
3. Restore the code (`git checkout -- <file>`) before the next mutant; never leave a mutant in place.
4. For each survivor write a test that kills it.

Defects found: write the test as `it.fails('…', …)` (it documents the defect and passes while the defect
exists) plus a fix patch you verified: with the patch applied the test passes as a plain `it`.

## 5. Output files

Put every test and patch in the session scratchpad (not in the PR branch), in one file per round with a
header per repository file:

```
// ===== FILE: apps/api/test/sec<PR>-<topic>.it.test.ts =====
…
// ===== FILE: apps/api/src/modules/identity/application/sign-in.ts (patch) =====
…
```

No secret-shaped literals (API keys, tokens, private keys, passwords that look real): build test values at
runtime (`randomBytes`, `['not','a','real','value'].join('-')`), so the CI job `secrets` (gitleaks) stays green.
The author applies them with the `fix-review-findings` skill.

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

**GitHub errors** (owner, 2026-11-13): on HTTP 502 or 503, or «token store unavailable», retry with backoff
(wait about 10 s, 30 s, then 90 s; at most 3 retries), then report the failure instead of looping. Before
retrying a call that is not idempotent — posting a review, a comment or an issue, opening a PR — check whether
the first attempt landed: list the PR's reviews (`gh api repos/{owner}/{repo}/pulls/<n>/reviews`), its comments
(`gh api repos/{owner}/{repo}/issues/<n>/comments`), the issues (`gh api 'repos/{owner}/{repo}/issues?state=open&creator=<you>'`)
or the open PRs of the branch (`gh api 'repos/{owner}/{repo}/pulls?head=<owner>:<branch>'`) and look for your text
or head SHA; post again only when it is not there. A PATCH of a PR body, adding labels and `git push` (never
`--force`) are idempotent: retry them as they are.

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
