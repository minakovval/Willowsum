# Module map

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-13

Moved out of AGENTS.md without change (owner, 2026-11-13: shorter AGENTS.md and skills). Read when you need to know which module owns a capability or which modules implement a requirement code.

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
| PRC | `docs/requirements/`, `tools/req-check/`, `tools/pr-rules/`, `.github/workflows/` |

Transaction flow: source (`bank-sync` + a bank adapter, `import-sessions`, `receipts`, manual entry) →
`transactions` → `merchants` → `categorization` → `duplicate-matching` → `transfer-matching` → `ledger` →
`budget`, `reports`, `net-worth`, `cashflow` (all via events).
