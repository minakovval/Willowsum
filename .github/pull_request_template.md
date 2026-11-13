<!-- Створено: 2026-11-01 · Оновлено: 2026-11-13 -->

## Requirement

<!-- The PR title must start with the requirement ID, e.g. `BUD-03: safe-to-spend widget`.
     Link the release view you built from, e.g. docs/requirements/bud/BUD-03.poc.md (generated; for a
     requirement not migrated yet, its one file). Requirement text is changed only in the source
     (docs/requirements/bud/BUD-03.md), never in a view; regenerate the views with
     `node tools/req-check/index.mjs --views`.
     One requirement (or one small group) per PR. Until the owner has approved the design of the target
     release and started its development (PoC: 2026-11-06), PRs for that release change only requirements,
     design and docs — not apps/ or packages/ (`.claude/references/design-before-code.md` (AGENTS.md links it)). -->

## Owner decision

<!-- For changes to requirements, AGENTS.md or skills: the owner decision this PR implements (date, quote,
     link) — also recorded in docs/decisions/. Small details decided by the lead: list them here. -->

## Impact (requirement changes)

<!-- Output of `node tools/req-check/index.mjs --impact <ID>`: dependent slices updated here, or follow-up
     issues. Scope moved with `--move`: its warnings (changed item numbers and their citations, mentions of the
     moved items) and what was done with each. Ran `node tools/req-check/index.mjs --views`,
     `node tools/req-check/index.mjs --check-mentions` and `node --test tools/req-check` (0 errors). The
     traceability files and the req-check report are not committed: CI generates them. Before pushing or setting
     this body: `node tools/pr-rules/index.mjs local --title "<title>" --body-file <this body>`. -->

## Acceptance criteria covered

<!-- Each criterion / edge case number from the release view → the test that covers it (tests named by item,
     e.g. `BUD-03@PoC AC2`, so `node tools/req-check/index.mjs --coverage` maps them).
     If the requirement is split across PRs, say which criteria are left. -->

## How it was tested

- [ ] One automated test per acceptance criterion and edge case
- [ ] Permission tests for every role and a scoped member (if data access changed)
- [ ] Entitlement check with the requirement's feature key (if it has plan limits)
- [ ] Empty / loading / error states; widths 390, 768, 1280 px (PoC and PoC v2: 1280 only, light theme); uk and en strings

## Sensitive areas touched

- [ ] Auth / permissions / encryption / money / database schema / pipeline / infrastructure → needs security review

## Open questions for the product owner

<!-- Real product questions only (direction, scope or release, legal, money, access). Do not guess. -->
