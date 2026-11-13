# Local PR checks (description and labels)

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-13

Shared by several skills (owner, 2026-11-13: rare parts moved out of the skills). Read when you are about to push, open a PR or change a PR body and need the details of the local check.

**Local PR checks before every push and body change** (owner, 2026-11-13): before `git push`, opening the
PR or PATCHing its body, write the body to your own scratchpad file and run, from the worktree root:

```
git fetch origin main
node tools/pr-rules/index.mjs local --title "<the PR title>" --body-file <scratchpad>/pr<n>-<role>/body.md
```

It runs, offline, what the CI job `traceability` (description) and the label job check, on
`git diff origin/main...HEAD`: the title's requirement ID, the template sections, and the labels CI will set.
Fix every `ERROR` line first (exit code 0 is required). When it lists `sensitive` labels, tick «Sensitive areas
touched»; when it lists `owner-decision`, the body must record the owner decision the PR implements.

Always `git fetch origin main` first: the check diffs against `origin/main`, and a stale ref lists files the PR
does not change (or misses ones it does). The output lists every changed file in each sensitive category and
every rule or requirement file. `--base <ref>` compares with another ref; `--root <dir>` checks another checkout.
