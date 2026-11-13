# Skills (full list with descriptions)

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-13

Moved out of AGENTS.md without change (owner, 2026-11-13: shorter AGENTS.md and skills). Read when you look for the skill that fits a task, or add a skill (the list must name it with its description).

**Skills** (`.claude/skills/`, owner, 2026-11-12): `implement-requirement` (author), `review-pr` (reviewer),
`security-review` (security reviewer of `sensitive` PRs), `fix-review-findings` (author, after reviews),
`pr-pipeline` (the lead's loop over these), `browser-task` (instructions for the owner's local Claude session
with a browser), `sync-branch` (merge `origin/main` into a working branch: merge only, checks, confirmation on the new
head), `change-requirement` (changing requirements, screens or П-rules without code: decisions collected first, impact, `--move` in the source, views regenerated, one batch PR, lighter review), `deploy` (deploying to Oracle Cloud; the server does not exist yet, so unverified steps are marked), `screen-from-canvas` (author of a design-system component or screen: requirement view, card, board and tokens; tests by criteria, states, gallery entry, uk and en strings, accessibility, a 1280 px screenshot check), `plan-wave` (the lead's plan of the next delivery wave: uncovered PoC slices ordered by dependency, grouped into reviewable PRs, owner questions marked, `docs/plans/poc-wave-N.md`), `investigate-ci-failure` (a red or blocked CI run: reproduce locally, compare with `main`, at most one re-run, root cause, the failing run and the same check green after the fix). Token economy (owner request, 2026-11-12): pick each agent's model by risk, give re-reviews to
a fresh agent with a narrow brief, let reviewers rely on CI — rules in `pr-pipeline`, «Token economy».
