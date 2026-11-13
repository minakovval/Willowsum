---
name: change-requirement
description: Change Willowsum requirements, screens or shared П-rules without code — move scope between releases (PoC to PoC v2 or MVP) with `--move`, reword an FR or AC, record an owner decision in the text. Decisions collected first, impact analysis, edits only in the requirement sources, views regenerated, every dependent slice updated or listed as a follow-up, one batch PR with the lighter review. Use when a task changes docs/requirements/ rather than implements one.
---

# Change a requirement

**Створено:** 2026-11-12 · **Оновлено:** 2026-11-13

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
   sources to edit, screens, use cases, docs/ux mentions, tests and modules. To read one slice with its
   dependencies, the decisions that cite it and its coverage, use `node tools/req-check/index.mjs --show <ID@release>`
   instead of opening whole folders.
2. Update each dependent slice in the same PR (in its source), or list it under Follow-ups in the PR body / report; the lead opens the issue (AGENTS.md, PRC-02). Do not leave a dependent slice silently unchecked.
3. State in the PR which releases the change touched and which it deliberately left unchanged, and why.
   Example (PR #94): the squatting rule was changed in PoC and PoC v2 and left in MVP, because the owner
   decides the MVP rule later.

## 3. Moving scope between releases: `--move`

Move items only with `node tools/req-check/index.mjs --move <ID> --items FR4,AC5,EC2 --to "PoC v2" [--from PoC]`,
act on every part of its report (changed numbers and their citations, tests that cite them, mentions of the
moved items, variants, dependents), update the card part and module README row by hand, and reword in the
source otherwise — [full procedure](references/move.md) (read when you move items or add a release to a
requirement).

## 4. Housekeeping

1. Update the «Оновлено» line of every changed document that has one; keep «Створено».
2. Add the decision-log entries in a **new file** `docs/decisions/log/YYYY-MM-DD-<short-slug>.md` (a numeric
   suffix if the name is taken; one file may hold the batch's entries; owner, 2026-11-13), never in the archive
   `docs/decisions/state-2026-11-05.md`, and say what kind of decision each is:
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
2. `node tools/req-check/index.mjs --check-mentions` — a renumbered item still named by a test fails CI;
3. `node --test tools/req-check`.

There must be 0 errors. Commit the sources and the regenerated views; never hand-edit or hand-merge a view (on
a conflict see `sync-branch`). The traceability files and the req-check report are not committed (owner,
2026-11-13): CI generates them; to read one, generate it on demand with
`node tools/req-check/index.mjs --quiet --traceability --report docs/validation/req-check-report.md`
(git-ignored), or take the `traceability` artifact of the latest «Requirements traceability» run on `main`. Run `prettier --check` on the changed non-requirement files.

## 7. PR

Scratchpad files (owner, 2026-11-13): only under a prefix or subfolder unique to the PR and role
(`pr153-req/`), never a generic name like `body.md`; before PATCHing a PR body from a file, check that it is
the one you wrote (it names this PR).

1. Title `<ID>: <what>` with the requirement ID, or `PRC-02: <what>` for a batch over many requirements. Draft
   until CI is green. Body: `.github/pull_request_template.md`. Before pushing and before every body change, run
   the local PR checks below.
2. «Owner decision»: the decisions this PR implements, with the quote and source, as in step 5.
3. «Impact»: the `--impact` summary, a table «що змінено → у якому зрізі» (source line → views), the releases
   changed and the releases left unchanged with the reason, the `--move` warnings and what was done with each,
   follow-ups (the lead opens the issues), and the check results of step 6.
4. «Sensitive areas touched»: tick it only if the change touches the requirements of a sensitive area (auth,
   permissions, isolation, encryption, money, retention); the path map is in `tools/pr-rules`
   (`lib/paths.mjs`). The label `owner-decision` is set by CI.

**Local PR checks before every push and body change** (owner, 2026-11-13):

```
git fetch origin main
node tools/pr-rules/index.mjs local --title "<the PR title>" --body-file <scratchpad>/pr<n>-<role>/body.md
```

Exit 0 required; tick «Sensitive areas touched» if it lists `sensitive`; record the owner decision if it lists
`owner-decision` — [details](../../references/local-pr-checks.md) (read when the output is unclear).

GitHub 502 / 503 / «token store unavailable» → [retry rules](../../references/github-errors.md) (read when it
happens: retry with backoff; check that a review, comment, issue or PR did not land before posting it again).

**Report to the lead** (owner, 2026-11-13): 10–15 lines, no narrative — PR URL, head SHA (full), result (CI, the batch's changes in one line each), blockers, owner questions. Details go in the PR body
(Follow-ups: the lead opens the issue), not in the report.

## 8. Review (lighter rule, owner, 2026-11-12)

One `review-pr` pass in a different session on a lighter model (unless a changed line touches a security rule),
with the fixed six-row checklist; a `security-review` only for moved or reworded lines that state a protection —
[checklist](references/review-checklist.md) (read when you review or brief that review).
