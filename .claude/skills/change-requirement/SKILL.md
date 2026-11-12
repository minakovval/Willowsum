---
name: change-requirement
description: Change Willowsum requirements, screens or shared П-rules without code — move scope between releases (PoC to PoC v2 or MVP), split a slice, reword an FR or AC, record an owner decision in the text. Impact analysis first, every dependent slice updated or listed as a follow-up, housekeeping, regenerated files, one small PR. Use when a task changes docs/requirements/ rather than implements one.
---

# Change a requirement

**Створено:** 2026-11-12 · **Оновлено:** 2026-11-12

Input: a requested change to a requirement, a slice, a screen or a shared П-rule (PRC-02). Output: one small
docs-only PR in which every dependent artifact is updated or explicitly listed as a follow-up, the
generated files are regenerated with 0 errors, and the decision is in the decision log. Code is out of
scope: for building a requirement use `implement-requirement`.

Format rules for cards, slices and the «Зв'язки» header: `docs/requirements/README.md`, «Release slices and
links». Process rules: AGENTS.md, «Where things are» and «Process», steps 5 and 7.

## 1. Impact first

1. Run `node tools/req-check/index.mjs --impact <ID | slice | S-id | board | П-n | UC-id | module>` for every
   target you will change (a slice is written `BUD-16@PoC`). It lists dependent slices transitively, with
   files, screens, use cases, docs/ux mentions, tests and modules.
2. List every dependent slice. Update each one in the same PR, or list it in the PR body as a follow-up with
   an issue (AGENTS.md, PRC-02). Do not leave a dependent slice silently unchecked.
3. State in the PR which releases the change touched and which it deliberately left unchanged, and why.
   Example (PR #94): the squatting rule was changed in PoC and PoC v2 and left in MVP, because the owner
   decides the MVP rule later.

## 2. Moving scope between releases

1. Remove the item from the source slice and add it to the target slice. If the target slice does not exist,
   create it in the card plus slice format: add the file, add it to the card's «Зрізи» and its table of
   slices, and set «Розширює» to the requirement's previous slice.
2. Keep each slice self-contained for its release: it restates everything that holds in that release, with
   no «У релізі …» override blocks. A later slice restates what it keeps.
3. Fix the «Зв'язки» headers of every slice touched and of the slices that depend on them. IDs are allowed
   only there; the body text never names another requirement.
4. Renumber nothing that other files cite unless you update those files in the same PR (the impact output
   shows who cites it).
5. The default target for scope the owner removes from PoC is PoC v2 (AGENTS.md). Any other target (MVP,
   later) needs the owner's explicit choice; if it is not given, stop and ask (AGENTS.md «Ambiguity»).
6. Plans that list the item (`docs/plans/`) are updated in the same PR; grep them for the ID.

## 3. Housekeeping

1. Update the «Оновлено» line of every changed document; keep «Створено».
2. Add a decision-log entry in `docs/decisions/` (`state-2026-11-05.md`), and say what kind of decision it is:
   - owner decision: «власник (YYYY-MM-DD, чат або PR; схвалено): …» with the source quoted;
   - lead decision: «рішення ведучого (YYYY-MM-DD): …» for small details the lead decides (AGENTS.md
     «Ambiguity»); it says that the owner has not approved it.

## 4. Owner decision lines

1. A line `Рішення власника (YYYY-MM-DD): …` is written only for a decision the owner actually gave in chat
   or in the PR. Quote the source (date, where, the owner's words) in the decision log, in the requirement
   text where the decision belongs, and in the PR body.
2. No owner decision yet: do not write the line. Put the question in «Open questions for the product owner»
   and keep the old text.
3. Never write «Схвалюю» or «Approved» (AGENTS.md step 7).

## 5. Regenerate and check

Run, from the repository root:

- `node --test tools/req-check`;
- `node tools/req-check/index.mjs --report docs/validation/req-check-report.md --traceability`.

There must be 0 errors. Commit the regenerated `docs/traceability/` and `docs/validation/req-check-report.md`;
never hand-edit them (on a conflict see `sync-branch`). Run `prettier --check` on the changed files.

## 6. PR

1. Title `<ID>: <what>` with the requirement ID, or `PRC-02: <what>` for process changes. Draft until CI is
   green. Body: `.github/pull_request_template.md`.
2. «Owner decision»: the decision this PR implements, with the quote and source, as in step 4.
3. «Impact»: the `--impact` output summary, a table «що змінено → у якому зрізі», the releases changed and
   the releases left unchanged with the reason, follow-ups with issue links, and the check results of step 5.
4. «Sensitive areas touched»: tick it only if the change touches the requirements of a sensitive area (auth,
   permissions, isolation, encryption, money, retention); the path map is in `tools/pr-rules`
   (`lib/paths.mjs`). The label `owner-decision` is set by CI.
5. Review: `review-pr` in a different session, with a lighter model for non-sensitive docs (`pr-pipeline`,
   «Token economy»). A `security-review` is needed only when the change touches the requirements of a
   sensitive area. Merge conditions: AGENTS.md step 7; the PR body records the owner's decision.
