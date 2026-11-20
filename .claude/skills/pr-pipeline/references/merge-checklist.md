# Merge checklist (step 6, full text)

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-19

Read when you are about to merge. The merge conditions and approvals themselves: AGENTS.md step 7 and
[merge rules](../../../references/merge-rules.md) (including «Merge on Ready, follow up separately»).

6. **Merge** (squash) only when all hold on the **current head SHA**:
   - CI green (a path-skipped job counts as passed, `.claude/references/ci-minutes.md`). Wait for the CI of
     several PRs with one background command, not a turn per PR; read its output when it exits:
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
     too; any later commit needs a re-review of that commit (exception: «The lead confirms a sync itself» below;
     a PR of the tier Документи: «The lead's check of a Документи PR» below);
   - for `owner-decision` PRs the body and the decision log record the owner's decision; cloud or production
     actions need the owner's approval (AGENTS.md step 7);
   - no owner «stop» or question on the PR: you are not subscribed while an agent works on it (SKILL.md step 3), so
     before every merge read its comments,
     `gh api repos/{owner}/{repo}/issues/<n>/comments --jq '.[] | [.user.login, .created_at, .body[0:200]] | @tsv'`,
     and the review bodies.
   **Order**: code PRs with Ready before docs PRs (otherwise their syncs and
   confirmations repeat, #203); a docs PR with decisions that code depends on — at once. Among code PRs, a
   `sensitive` PR whose verdict is expected within ≈ 1 h merges first and the PR without `sensitive` is synced
   after it; if that verdict is not expected so soon, merge the ready PR at once.
   **Sync only when needed** (full syncs and their review rounds were the largest waste).
   Before every merge check `gh api repos/{owner}/{repo}/pulls/<n> --jq .mergeable_state` (`dirty` is a conflict, CI
   does not run on it, #249; `unknown` → ask again after a few seconds) and run the check below. Sync only when the
   PR conflicts, when GitHub refuses the merge, or when `main` changed since the PR's merge-base any of: the PR's own
   files, `packages/api-contract/**` other than `openapi.json` and `src/schema.ts`, `apps/api/module-rules.json`, or
   migrations of a module the PR touches. `packages/api-contract/openapi.json` and `packages/api-contract/src/schema.ts`
   no longer require a sync by themselves: the workflow «Contract check on main»
   (`.github/workflows/main-contract-check.yml`) runs `pnpm contract:check` and `pnpm typecheck` after every push to `main`, so a broken
   contract or a client that no longer compiles shows up at once as a red `main` (owner, 2026-11-20). Otherwise merge with `behind_by` > 0, no sync and no confirmation (CI green and the verdicts on the PR's own head
   as above). CI on `main` after every merge catches the rest: **a red `main` is the top priority** — stop merging,
   start `investigate-ci-failure` on `main`, merge again only when `main` is green. The daily check of `main`
   (ADR-0008) stays. Check (from the repository root):
   ```bash
   n=<PR>; head=<head-sha>; d=$(mktemp -d)
   gh api "repos/{owner}/{repo}/compare/$head...main" \
     --jq '[(.files | length), (.files[] | .filename, (.previous_filename // empty))] | @tsv' > "$d/main.tsv"
   gh api "repos/{owner}/{repo}/pulls/$n/files?per_page=100" --paginate \
     --jq '.[] | .filename, (.previous_filename // empty)' > "$d/pr.txt"
   node --input-type=module -e '
   import fs from "node:fs";
   const d = process.argv[1], [count, ...main] = fs.readFileSync(`${d}/main.tsv`, "utf8").trim().split("\t");
   const pr = new Set(fs.readFileSync(`${d}/pr.txt`, "utf8").split("\n").filter(Boolean));
   const mod = (f) => /^apps\/api\/src\/modules\/([^/]+)\//.exec(f)?.[1];
   const mods = new Set([...pr].map(mod).filter(Boolean));
   const why = (f) => pr.has(f) ? "PR file" : f.startsWith("packages/api-contract/") && !["packages/api-contract/openapi.json", "packages/api-contract/src/schema.ts"].includes(f) ? "api-contract"
     : f === "apps/api/module-rules.json" ? "module-rules" : f.includes("/migrations/") && mods.has(mod(f)) ? "migration" : "";
   const bad = main.filter(why).map((f) => `${f} (${why(f)})`);
   console.log(!/^\d+$/.test(count) || +count >= 300 ? "sync: no or truncated file list"
     : bad.length ? `sync: ${bad.join(" ")}` : "no sync needed");' "$d"
   ```
   `no sync needed` → merge; anything else → the `sync-branch` skill (merge, never rebase), then a confirmation on the
   new head: the lead's own («The lead confirms a sync itself» below) or a round (`review-pr` «6. Confirmation
   rounds»). A branch that updates from `main` with no conflicts and no regenerated files the lead updates itself (as
   #255, #256), otherwise an agent; when a fix round is due anyway, the fix agent syncs (SKILL.md step 4); a
   `sensitive` PR's confirmation round goes to one agent for both verdicts (SKILL.md step 5).
   **The lead confirms only a sync with an unchanged diff.** An author's fix after «Changes requested» is confirmed
   only by a reviewer agent (`review-pr` «6. Confirmation rounds»), no exceptions; a lead's `Verdict: Ready` does not
   count on a head that holds an author commit made after «Changes requested» and not covered by a later reviewer
   agent's verdict; the lead's own confirmation of a sync with an unchanged diff (below) stays.
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
   ```bash
   old=<reviewed-head>; new=<synced-head>; git fetch -q origin main
   ob=$(git merge-base origin/main "$old"); nb=$(git merge-base origin/main "$new")
   [ -n "$(git diff --name-only "$ob" "$old")" ] \
     && diff <(git diff --full-index --binary "$ob" "$old") <(git diff --full-index --binary "$nb" "$new") >/dev/null \
     && echo unchanged || echo changed
   ```
   It compares the PR's full diff, with full blob hashes, before and after the sync: identical only when the file
   set, the base blobs (so `main` did not touch them) and the result blobs all match. CI must still be green on
   `new`. For a `sensitive` PR also (same `old`, `new`, `ob`, `nb`; from the repository root):
   ```bash
   bad=""; [ -z "$(git rev-list --first-parent --no-merges "$old..$new")" ] || bad="$bad non-merge-commit"
   for m in $(git rev-list --first-parent --merges "$old..$new"); do
     [ "$(git merge-tree --write-tree "$m^1" "$m^2" | head -1)" = "$(git rev-parse "$m^{tree}")" ] || bad="$bad not-mechanical:$m"; done
   p1=$(git diff "$ob" "$old" | git patch-id --stable | cut -d' ' -f1); p2=$(git diff "$nb" "$new" | git patch-id --stable | cut -d' ' -f1)
   [ -n "$p1" ] && [ "$p1" = "$p2" ] || bad="$bad patch-id"
   [ -z "$(comm -12 <(git diff --no-renames --name-only "$ob" "$nb" | sort) <(git diff --no-renames --name-only "$ob" "$old" | sort))" ] || bad="$bad overlap"
   f=$(git diff --no-renames --name-only "$ob" "$nb" | node --input-type=module -e '
   import fs from "node:fs"; import { globToRegExp } from "./tools/pr-rules/lib/paths.mjs";
   const md = fs.readFileSync(".claude/references/merge-rules.md", "utf8");
   const res = /```foundation-paths\n([\s\S]*?)```/.exec(md)[1].split("\n").filter(Boolean).map(globToRegExp);
   console.log(fs.readFileSync(0, "utf8").split("\n").filter((p) => p && res.some((r) => r.test(p))).join(" "));')
   [ -z "$f" ] || bad="$bad foundation:$f"
   echo "${bad:-ok}"
   ```

   **The lead's check of a Документи PR** (tier Документи, [merge rules](../../../references/merge-rules.md),
   «Review tiers»):
   no review session; the lead reads the diff and posts a PR review on the head with `Reviewed head: <sha>`, this
   list and `Verdict: Ready` on its own last line: every file passes `isDocsOnly` and none is under
   `docs/requirements/`, `.claude/` or `AGENTS.md` (those keep their own review); owner words are quoted exactly as
   given and nothing says «схвалено» beyond them; lead decisions carry the `Рішення ведучого (…; власник не
   схвалював; …)` form; links resolve; «Оновлено» lines are updated; plan rows match the merged PRs.
