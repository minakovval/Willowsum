# Merge checklist (step 6, full text)

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-16

Read when you are about to merge. The merge conditions and approvals themselves: AGENTS.md step 7 and
[merge rules](../../../references/merge-rules.md) (including «Merge on Ready, follow up separately»).

6. **Merge** (squash) only when all hold on the **current head SHA** (owner, 2026-11-13):
   - CI green (a path-skipped job counts as passed, `.claude/references/ci-minutes.md`). Wait for the CI of
     several PRs with one background command, not a turn per PR (owner, 2026-11-13); read its output when it exits:
     ```bash
     shas="<head-sha-1> <head-sha-2> <head-sha-3>"
     while :; do left=0
       for s in $shas; do
         n=$(gh api "repos/{owner}/{repo}/commits/$s/check-runs?per_page=100" \
               --jq 'if (.check_runs | length) == 0 then 1
                     else [.check_runs[] | select(.status != "completed")] | length end') || n=1
         left=$((left + ${n:-1})); done
       [ "$left" -eq 0 ] && break; sleep 60; done
     for s in $shas; do gh api "repos/{owner}/{repo}/commits/$s/check-runs?per_page=100" \
       --jq '.check_runs[] | [.head_sha[0:7], .name, .conclusion] | @tsv'; done
     ```
     Every line must read `success` or `skipped` (a head with no check runs yet counts as not finished);
   - the latest `Verdict: Ready` names that exact SHA, and for `sensitive` the latest `Security verdict: Ready`
     too; any later commit needs a re-review of that commit (exceptions: «Quiet `main`» and «The lead confirms a
     sync itself» below);
   - for `owner-decision` PRs the body and the decision log record the owner's decision; cloud or production
     actions need the owner's approval (AGENTS.md step 7);
   - no owner «stop» or question on the PR: you are not subscribed while an agent works on it (SKILL.md step 3), so
     before every merge read its comments (owner, 2026-11-14, #178),
     `gh api repos/{owner}/{repo}/issues/<n>/comments --jq '.[] | [.user.login, .created_at, .body[0:200]] | @tsv'`,
     and the review bodies.
   **Order** (owner, 2026-11-14/15, #178, #265): code PRs with Ready before docs PRs (otherwise their syncs and
   confirmations repeat, #203); a docs PR with decisions that code depends on — at once. Among code PRs, a
   `sensitive` PR whose verdict is expected within ≈ 1 h merges first and the PR without `sensitive` is synced
   after it; if that verdict is not expected so soon, merge the ready PR at once.
   **Up to date** (owner, 2026-11-15, #178): before every merge `gh api repos/{owner}/{repo}/compare/main...<head-sha>
   --jq .behind_by` must print `0` (a «clean» mergeable state does not mean up to date), except for «Quiet `main`»
   below. Check `gh api repos/{owner}/{repo}/pulls/<n> --jq .mergeable_state` with it: `dirty` is a conflict (CI
   does not run on it, #249); `unknown` → ask again after a few seconds. Behind or conflicting → the `sync-branch`
   skill (merge, never rebase), then a confirmation round on the new head (`review-pr` «6. Confirmation rounds»).
   A branch that updates from `main` with no conflicts and no regenerated files the lead updates itself (as #255,
   #256), otherwise an agent; when a fix round is due anyway, the fix agent syncs (SKILL.md step 4); a `sensitive`
   PR's confirmation goes to one agent for both verdicts (SKILL.md step 5) (owner, 2026-11-15, #178).
   **Quiet `main`** (owner, 2026-11-16, process review 15, proposal 1): a PR, `sensitive` or not, may merge with
   `behind_by` > 0 — no sync and no confirmation — when every file changed on `main` since its merge-base passes
   `isDocsOnly`, none is under `docs/requirements/` and none is among the PR's files. In doubt, sync as usual. The
   daily check of `main` (ADR-0008) and CI on `main` after the merge stay. Check (from the repository root):
   ```bash
   n=<PR>; head=<head-sha>; d=$(mktemp -d)
   gh api "repos/{owner}/{repo}/compare/$head...main" \
     --jq '[(.files | length), (.files[] | .filename, (.previous_filename // empty))] | @tsv' > "$d/main.tsv"
   gh api "repos/{owner}/{repo}/pulls/$n/files?per_page=100" --paginate \
     --jq '.[] | .filename, (.previous_filename // empty)' > "$d/pr.txt"
   node --input-type=module -e '
   import fs from "node:fs"; import { isDocsOnly } from "./tools/pr-rules/lib/ci-paths.mjs";
   const d = process.argv[1], [count, ...main] = fs.readFileSync(`${d}/main.tsv`, "utf8").trim().split("\t");
   const pr = new Set(fs.readFileSync(`${d}/pr.txt`, "utf8").split("\n").filter(Boolean));
   const bad = main.filter((f) => !isDocsOnly(f) || f.startsWith("docs/requirements/") || pr.has(f));
   console.log(!/^\d+$/.test(count) || +count >= 300 ? "sync: no or truncated file list"
     : bad.length ? `sync: ${bad.join(" ")}` : "quiet");' "$d"
   ```
   `quiet` → merge (CI green and the verdicts on the PR's own head as above); anything else, or a merge GitHub
   refuses, → sync.
   **The lead confirms a sync itself**, with no agent, posting a PR **review** (not a comment, so the daily check
   of `main`, ADR-0008, finds a verdict on the merged head): `Reviewed head: <new>`, both SHAs, the command below and
   its output `unchanged`, and `Verdict: Ready` on its own last line. It applies to (any other output, a changed
   diff or conflicts → the usual confirmation round by an agent):
   - **a docs-only PR** (owner, 2026-11-13, #178): every file passes `isDocsOnly` (`tools/pr-rules/lib/ci-paths.mjs`:
     `docs/`, `design/`, `.claude/`, root `*.md`), no `sensitive` label, and `main`'s changes do not touch its files;
   - **a code PR without `sensitive`** (owner, 2026-11-16, «1 а», [log](../../../../docs/decisions/log/2026-11-16-owner-sync-confirm-215.md))
     whose diff against its merge-base is byte-identical before and after the sync, with CI green on the new head.
     A PR labelled `sensitive` is excluded (owner, 2026-11-16, «1 а», [log](../../../../docs/decisions/log/2026-11-16-owner-sensitive-sync-language-card.md)):
     its confirmation stays with one agent for both verdicts (SKILL.md step 5).
   `old` = the reviewed head, `new` = the head after the sync, both fetched:
   ```bash
   old=<reviewed-head>; new=<synced-head>; git fetch -q origin main
   ob=$(git merge-base origin/main "$old"); nb=$(git merge-base origin/main "$new")
   [ -n "$(git diff --name-only "$ob" "$old")" ] \
     && diff <(git diff --full-index --binary "$ob" "$old") <(git diff --full-index --binary "$nb" "$new") >/dev/null \
     && echo unchanged || echo changed
   ```
   It compares the PR's full diff, with full blob hashes, before and after the sync: identical only when the file
   set, the base blobs (so `main` did not touch them) and the result blobs all match. CI must still be green on
   `new` and `behind_by` must be `0` (or «Quiet `main`» holds).
