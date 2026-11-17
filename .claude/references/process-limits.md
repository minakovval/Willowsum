# Process limits: how to check and apply them

**Створено:** 2026-11-16 · **Оновлено:** 2026-11-17

Read when a lead segment starts, when a PR adds text to the lead's rules, or when a
review finds a security defect that will not be fixed in the same PR. The rules themselves are in the files named
in each heading; this file only says how to apply them.

## Is a process review due? (`pr-pipeline/references/restarts.md`, «Process review»)

```bash
# 1. when the previous review was posted (its comment on #180 starts with «## Огляд процесу» or «### Перегляд процесу»)
gh api 'repos/{owner}/{repo}/issues/180/comments?per_page=100' --paginate \
  --jq '.[] | select(.body | test("^##+ (Огляд|Перегляд) процесу")) | .created_at' | tail -1
# 2. PRs merged since then (put the time from step 1 in place of <T>, e.g. 2026-11-16T15:35:41Z)
gh api 'search/issues?q=repo:minakovval/Willowsum+is:pr+is:merged+merged:>'<T> --jq .total_count
```

Step 1 prints nothing (no previous review found) → the review is due; skip step 2. Otherwise due only when step 2
gives 40 or more **and** `<T>` is at least 24 hours ago. Not due → no review, no comment;
write «огляд процесу: не настав (N PR, H год)» in «Lead state». Due → the review comes before new tasks, and its
comment starts with `## Огляд процесу ведучого N`, so the next check finds it. More than 3 proposals → the 3 with
the largest expected saving go to the owner, the rest are listed in #178 under «Чекає наступного огляду».

## Follow-ups (`pr-pipeline/SKILL.md`, step 9)

No count of open follow-ups schedules a sweep. Open money and data-loss follow-ups get a plan row in the next
plan-status PR (linked from the row); the rest are sorted once into closed or the MVP list. A sweep (row `R`) runs
only when the lead proposes it and the owner agrees.

## Size of the lead's rules (`pr-pipeline/references/lead-communication.md`, «Rule text»)

```bash
cat .claude/skills/pr-pipeline/SKILL.md .claude/skills/pr-pipeline/references/*.md .claude/references/*.md | wc -l   # at most 1060
```

The author of a PR that changes these files runs it before pushing; the reviewer repeats it. Over the limit → in the
same PR move rarely needed text to a reference outside the skill, or delete what a later rule replaced, and add the
table «правило → нове місце» to the PR body. Inline history of the paragraphs the PR edits is removed only after
checking that the decision log has it (`grep -rn "<date or #PR>" docs/decisions/log/`); if it does not, add the
entry to the log first.

## Security detail of an unfixed defect (`pr-pipeline/SKILL.md`, step 7)

**Applies from MVP**: until then the detail goes into the issue or PR as usual and the steps
below are not followed; from the start of MVP planning they are in force.

Applies to a finding that stays open in `main` after the merge (a «Follow-ups» item), when its probe, test or
description would let a reader reproduce the bypass, leak or loss. A finding fixed in the same PR is not covered.

1. The follow-up issue gets one line: module and the rule broken (e.g. «accounts: закриття рахунку не чекає
   проводок у черзі»), no steps, inputs or code.
2. The detail — the probe, test and patch the reviewer kept in the scratchpad `keep/` and named in its report to
   the lead (`review-pr` §5, `security-review` §6) — goes to a draft security advisory, visible only to the owner:
   ```bash
   # body.json: {"summary": "<same line>", "description": "<probe, steps, patch>", "severity": "medium",
   #             "vulnerabilities": [{"package": {"ecosystem": "other", "name": "willowsum"}}]}
   gh api -X POST 'repos/{owner}/{repo}/security-advisories' --input body.json --jq .html_url
   ```
   Link the advisory from the issue. Not yet tried in a cloud session: if the call is refused (403 or 404), do not
   retry and do not post the detail anywhere else — keep it in the scratchpad `keep/` and tell the owner at once.
3. When the fix is merged, add the fixing PR to the advisory's description and close the advisory.

## Protection of `main` (`.claude/references/merge-rules.md`)

The owner switches it on with [browser task 02](../../docs/ops/browser-tasks/02-main-protection.md). After that a
direct push or a merge with a red required check is refused by GitHub; the lead's merge steps do not change. If a
required check never starts on a PR, treat it as «CI cannot run» ([stacked PRs and CI that cannot run](stacked-and-blocked.md)).
