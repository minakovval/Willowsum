# Merge checklist (step 6, full text)

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-13

Moved out of `pr-pipeline` SKILL.md (owner, 2026-11-13); CI wait and docs-only sync check added (owner, 2026-11-13, #178). Read when you are about to merge.

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
     names it too; any later commit needs a re-review of that commit (a docs-only sync: the lead's check and
     review below, «Docs-only PR after a sync»);
   - for `owner-decision` PRs: the body records the owner's decision (and the decision log has it); cloud or
     production actions: the owner's approval (AGENTS.md step 7);
   - the owner has not commented «stop» or asked a question on the PR.
   For a docs-only PR that moves scope between releases (owner, 2026-11-12), a security review covers only the moved lines that state a protection.
   Do not ask the owner to confirm the merge.
   **Merge on Ready, follow up separately** (owner, 2026-11-13): both verdicts Ready and only non-blocking
   findings left → merge; do not send the non-blocking items back to the implementer for the same PR, since
   that starts another review round. Exception: an item the reviewer marks as cheap and safe to fold in may
   still be added before merge, at your choice; that commit then needs a re-review like any other.
   Before every merge, check that the branch is not behind `main`:
   `gh api repos/{owner}/{repo}/compare/main...<head-sha> --jq .behind_by` must print `0`; a «clean» mergeable
   state does not mean the branch is up to date.
   Branch behind (`behind_by` > 0) or conflicting with `main` → the `sync-branch` skill (merge, never rebase), then a confirmation
   round on the merge (`review-pr` «6. Confirmation rounds»: tree comparison, verdict on the new head).
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
   same only when the file set, the base blobs (so `main` did not touch them) and the result blobs all match. CI must still be green on `new` and `behind_by` must be `0`.
