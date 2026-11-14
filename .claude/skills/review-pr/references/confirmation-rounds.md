# Confirmation rounds («6. Confirmation rounds», full text)

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-14

Moved out of `review-pr` SKILL.md without change (owner, 2026-11-13). Read when you confirm a fix commit, a ready fix you gave or a `sync-branch` merge.

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
   the top, the verdict line at the end, as in «5. Report», posted as a PR review with `commit_id=<new>`
   (`gh api repos/{owner}/{repo}/pulls/<n>/reviews -f commit_id=<new> -f event=COMMENT -F body=@<file>`), never
   an issue comment (owner, 2026-11-14, #178). A later commit needs another confirmation.
5. **Full re-review instead** when: `<old>` is not an ancestor of `<new>` (rebase or force-push); the diff
   adds behaviour, files or criteria beyond the findings and the merge resolution; the requirement view of
   the PR's ID changed in `main` since `<old>`; or the round would cover most of the PR anyway.
