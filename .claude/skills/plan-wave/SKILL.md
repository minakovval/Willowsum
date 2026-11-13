---
name: plan-wave
description: Plan the next Willowsum delivery wave — take the PoC slices that tests do not cover yet (`node tools/req-check/index.mjs --coverage`) with their `*.poc.md` views, order them by dependency (modules and ARC rules first, components before screens), group them into PRs of a reviewable size, mark owner questions, and write `docs/plans/poc-wave-N.md` in the format of `poc-wave-1.md` with a PR count estimate. Use when the lead plans the next wave or the current wave plan is nearly done.
---

# Plan the next delivery wave (lead)

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-13

Input: `main` after the previous wave (or most of it) merged. Output: one docs-only PR with
`docs/plans/poc-wave-N.md` (N = the next free number), in Ukrainian, in the format of
`docs/plans/poc-wave-1.md`. You plan; you do not change requirements (that is `change-requirement`) or write
code. Plans are the lead's working notes: `docs/plans/**` needs no owner decision (`tools/pr-rules`,
`OWNER_DECISION_PATHS`), but every owner question is marked in the plan.

## 1. What is left

1. `node tools/req-check/index.mjs --coverage` → «Slices with tests» lists each slice with its uncovered
   items. A PoC slice is uncovered when it is missing from that table or has items in «Not covered».
2. `docs/traceability/release-poc.md` → «Migrated slices» (all PoC slices, module, «Depends on», «Design») and
   «Build sequence» (topological waves). Take every PoC slice from it that step 1 does not show as covered.
3. Drop slices already in an open PR (`gh pr list --state open --json number,title,headRefName`) or in the
   previous plan's rows still in progress; say which in the plan.
4. For each remaining slice read only its view `docs/requirements/<module>/<ID>.poc.md`: the «Зв'язки»
   header (Залежить від, Дизайн, Спільні правила, Модуль) and the size of FR / AC / EC. Do not read sources or
   other releases. For a wide pass use a read-only subagent and keep only its table.

## 2. Order by dependency

1. Start from the «Build sequence» waves: a slice goes after everything in its «Залежить від».
2. Then the code-level order the views do not state:
   - **Modules first.** A slice whose module (`Модуль`, ARC-01 catalogue) does not exist yet in
     `apps/api/src/modules/` waits for a PR that creates it with the scaffold generator; group slices of one
     new module after that PR.
   - **ARC rules before their users.** ARC-11 (ledger) before anything that moves money; ARC-03 (isolation)
     and ARC-07 (API contract) before a new endpoint; ARC-05 (adapters) before a provider; check the view's
     «Спільні правила» for ARC, NFR and П-rules that need code first.
   - **Components before screens.** A screen, flow or journey (SCR, FLW, JRN, UX, GRID screens) goes after
     every DS, CMP and CHT component it uses (`Дизайн` S-ids → `docs/ux/` screen map; the boards in
     `design/canvas/`); a missing component gets its own `screen-from-canvas` PR first.
   - Backend before the UI of the same slice (`implement-requirement` splits them).
3. A cycle or a dependency on a slice of a later release is a finding: write it under «Що потрібно від
   власника» if it is a scope question, otherwise decide the order and record it as a lead decision.

## 3. Group into PRs

- One PR = one requirement ID or a small group in one module (AGENTS.md «Process», step 1), small enough for
  one review round (step 5); a component with its states is one PR (`screen-from-canvas`). Split larger slices by criteria (backend / UI, or AC groups) and name the parts a), b), c).
- Mark each PR **Ч** when it touches auth, permissions, encryption, money, schema, pipeline or infrastructure
  (`tools/pr-rules/lib/paths.mjs`); it needs a security review.
- Parts that do not depend on each other go into separate sections (A, B, C …) that can run as parallel
  branches (at most 3, AGENTS.md «Parallel branches»); two PRs that change the same files go one after the
  other.
- **Estimate**: the PR count per section and in total, and the number of Ч PRs.

## 4. Owner questions

Go through each view for real product questions (AGENTS.md «Ambiguity»: scope or release, legal, money,
access, infrastructure), conflicts between views, and anything the plan needs from the owner (accounts,
browser tasks, approvals for cloud or production). Mark each in its row («питання власнику, п. N») and list
them in «Що потрібно від власника»: numbered, with options and your recommendation. Small details you decide
are recorded as `Рішення ведучого (YYYY-MM-DD; власник не схвалював; …)` (`pr-pipeline` «2. Owner»).

## 5. Write `docs/plans/poc-wave-N.md`

Follow `poc-wave-1.md`:

1. `# PoC, хвиля N: план PR`, the «Створено / Оновлено» line, an intro: source (`release-poc.md`, the
   `--coverage` run and its date), number of slices, the estimate (PRs in total, Ч PRs).
2. `## Що вже є в \`main\`` — table «Що | Звідки | Які зрізи хвилі N частково покриває».
3. `## Порядок PR` — the Ч legend, then `### A. …`, `### B. …` with tables
   `| # | PR | Що входить | Що лишається на пізніші хвилі | Ч |` (PR titled `<ID>: <що>`), numbering on from
   1, and a closing paragraph on the order inside and between sections.
4. `## Гілки` — the branches and worktrees (AGENTS.md «Parallel branches»).
5. `## Що потрібно від власника` — the numbered questions of step 4.

Then: prettier is not run on `docs/` (`.prettierignore`); `node --test tools/req-check` must stay green.
Scratchpad files only under a subfolder unique to this PR and role (`pr153-plan/`), never `body.md`.

## 6. PR

Title `PRC-02: PoC wave N plan`; body from the template («Requirement»: the plan file and
`release-poc.md`; «Acceptance criteria covered»: none, a plan; «How it was tested»: the commands run). One
`review-pr` pass on a lighter model: every uncovered PoC slice is in a row or listed as left out with a
reason, no row comes before what it depends on, Ч marks match the paths, owner questions are marked. Then
report to the owner in Ukrainian: the estimate, the first PRs, the questions.
