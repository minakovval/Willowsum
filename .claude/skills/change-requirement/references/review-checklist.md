# Review of a requirement-change PR («8.», full text)

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-13

Moved out of `change-requirement` SKILL.md without change (owner, 2026-11-13). Read when you review or brief the review of a requirement-change PR.

## 8. Review (lighter rule, owner, 2026-11-12)

A requirement-change PR built this way gets **one** `review-pr` pass in a different session, by an agent on a
lighter model (`pr-pipeline`, «Token economy»), with this fixed checklist (the reviewer reports each row):

1. The PR body records the decision of every change, and each change matches its decision.
2. Only sources were edited; `--views` regenerates with no diff; `--check-mentions` passes; 0 errors.
3. Each moved item is absent from the old release's view and present from the target release on; the card
   part («Реліз», table of slices) and the module README row match.
4. Every `--move` warning (changed numbers and their citations, mentions in the same requirement, variants)
   is fixed or listed with a reason.
5. Every dependent slice from `--impact` is updated or listed as a follow-up with an issue the lead opened.
6. The decision-log entry exists in a new file in `docs/decisions/log/` and says whose decision it is.

A `security-review` is needed only when a moved or reworded line states a protection (authentication,
permissions, data isolation, encryption, money, retention or deletion). It then reviews **only those lines**:
that the protection still holds in every release that needs it and did not silently leave a release. Merge
conditions: AGENTS.md step 7; the PR body records the owner's decision.
