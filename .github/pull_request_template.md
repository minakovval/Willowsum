## Requirement

<!-- The PR title must start with the requirement ID, e.g. `BUD-03: safe-to-spend widget`.
     Link the file: docs/requirements/bud/BUD-03.md. One requirement (or one small group) per PR. -->

## Acceptance criteria covered

<!-- Each criterion / edge case number from the requirement file → the test that covers it.
     If the requirement is split across PRs, say which criteria are left. -->

## How it was tested

- [ ] One automated test per acceptance criterion and edge case
- [ ] Permission tests for every role and a scoped member (if data access changed)
- [ ] Entitlement check with the requirement's feature key (if it has plan limits)
- [ ] Empty / loading / error states; widths 390, 768, 1280 px; uk and en strings

## Sensitive areas touched

- [ ] Auth / permissions / encryption / money / database schema / pipeline / infrastructure → needs security review

## Open questions for the product owner

<!-- Anything ambiguous in the requirement. Do not guess. -->
