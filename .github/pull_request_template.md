<!-- Створено: 2026-11-01 · Оновлено: 2026-11-06 -->

## Requirement

<!-- The PR title must start with the requirement ID, e.g. `BUD-03: safe-to-spend widget`.
     Link the file: docs/requirements/bud/BUD-03.md (for a migrated requirement: the slice, e.g. BUD-03.poc.md).
     One requirement (or one small group) per PR. Until the owner has approved the design of the target
     release and started its development (PoC: 2026-11-06), PRs for that release change only requirements,
     design and docs — not apps/ or packages/ (AGENTS.md, «Process: design before code»). -->

## Owner decision

<!-- For changes to requirements, AGENTS.md or skills: the owner decision this PR implements (date, quote,
     link) — also recorded in docs/decisions/. Small details decided by the lead: list them here. -->

## Impact (requirement changes)

<!-- Output of `node tools/req-check/index.mjs --impact <ID>`: dependent slices updated here, or follow-up
     issues. Ran `node --test tools/req-check` and
     `node tools/req-check/index.mjs --report docs/validation/req-check-report.md --traceability` (0 errors). -->

## Acceptance criteria covered

<!-- Each criterion / edge case number from the requirement file → the test that covers it.
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
