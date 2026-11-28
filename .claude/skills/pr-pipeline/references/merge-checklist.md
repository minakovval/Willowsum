# Merge checklist (step 6, full text)

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-27

Read when you are about to merge. The merge conditions and approvals themselves: AGENTS.md step 7 and
[merge rules](../../../references/merge-rules.md) (including «Merge on Ready, follow up separately»).

6. **Merge** (squash) only when all hold on the **current head SHA**:
   - CI green (a path-skipped job counts as passed, `.claude/references/ci-minutes.md`). Wait for the CI of
     several PRs with one background command, not a turn per PR; read its output when it exits:
     `node tools/pr-rules/merge-ready.mjs --wait <PR> [<PR>…]` polls every 60 s until all check runs of every PR
     are completed, then prints one line per condition and `READY` / `NOT READY` per PR. Every check run must be
     `success` or `skipped` (a head with no check runs yet counts as not finished). Without `--wait` the script
     checks once; it also reports the conditions below on the current head (verdicts, `owner-decision` line,
     `mergeable_state`, sync check) and lists the comments since the last review; `READY` is not the merge itself:
     the lead still applies the rules in this file;
   - the latest `Verdict: Ready` names that exact SHA, and for `sensitive` the latest `Security verdict: Ready`
     too; any later commit needs a re-review of that commit (exception: «The lead confirms a sync itself» below;
     a PR of the tier Документи: «The lead's check of a Документи PR» below);
   - for `owner-decision` PRs the body and the decision log record the owner's decision; cloud or production
     actions need the owner's approval (AGENTS.md step 7);
   - no owner «stop» or question on the PR: you are not subscribed while an agent works on it (SKILL.md step 3), so
     before every merge read its comments (the script lists those since the last review: `READ` lines) and the
     review bodies.
   **Order**: code PRs with Ready before docs PRs (else their syncs repeat, #203); a docs PR with decisions that
   code depends on — at once. Among code PRs, a `sensitive` PR whose verdict is expected within ≈ 1 h merges first
   (the other is synced after it); if not so soon, merge the ready PR at once. While a `sensitive` PR in security
   review or a fix round is open, do not merge ahead of it a PR whose file list intersects its files; merge that
   PR after it, unless it fixes a red `main` or a security issue, or the owner says otherwise.
   **Sync only when needed** (full syncs and their review rounds were the largest waste).
   Before every merge check `mergeable_state` (`dirty` is a conflict, CI
   does not run on it, #249; `unknown` → ask again after a few seconds; the script does it) and run the check below. Sync only when the
   PR conflicts, when GitHub refuses the merge, or when `main` changed since the PR's merge-base any of: the PR's own
   files, `packages/api-contract/**` other than `openapi.json` and `src/schema.ts`, `apps/api/module-rules.json`, or
   migrations of a module the PR touches. `packages/api-contract/openapi.json` and `src/schema.ts` need no sync by
   themselves: «Contract check on main» (`.github/workflows/main-contract-check.yml`) runs `pnpm contract:check` and
   `pnpm typecheck` after every push to `main`, so a broken contract or a client that no longer compiles shows up at
   once as a red `main`. Otherwise merge with `behind_by` > 0, no sync, no confirmation (CI green and the verdicts on the PR's own head as above).
   CI on `main` after every merge catches the rest: **a red `main` is the top priority** — stop merging,
   start `investigate-ci-failure` on `main`, merge again only when `main` is green. The daily check of `main`
   (ADR-0008) stays. Check (from the repository root):
   The check (from the repository root) is part of `node tools/pr-rules/merge-ready.mjs <PR>`; its line reads
   `no sync needed` or `sync: <file> (<reason>)…` (a missing or truncated file list counts as sync).
   `no sync needed` → merge; anything else → the `sync-branch` skill (merge, never rebase), then a confirmation on the
   new head: the lead's own («The lead confirms a sync itself» below) or a round (`review-pr` «6. Confirmation
   rounds»). A branch that updates from `main` with no conflicts and no regenerated files the lead updates itself (as
   #255, #256), otherwise an agent; when a fix round is due anyway, the fix agent syncs (SKILL.md step 4); a
   `sensitive` PR's confirmation round goes to one agent for both verdicts (SKILL.md step 5).
   **The lead confirms only a sync with an unchanged diff.** An author's fix after «Changes requested» is confirmed
   only by a reviewer agent (`review-pr` «6. Confirmation rounds»); the only exception is a fix of a PR not
   labelled `sensitive` that `patch-equal.mjs` reports `equal` to the reviewers' patches (SKILL.md step 5, trial
   2026-11-28). Otherwise a lead's `Verdict: Ready` does not
   count on a head with an author commit after «Changes requested» not covered by a later reviewer agent's verdict.
   **The lead confirms a sync itself**, with no agent, posting a PR **review** (not a comment, so the daily check
   of `main`, ADR-0008, finds a verdict on the merged head): `Reviewed head: <new>`, both SHAs, the command below and
   its output `unchanged`, and `Verdict: Ready` on its own last line. It applies to (any other output, a changed
   diff or conflicts → the usual confirmation round by an agent):
   - **a docs-only PR**: every file passes `isDocsOnly` (`tools/pr-rules/lib/ci-paths.mjs`:
     `docs/`, `design/`, `.claude/`, root `*.md`), no `sensitive` label, and `main`'s changes do not touch its files;
   - **a code PR without `sensitive`**
     whose diff against its merge-base is byte-identical before and after the sync, with CI green on the new head;
   - **a `sensitive` PR** when all hold: every merge since the reviewed head is mechanical (`git merge-tree` = the commit's tree) and
     nothing else was committed, the patch-id of the PR's diff against `main` is unchanged, no file `main` brought
     is among the PR's files, CI is green on the new head, **and** `main` brought no foundation file
     ([merge rules](../../../references/merge-rules.md), «Foundation files»). Run the second command below too; it
     must print `ok`. The lead posts **two** reviews on the new head (`Verdict: Ready`, then `Security verdict:
     Ready`), each with both SHAs and the output of both commands, and adds one line to the PR body: «Синхронізацію
     підтвердив ведучий: механічна, patch-id незмінний, без перетину, без файлів фундаменту, CI зелена (`<new>`)».
     Any condition not met → a full re-review (SKILL.md step 5).
   `old` = the reviewed head, `new` = the head after the sync, both fetched:
   `node tools/pr-rules/merge-ready.mjs --sync-check <old> <new>` (fetches `origin/main`) prints `unchanged` or `changed`.
   It compares the PR's full diff, with full blob hashes, before and after the sync: identical only when the file
   set, the base blobs (so `main` did not touch them) and the result blobs all match. CI must still be green on
   `new`. For a `sensitive` PR also run the second command (same `old`, `new`; from the repository root):
   `node tools/pr-rules/merge-ready.mjs --sync-check <old> <new> --sensitive` runs both commands and prints
   `unchanged|changed`, then `ok` or the failed conditions.

   **The lead's check of a Документи PR** (tier Документи, [merge rules](../../../references/merge-rules.md),
   «Review tiers»):
   no review session; the lead reads the diff and posts a PR review on the head with `Reviewed head: <sha>`, this
   list and `Verdict: Ready` on its own last line: every file passes `isDocsOnly` and none is under
   `docs/requirements/`, `.claude/` or `AGENTS.md` (those keep their own review); owner words are quoted exactly as
   given and nothing says «схвалено» beyond them; lead decisions carry the `Рішення ведучого (…; власник не
   схвалював; …)` form; links resolve; «Оновлено» lines are updated; plan rows match the merged PRs.
