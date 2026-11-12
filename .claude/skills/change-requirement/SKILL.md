---
name: change-requirement
description: Change Willowsum requirements, screens or shared П-rules without code — move scope between releases (PoC to PoC v2 or MVP) with `--move`, reword an FR or AC, record an owner decision in the text. Decisions collected first, impact analysis, edits only in the requirement sources, views regenerated, every dependent slice updated or listed as a follow-up, one batch PR with the lighter review. Use when a task changes docs/requirements/ rather than implements one.
---

# Change a requirement

**Створено:** 2026-11-12 · **Оновлено:** 2026-11-12

Input: a requested change to requirements, screens or shared П-rules (PRC-02), usually a batch of them. Output:
one docs-only PR for the whole batch, in which every dependent artifact is updated or explicitly listed as a
follow-up, the views and other generated files are regenerated with 0 errors, and the decisions are in the
decision log. Code is out of scope: for building a requirement use `implement-requirement`.

Format: `docs/requirements/README.md`, «Source and generated release views» (one source file per requirement,
release tags, generated views, commands). Process rules: AGENTS.md, «Where things are» and «Process», steps 5
and 7.

**Edit only sources.** A migrated requirement is one source file `<module>/<ID>.md`; the files
`<ID>.<release key>.md` next to it are views generated from it (line 2 says so). Never edit, create or delete
a view by hand: change the source, then run `node tools/req-check/index.mjs --views`. A view edited by hand
fails CI (`view-stale`).

## 1. Collect the decisions first

1. Before the first edit, list every change of the batch with its decision: the owner's answer (date, where,
   quote) or the lead's decision on a small detail (AGENTS.md «Ambiguity»). A change without a decision is
   not made: put it under «Open questions for the product owner» and keep the old text.
2. One batch = one PR. Do not open a PR per item; do not mix in changes nobody decided.
3. Target release of scope removed from PoC: PoC v2 by default (AGENTS.md). Any other target (MVP, later)
   needs the owner's explicit choice; if it is not given, ask before editing.

## 2. Impact

1. Run `node tools/req-check/index.mjs --impact <ID | slice | S-id | board | П-n | UC-id | module>` for every
   target you will change (a slice is written `BUD-16@PoC`). It lists dependent slices transitively, with the
   sources to edit, screens, use cases, docs/ux mentions, tests and modules.
2. Update each dependent slice in the same PR (in its source), or list it in the PR body as a follow-up with an
   issue (AGENTS.md, PRC-02). Do not leave a dependent slice silently unchecked.
3. State in the PR which releases the change touched and which it deliberately left unchanged, and why.
   Example (PR #94): the squatting rule was changed in PoC and PoC v2 and left in MVP, because the owner
   decides the MVP rule later.

## 3. Moving scope between releases: `--move`

1. Move items with the tool, not by hand:
   `node tools/req-check/index.mjs --move <ID> --items FR4,AC5,EC2 --to "PoC v2" [--from PoC]`.
   Items are numbered as in the `--from` view (default: the first view). The tool changes the tags of the item
   and its continuation lines in the source and regenerates that requirement's views.
2. The target view must exist. For a new release of the requirement, first add it by hand in the source:
   «Зрізи», the card's «Реліз» line and table of slices, the `[лише <release>] **Реліз:** …` line and the
   «Розширює» lines of the slice text; run `--views`; then move.
3. Read the whole `--move` report and act on every part of it:
   - **Item numbers that changed** and **citations of changed numbers in the source**: a line such as «прогрес
     за FR 15» now points at another item. Reword it to name the item by its phrase («пункт «Прогрес черги
     рахує транзакції»») or fix the number;
   - **tests and docs that cite changed numbers** (`BUD-12@PoC FR 15` in a test name): `--coverage` maps tests
     by number, so rename the test or list it as a follow-up for its author;
   - **the moved items are still mentioned in the same requirement**: business rules, criteria or edge cases
     that still describe the moved behaviour in the old release. Move them too (`--items`), reword them, or
     record why they stay;
   - **an item beside a variant of itself**: two wordings of one item in one view; keep one;
   - **dependents** and **key phrases elsewhere**: as in step 2.
4. Moving a `[лише PoC]` item to PoC v2 makes it `[лише PoC v2]`; check that it does not contradict a PoC v2
   item next to it (the variant check only catches lines that start alike).
5. Rewording is a plain edit of the source: a line that changes from release R on becomes two lines with
   adjacent ranges, old then new (`[PoC–PoC v2] old`, `[MVP] new`); a line of one release only is edited in
   place.
6. Keep each view complete for its release; IDs only in «Зв'язки» (tag the field lines that differ between
   releases).
7. The card part is not changed by `--move`: update the «Реліз» line, the table of slices and the module
   README row by hand when the set of releases changes. Plans that list the item (`docs/plans/`) are updated
   in the same PR; grep them for the ID.

## 4. Housekeeping

1. Update the «Оновлено» line of every changed document that has one; keep «Створено».
2. Add a decision-log entry in `docs/decisions/` (`state-2026-11-05.md`), and say what kind of decision it is:
   - owner decision: «власник (YYYY-MM-DD, чат або PR; схвалено): …» with the source quoted;
   - lead decision: «рішення ведучого (YYYY-MM-DD): …» for small details the lead decides (AGENTS.md
     «Ambiguity»); it says that the owner has not approved it.

## 5. Owner decision lines

1. A line `Рішення власника (YYYY-MM-DD): …` is written only for a decision the owner actually gave in chat
   or in the PR. Quote the source (date, where, the owner's words) in the decision log, in the requirement
   text where the decision belongs, and in the PR body.
2. No owner decision yet: do not write the line. Put the question in «Open questions for the product owner»
   and keep the old text.
3. Never write «Схвалюю» or «Approved» (AGENTS.md step 7).

## 6. Regenerate and check

Run, from the repository root, in this order:

1. `node tools/req-check/index.mjs --views` — writes every view from its source, then checks;
2. `node tools/req-check/index.mjs --report docs/validation/req-check-report.md --traceability`;
3. `node --test tools/req-check`.

There must be 0 errors. Commit the sources, the regenerated views, `docs/traceability/` and
`docs/validation/req-check-report.md`; never hand-edit or hand-merge the generated files (on a conflict see
`sync-branch`). Run `prettier --check` on the changed non-requirement files.

## 7. PR

1. Title `<ID>: <what>` with the requirement ID, or `PRC-02: <what>` for a batch over many requirements. Draft
   until CI is green. Body: `.github/pull_request_template.md`.
2. «Owner decision»: the decisions this PR implements, with the quote and source, as in step 5.
3. «Impact»: the `--impact` summary, a table «що змінено → у якому зрізі» (source line → views), the releases
   changed and the releases left unchanged with the reason, the `--move` warnings and what was done with each,
   follow-ups with issue links, and the check results of step 6.
4. «Sensitive areas touched»: tick it only if the change touches the requirements of a sensitive area (auth,
   permissions, isolation, encryption, money, retention); the path map is in `tools/pr-rules`
   (`lib/paths.mjs`). The label `owner-decision` is set by CI.

## 8. Review (lighter rule, owner, 2026-11-12)

A requirement-change PR built this way gets **one** `review-pr` pass in a different session, by an agent on a
lighter model (`pr-pipeline`, «Token economy»), with this fixed checklist (the reviewer reports each row):

1. The PR body records the decision of every change, and each change matches its decision.
2. Only sources were edited; `--views` and `--traceability` regenerate with no diff; 0 errors.
3. Each moved item is absent from the old release's view and present from the target release on; the card
   part («Реліз», table of slices) and the module README row match.
4. Every `--move` warning (changed numbers and their citations, mentions in the same requirement, variants)
   is fixed or listed with a reason.
5. Every dependent slice from `--impact` is updated or listed as a follow-up with an issue.
6. The decision-log entry exists and says whose decision it is.

A `security-review` is needed only when a moved or reworded line states a protection (authentication,
permissions, data isolation, encryption, money, retention or deletion). It then reviews **only those lines**:
that the protection still holds in every release that needs it and did not silently leave a release. Merge
conditions: AGENTS.md step 7; the PR body records the owner's decision.
