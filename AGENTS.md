# Rules for AI agents working in this repository

This is the single rule set for every agent (and human) changing this repository. It is short on purpose:
read it fully, then load only the files your task needs. If a task conflicts with this file, stop and ask
the product owner.

Willowsum is built from scratch. The requirements are complete; the code is written requirement by
requirement, following the architecture requirements (ARC) and delivery requirements (CICD).

## Where things are

| What | Where |
| --- | --- |
| Product requirements (single source of truth) | `docs/requirements/` — one file per requirement ID, index per module |
| Product, releases, roles, plan matrix, general rules П-1…П-23, glossary | `docs/requirements/00-general.md` |
| Architecture and delivery requirements | `docs/requirements/arc/`, `docs/requirements/cicd/` |
| Non-functional requirements | `docs/requirements/nfr/` |
| Design system, components, flows | `docs/requirements/ds/`, `cmp/`, `flw/`, `jrn/`, `scr/` |
| Architecture decisions (written while building) | `docs/adr/` — do not contradict an accepted ADR; propose a new one |

Requirement files are self-contained: you never need another source to implement one. A requirement
changes only through a PR to its file, approved by the owner.

## Planned code layout

Created by the first tasks (ARC-01, ARC-07, CICD-02); follow it, do not invent another.

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

The full module catalogue (78 modules, what each one owns) and the modularity rules are in
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
| Money | `accounts`, `transactions`, `ledger`, `merchants`, `categorization`, `duplicate-matching`, `transfer-matching`, `bank-consents`, `bank-sync`, `bank-monobank`, `bank-saltedge`, `recurring`, `holdings`, `cost-basis`, `broker-events`, `crypto` |
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
| FIN | `liabilities`, `accounts`, `transactions`, `ledger`, `duplicate-matching`, `transfer-matching`, `bank-consents`, `bank-sync`, `bank-monobank`, `bank-saltedge`, `recurring` |
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
| UX, GRID | `onboarding`, `dashboard`, `saved-views`, `bulk-actions`, `apps/web`, `packages/ui` |
| L10N, PLT, DS, CMP, FLW, JRN, SCR | `apps/web`, `apps/admin`, `packages/ui`, `packages/i18n` |
| NFR, ARC, CICD | whole repo, `.github/workflows/`, `infra/` |

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
2. Load only the requirement file, the sections of `00-general.md` it relies on, the module card and
   the code of that module. For wide searches use a read-only subagent and keep only its conclusion.
3. Follow the `implement-requirement` skill. Tests first: one automated test per acceptance criterion
   and per edge case.
4. Branch `<ID>-<slug>`; PR title starts with the ID, e.g. `BUD-03: safe-to-spend widget`.
5. Review is done in a **different** session with the `review-pr` skill. Auth, permissions, encryption,
   money calculations, database schema, pipeline and infrastructure also need a security review.
6. All CI checks green. Never skip, disable or weaken a test to get green.
7. Only the owner merges to `main` and approves production releases. Never push to `main` directly:
   the free GitHub plan cannot block it, so the process is the protection.

If the work does not fit one session, split it by acceptance criteria into several PRs, each green on
its own, and list in the PR body which criteria are left.

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
- **Ambiguity:** if requirements disagree or a criterion is unclear, do not guess. Stop and write the
  question in the PR body for the owner.
- **Tests are the spec:** never change an acceptance test to fit the code unless the requirement changed.

## Definition of Done

- Every acceptance criterion and edge case has an automated test; CI green.
- Permission tests for every role and for a scoped member when data access changed.
- Entitlement check with the feature key; audit entries written; feature flag for new functions.
- Empty / loading / error states, WCAG 2.2 AA, i18n strings, widths 390, 768 and 1280 px.
- No new High/Critical security findings.
- API contract updated; help texts updated if user-visible.
