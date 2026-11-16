# Merge checklist (step 6, full text)

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-16

Read when you are about to merge. The merge conditions and approvals themselves: AGENTS.md step 7 and
[merge rules](../../../references/merge-rules.md) (including «Merge on Ready, follow up separately»).

6. **Merge** (squash): the lead merges only when all hold on the **current head SHA** — both verdicts Ready
   on that exact head (`review-pr`, and `security-review` for `sensitive`) and CI green (owner, 2026-11-13):
   - CI green (a path-skipped job counts as passed, `.claude/references/ci-minutes.md`). Wait for the CI of
     several PRs with one command, not a turn per PR (owner, 2026-11-13); run it in the background and read
     its output when it exits:
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
   - the latest `Verdict: Ready` names that exact SHA; for `sensitive`, the latest `Security verdict: Ready`
     names it too; any later commit needs a re-review of that commit (a docs-only sync: «Docs-only PR after a
     sync» below);
   - for `owner-decision` PRs: the body records the owner's decision (and the decision log has it); cloud or
     production actions: the owner's approval (AGENTS.md step 7);
   - the owner has not commented «stop» or asked a question on the PR: the lead is not subscribed while an agent
     works on it (SKILL.md step 3), so before every merge read its comments (owner, 2026-11-14, #178),
     `gh api repos/{owner}/{repo}/issues/<n>/comments --jq '.[] | [.user.login, .created_at, .body[0:200]] | @tsv'`,
     and the review bodies.
   **Order** (owner, 2026-11-14/15, #178, #265): code PRs with Ready before docs PRs (otherwise their syncs and
   confirmations repeat, #203); a docs PR with decisions that code depends on — at once. Among code PRs, a
   `sensitive` PR whose verdict is expected within ≈ 1 h merges first, and the PR without `sensitive` is synced
   after it; if that verdict is not expected so soon, merge the ready PR at once.
   **Up to date** (owner, 2026-11-15, #178): before every merge, check that the branch is not behind `main`:
   `gh api repos/{owner}/{repo}/compare/main...<head-sha> --jq .behind_by` must print `0`; a «clean» mergeable
   state does not mean the branch is up to date. Check `mergeable_state` with it:
   `gh api repos/{owner}/{repo}/pulls/<n> --jq .mergeable_state`; `dirty` means a conflict, and on a conflicting
   PR CI does not run (#249); `unknown` → ask again after a few seconds.
   Branch behind (`behind_by` > 0) or conflicting with `main` → the `sync-branch` skill (merge, never rebase),
   then a confirmation round on the merge (`review-pr` «6. Confirmation rounds»: tree comparison, verdict on the
   new head). A branch that updates from `main` with no conflicts and no regenerated files the lead updates itself
   (as with #255 and #256), then the usual confirmation; otherwise an agent does it (owner, 2026-11-15, #178). When
   a fix round is due anyway, the fix agent does the sync (SKILL.md step 4). A confirmation of a `sensitive` PR
   goes to one agent for both verdicts (SKILL.md step 5).
   **Code PR after a sync, lead confirms** (owner, 2026-11-16, «1 а»; [log](../../../../docs/decisions/log/2026-11-16-owner-sync-confirm-215.md)): the lead confirms a code PR's
   sync itself, with no agent, when the PR's diff against its merge-base is byte-identical before and after the sync
   (the command in the next paragraph) and CI on the new head is green. When the diff changed or there were
   conflicts, an agent confirms. The lead posts the result as a review with the same content as for a docs-only PR
   (below). A `sensitive` PR whose verdict is not Ready on the old head is not covered.
   **Docs-only PR after a sync** (owner, 2026-11-13, #178): a PR whose every file is docs-only (`isDocsOnly`,
   [token economy](token-economy.md) item 1: `docs/`, `design/`, `.claude/`, root `*.md`) and not labelled
   `sensitive` needs no confirmation agent when `main`'s changes do not touch its files. The lead checks it
   with one command (`old` = the reviewed head, `new` = the head after the sync, both fetched). When it prints
   `unchanged`, the lead posts a PR **review** (not a comment, so the daily check of `main`, ADR-0008, finds a
   verdict on the merged head): `Reviewed head: <new>`, both SHAs, the command and its output `unchanged`, and
   `Verdict: Ready` on its own last line. Any other output → the usual confirmation round.
   ```bash
   old=<reviewed-head>; new=<synced-head>; git fetch -q origin main
   ob=$(git merge-base origin/main "$old"); nb=$(git merge-base origin/main "$new")
   [ -n "$(git diff --name-only "$ob" "$old")" ] \
     && diff <(git diff --full-index --binary "$ob" "$old") <(git diff --full-index --binary "$nb" "$new") >/dev/null \
     && echo unchanged || echo changed
   ```
   It compares the PR's full diff, with full blob hashes, before and after the sync: they are byte-for-byte the
   same only when the file set, the base blobs (so `main` did not touch them) and the result blobs all match. CI
   must still be green on `new` and `behind_by` must be `0`.
