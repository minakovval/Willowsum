# Rules for AI agents working in this repository

**Створено:** 2026-11-01 · **Оновлено:** 2026-11-06

This is the single rule set for every agent (and human) changing this repository. It is short on purpose:
read it fully, then load only the files your task needs. If a task conflicts with this file, stop and ask
the product owner.

Willowsum is built from scratch. The requirements are complete; the code is written requirement by
requirement, following the architecture requirements (ARC) and delivery requirements (CICD).

Current phase: PoC development. On 2026-11-06 the owner approved the PoC design («дизайн ок») and started
development; build the PoC requirement by requirement in the waves of `docs/traceability/release-poc.md`,
with the canvas (snapshot in `design/canvas/`) as the visual reference. The PoC shell code already in
`main` (PRs #46, #47, #52, #54, #55) is the starting point; issues #49 and #51 are now open for work.
«Process: design before code» still applies to every later release (PoC v2, MVP, …): no code for a
release until the owner has approved its design and started its development.

## Where things are

| What | Where |
| --- | --- |
| Product requirements (single source of truth) | `docs/requirements/` — one file per requirement ID, index per module |
| Product, releases, roles, plan matrix, general rules П-1…П-26, glossary | `docs/requirements/00-general.md` |
| Requirement process: release slices, links, traceability; change process | `docs/requirements/prc/` (PRC-01, PRC-02); format in `docs/requirements/README.md` |
| Traceability matrix, per-release build sequence, coverage (generated) | `docs/traceability/` — regenerate with `node tools/req-check/index.mjs --traceability` |
| Architecture and delivery requirements | `docs/requirements/arc/`, `docs/requirements/cicd/` |
| Non-functional requirements | `docs/requirements/nfr/` |
| Design system, components, flows | `docs/requirements/ds/`, `cmp/`, `flw/`, `jrn/`, `scr/` |
| Architecture decisions (written while building) | `docs/adr/` — do not contradict an accepted ADR; propose a new one |
| Project state and owner decision log | `docs/decisions/` (`state-2026-11-05.md`) |
| Screen map (screens S-NNN, entry points), use cases, user journeys | `docs/ux/` |
| Design artifacts (canvas, design system, Claude Doc, release sheet), snapshots, recovery | `docs/design/ARTIFACTS.md`; snapshots in `design/` |
| Coverage tables of design decisions, req-check report | `docs/validation/` |

Requirement files are self-contained: you never need another source to implement one. A requirement
changes only through a PR to its file that records the owner's decision.

Migrated requirements are a card (`bud/BUD-16.md`) plus one **release slice** per release
(`bud/BUD-16.poc.md`, `BUD-16.poc-v2.md`, …; ID `BUD-16@PoC`). A slice is complete for its release: to
build a release, read only the slices of that release (and the latest earlier slice of each requirement
that has none in it). Links to other requirements, screens, П-rules, use cases, modules and tests live
only in the fixed «Зв'язки» header at the top of a card or slice; IDs are allowed there and nowhere else
in the text. Requirements not migrated yet keep the old one-file format. Format and rules:
`docs/requirements/README.md`, «Release slices and links». Scope that the owner removes from PoC (from
2026-11-04) moves to PoC v2: it leaves the PoC slice and is added to the PoC v2 slice.

Before changing a requirement, a screen or a shared rule, run
`node tools/req-check/index.mjs --impact <ID|slice|S-id|board|П-n|UC-id|module>` and update every
dependent slice in the same PR or list it as follow-up with an issue in the PR body (PRC-02).
Regenerate `docs/traceability/` and `docs/validation/req-check-report.md` in the same PR: run
`node --test tools/req-check` and
`node tools/req-check/index.mjs --report docs/validation/req-check-report.md --traceability`
(0 errors; commit the regenerated files).

## Planned code layout

Created by the first tasks (ARC-01, ARC-07, CICD-02); follow it, do not invent another. `apps/web`, `packages/ui` and
`packages/i18n` already exist (PoC shell; PoC development started 2026-11-06).

| Path | Contents |
| --- | --- |
| `apps/api` | TypeScript backend: one modular monolith (ARC-01) |
| `apps/api/src/modules/<module>/{domain,application,adapters}` | One folder per module from the catalogue in ARC-01; three layers; public interface and events in `index.ts` |
| `apps/web`, `apps/admin` | React web app and admin panel |
| `apps/mobile` | React Native app (release v1-mobile) |
| `packages/domain-kernel` | Money/Decimal, dates, IDs — shared pure code |
| `packages/api-contract` | OpenAPI contract and generated typed client |
| `packages/ui`, `packages/i18n` | Design-system components and tokens; translations (uk, en complete) |
| `infra/` | Infrastructure as code for both deployment profiles (ARC-08, CICD-07) |
| `tools/synthetic` | Synthetic household generator — the only data agents use |

## Module map

The full module catalogue (79 modules, what each one owns) and the modularity rules are in
`docs/requirements/arc/ARC-01.md`; the ledger rules are in `docs/requirements/arc/ARC-11.md`.
Modules are small: one business capability each. Every asset type and every bank provider is its own
module behind a common interface. Transactions, recognition (merchants, categorization, duplicates,
transfers), the accounting ledger, bank sync and import are separate modules linked by events.

| Domain | Modules |
| --- | --- |
| Platform | `identity`, `household`, `access-scope`, `audit`, `plan-catalog`, `usage-limits`, `billing`, `staff-admin`, `feature-flags`, `data-export`, `data-erasure`, `demo-space`, `legal-consents`, `onboarding` |
| Shared | `parties`, `saved-views`, `bulk-actions` |
| Assets | `asset-registry`, `locations`, `asset-media`, `asset-property`, `asset-art`, `asset-wine`, `asset-collectables`, `asset-jewellery`, `asset-vehicles`, `asset-belongings`, `asset-business`, `asset-other`, `liabilities`, `insurance` |
| Valuation | `valuation`, `auto-valuation`, `market-data`, `fx-rates`, `net-worth` |
| Money | `accounts`, `transactions`, `ledger`, `merchants`, `categorization`, `duplicate-matching`, `transfer-matching`, `bank-consents`, `bank-sync`, `bank-monobank`, `bank-enablebanking`, `bank-saltedge`, `recurring`, `holdings`, `cost-basis`, `broker-events`, `crypto` |
| Import | `import-sessions`, `import-recipes`, `file-parsers`, `ocr`, `receipts` |
| Budget | `categories`, `budget`, `goals`, `cashflow`, `debt-payoff` |
| Documents | `documents`, `file-storage`, `vault-items`, `vault-sharing`, `vault-emergency-access` |
| Service | `notification-delivery`, `notification-preferences`, `weekly-digest`, `dashboard`, `reports`, `search`, `support` |
| Later releases (v1, v2) | `integrations`, `ai-assistant`, `planning`, `advisor` |

| Requirement code | Modules that implement it |
| --- | --- |
| ACC | `identity`, `household`, `access-scope`, `audit`, `data-erasure` |
| SUB | `plan-catalog`, `usage-limits`, `billing` |
| ADM | `plan-catalog`, `staff-admin` |
| DAT | `data-export`, `data-erasure`, `demo-space`, `search` |
| LEG | `legal-consents` |
| AST | `parties`, `asset-registry`, `locations`, `asset-media`, `asset-property`, `asset-art`, `asset-wine`, `asset-collectables`, `asset-jewellery`, `asset-vehicles`, `asset-belongings`, `asset-business`, `asset-other`, `liabilities` |
| VAL | `locations`, `valuation`, `auto-valuation`, `market-data`, `fx-rates`, `net-worth` |
| FIN | `liabilities`, `accounts`, `transactions`, `ledger`, `duplicate-matching`, `transfer-matching`, `bank-consents`, `bank-sync`, `bank-monobank`, `bank-enablebanking`, `bank-saltedge`, `recurring` |
| INS | `insurance` |
| INV | `market-data`, `holdings`, `cost-basis`, `broker-events` |
| BUD | `transactions`, `merchants`, `categorization`, `recurring`, `receipts`, `categories`, `budget`, `goals`, `cashflow`, `debt-payoff` |
| IMP | `merchants`, `duplicate-matching`, `import-sessions`, `import-recipes`, `file-parsers`, `ocr` |
| CRY | `crypto` |
| DOC | `documents`, `file-storage` |
| VLT | `vault-items`, `vault-sharing`, `vault-emergency-access` |
| NOT | `notification-delivery`, `notification-preferences`, `weekly-digest` |
| RPT | `reports` |
| SUP | `support` |
| INT | `integrations` |
| AI | `ai-assistant` |
| PLN | `planning` |
| ADV | `advisor` |
| FCS | `budget`, `cashflow` |
| UX, GRID | `onboarding`, `dashboard`, `saved-views`, `bulk-actions`, `apps/web`, `packages/ui` |
| WGT | `dashboard`, `apps/web`, `packages/ui` |
| CHT | `packages/ui`, `apps/web` |
| L10N, PLT, DS, CMP, FLW, JRN, SCR | `apps/web`, `apps/admin`, `packages/ui`, `packages/i18n` |
| NFR, ARC, CICD | whole repo, `.github/workflows/`, `infra/` |
| PRC | `docs/requirements/`, `docs/traceability/`, `tools/req-check/`, `.github/workflows/` |

Transaction flow: source (`bank-sync` + a bank adapter, `import-sessions`, `receipts`, manual entry) →
`transactions` → `merchants` → `categorization` → `duplicate-matching` → `transfer-matching` → `ledger` →
`budget`, `reports`, `net-worth`, `cashflow` (all via events).

Each module has a card (`README.md` in the module folder): purpose, requirement IDs, public interface,
events published and consumed, owned tables. Start every task by reading the card; update it in the same
PR when the interface changes. Create new modules only with the scaffold generator.

Modules talk to each other only through their public interface and events. Never import another
module's internals or touch its database schema. Shared code without business rules (money, dates, IDs,
errors) lives only in `packages/domain-kernel`.

## Process: one requirement = one session = one branch = one PR

1. A task names one requirement ID (or a small group in one module). No ID → do not start.
2. Load only the requirement file (for a migrated requirement: its card and the slice of the target
   release, plus what its «Зв'язки» header names), the sections of `00-general.md` it relies on, the module card and
   the code of that module. For wide searches use a read-only subagent and keep only its conclusion.
3. Follow the `implement-requirement` skill. Tests first: one automated test per acceptance criterion
   and per edge case.
4. Branch `<ID>-<slug>`; PR title starts with the ID, e.g. `BUD-03: safe-to-spend widget`.
5. Review is done in a **different** session with the `review-pr` skill. Auth, permissions, encryption,
   money calculations, database schema, pipeline and infrastructure also need a security review.
6. All CI checks green (jobs `requirements`, `web`, `traceability`, `local-env`, `api`). Never skip, disable or weaken a
   test to get green.
7. The authoring agent merges the PR (squash) only when CI is green on the latest commit and the review
   session gave «Ready» (plus the security review for sensitive areas). PRs that change requirements, AGENTS.md or
   skills are merged only when the PR body records the owner's decision they implement (and the decision
   log in `docs/decisions/` has it). An approval comment from the
   owner's own GitHub account on the PR is needed only for what acts on the cloud or production: applying
   infrastructure (`tofu apply`), deploying or releasing to production, and changing the workflows that do
   this or the trust settings they use (OIDC trust, the production secrets store) or production DNS. Code
   that is only validated (infrastructure as code without apply, KMS and access rules described as code),
   CI check jobs and the local environment need no approval comment (owner, 2026-11-06). If the owner commented
   «stop» or asked a question on the PR, do not merge until they answer. Production releases still need the
   owner's approval. Never push to `main` directly: the free GitHub plan cannot block it, so the process
   is the protection.
   Once these conditions hold: do not ask the owner to confirm the merge; merge at once and tell the
   owner it is merged.

If the work does not fit one session, split it by acceptance criteria into several PRs, each green on
its own, and list in the PR body which criteria are left.

## Process: design before code

Owner decisions of 2026-11-02 (design session; items 10–11 from the «Гроші» review; item 10 changed by the
owner on 2026-11-06):

1. Design comes first, as mockups on the canvas; changes and clarifications happen there. Turning a
   design into code is a separate step that starts only after every detail is approved.
2. Desktop 1280 px first. The phone (390 px) and dark-theme versions are added only after that screen is
   approved.
3. The UI/UX is complete before development starts; the requirements are validated through the
   prototype.
4. A rule decided on the canvas is a general product rule, not a canvas-only note. Each rule goes into the
   decision log (`docs/decisions/`) at once. When a design step is approved, all its rules go into the requirements in
   one PR, with a coverage table that maps every rule to the file that now holds it. A validation report
   in `docs/validation/` is one such table.
5. A rule changed or approved on one example applies to all analogous elements, for example every
   insurance type or every widget in the catalogue.
6. The canvas catalogue and gallery show the real widgets, with every approved element, not simplified
   copies.
7. Explanations on a mockup go into canvas notes beside the element, never inside UI elements.
8. A design concept is not development. Status updates about design work do not talk about "code" until
   development has started.
9. No tests with real families for now.
10. Navigation between screens is not prototyped on the canvas: boards are not made clickable (owner
   2026-11-06: clickability is inconvenient on this board) and there is no separate screen diagram. For
   every screen it must be known how the user gets there: its entry points are written into the screen's
   or flow's requirement and the screen map.
11. Do not invent a new UI element when a suitable one already exists in the design system or on other
   screens (for example the chart period switch, view switch, filters, menus): reuse it as is. A new
   element appears only when nothing existing fits, and it is then added to the design system (CMP/DS)
   for reuse.

## Hard rules

- **Money:** never JS `number`, `parseFloat` or floats for amounts. Use the Money/Decimal type from
  `packages/domain-kernel`. Store the original currency; convert only with an explicit dated rate.
  Round only for display unless a requirement says otherwise.
- **Plans:** no plan names or limits in code. Check through the entitlement interface with the feature
  key from the requirement. Limits block creating new items; they never delete or hide data
  (API `402 PLAN_LIMIT_REACHED`).
- **Data access:** every query is scoped to one household and to the caller's role and scope (enforced
  in the database too). A user never learns that records outside their scope exist — no records,
  counts or sums.
- **Audit:** every data change writes an audit entry.
- **Privacy:** no personal data in logs, analytics or error reports. Agents use only synthetic data and
  provider sandboxes — never production data, secrets or real credentials.
- **Production:** agents act in production only through allowlisted actions with owner approval.
- **Vault:** highly sensitive items are encrypted on the device; the server never receives plaintext.
  Never store card CVV/CVC or PIN in any form.
- **Crypto and dependencies:** never write your own cryptography. Prefer well-known maintained libraries
  with allowed licences; a new dependency or external service needs a justification in the PR or an ADR.
- **Providers:** external services only through adapters; no provider SDK outside an adapter.
- **Regulatory boundary:** state facts only; no personalised investment, credit, tax or insurance advice;
  no third-party offers; the product never moves money.
- **UI:** every screen/widget has empty, loading and error states; no "Coming soon". WCAG 2.2 AA;
  all user-facing strings via i18n (uk and en complete).
- **Ambiguity:** if requirements disagree or a criterion is unclear on a real product question (product
  direction, scope or release, legal or compliance, money, access or infrastructure), do not guess. Stop
  and write the question in the PR body for the owner. Small product details (formats, rounding, default
  views, icons, placeholders, wording, which of two texts to follow when the intent is clear) the lead
  agent decides, records in the PR body and the decision log, and tells the owner afterwards.
- **Tests are the spec:** never change an acceptance test to fit the code unless the requirement changed.

## Definition of Done

- Every acceptance criterion and edge case has an automated test; CI green.
- Permission tests for every role and for a scoped member when data access changed.
- Entitlement check with the feature key; audit entries written; feature flag for new functions.
- Empty / loading / error states, WCAG 2.2 AA, i18n strings, widths 390, 768 and 1280 px (PoC and PoC v2:
  1280 px desktop and light theme only, П-25).
- No new High/Critical security findings.
- API contract updated; help texts updated if user-visible.
