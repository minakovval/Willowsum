# Product requirements / Вимоги до продукту

**English.** This folder is the single source of truth for Willowsum product requirements. It is a
versioned copy of the product specification: one file per requirement, plus
[00-general.md](00-general.md) with the product overview, releases, roles matrix, plan matrix, general
rules П-1…П-23, glossary and assumptions that apply to every requirement. Requirement IDs (for example
`BUD-03`, `AST-14a`) are stable: they are never renumbered or reused. Cite requirements by ID — start
branch names and PR titles with the ID (`BUD-03-safe-to-spend`, `BUD-03: safe-to-spend widget`).
A requirement changes only through a reviewed change to its file here, approved by the product owner.

**Українською.** Ця папка — єдине джерело правди щодо вимог до продукту Willowsum. Кожна вимога
лежить в окремому файлі; [00-general.md](00-general.md) містить загальні положення (продукт, релізи,
ролі, плани, загальні правила П-1…П-23, глосарій, припущення), що діють для всіх вимог. Ідентифікатори
вимог стабільні й ніколи не змінюються. Посилайтеся на вимогу за ідентифікатором — з нього починаються
назва гілки і назва PR.

Each module folder has a `README.md` with the module intro and a table of its requirements
(ID, title, release, priority). Text from a specification tab that is not part of any single
requirement is kept in the README of that module.

## Modules (431 requirements)

| Code | Folder | Scope | Requirements | Release mix |
| --- | --- | --- | --- | --- |
| ACC | [acc/](acc/README.md) | Account, sign-in, 2FA, sessions, profile, household space, roles, scope, audit log | 12 | MVP 10, v1-mobile 1, v2 1 |
| SUB | [sub/](sub/README.md) | Plans, entitlements, subscription lifecycle, billing and payments | 8 | MVP 4, v1 1, v2 3 |
| ADM | [adm/](adm/README.md) | Platform admin panel: feature catalogue, plan x feature matrix, versions, staff | 9 | MVP 5, v1 4 |
| AST | [ast/](ast/README.md) | Physical assets, liabilities and collateral, lots, locations, groups, media | 17 | MVP 13, v1 3, v2 1 |
| VAL | [val/](val/README.md) | Valuation: observations, current-value policy, FX, ownership shares, net worth, map | 11 | MVP 8, v1 3 |
| FIN | [fin/](fin/README.md) | Accounts, bank aggregation, transactions, journal, recurring payments | 19 | MVP 9, v1 6, v2 4 |
| INV | [inv/](inv/README.md) | Investment instruments, prices and FX service, cost basis | 3 | v1 3 |
| CRY | [cry/](cry/README.md) | Crypto exchange journals and wallet/exchange/bank transfer pairing | 2 | v1 2 |
| BUD | [bud/](bud/README.md) | Budget, categories, safe-to-spend, savings goals, spending reports | 20 | MVP 20 |
| FCS | [fcs/](fcs/README.md) | Forecasts: period spending forecast, pace check and warnings, pace and forecast chart | 3 | MVP 3 |
| DOC | [doc/](doc/README.md) | Document storage, document types, expiry dates and links, OCR migration | 3 | MVP 2, v2 1 |
| INS | [ins/](ins/README.md) | Insurance policies, coverage analysis and insurance schedule | 2 | MVP 2 |
| NOT | [not/](not/README.md) | Reminders, notifications and notification triggers | 2 | MVP 1, v1 1 |
| DAT | [dat/](dat/README.md) | Universal list, global search, bulk actions, shared data rules | 5 | MVP 5 |
| SUP | [sup/](sup/README.md) | Support and help centre | 1 | MVP 1 |
| RPT | [rpt/](rpt/README.md) | Standard reports and report schedules | 2 | MVP 1, v2 1 |
| IMP | [imp/](imp/README.md) | File import engine: uploads, batches, multi-currency events, pairing, recipes | 19 | MVP 19 |
| UX | [ux/](ux/README.md) | Onboarding, complexity levels, navigation, home screen, hide amounts, personalisation | 9 | MVP 6, v2 3 |
| PLT | [plt/](plt/README.md) | Widgets, quick actions and other platforms | 2 | v1-mobile 1, v2 1 |
| GRID | [grid/](grid/README.md) | Layout grid, navigation shell and page templates | 8 | MVP 8 |
| WGT | [wgt/](wgt/README.md) | Home widgets: widget framework, registry, edit mode, one file per widget | 25 | MVP 25 |
| CHT | [cht/](cht/README.md) | Charts: reusable chart components (time series, spending vs budget, composition) | 4 | MVP 4 |
| L10N | [l10n/](l10n/README.md) | Localisation framework and translations | 2 | MVP 2 |
| LEG | [leg/](leg/README.md) | Legal documents, consent and in-app privacy settings | 1 | MVP 1 |
| VLT | [vlt/](vlt/README.md) | Personal documents vault: categories, encryption classes, sharing, emergency access | 21 | MVP 18, v2 3 |
| AI | [ai/](ai/README.md) | AI assistant, explanations and document parsing | 4 | v1 3, v2 1 |
| INT | [int/](int/README.md) | Open data access (API) | 1 | v2 1 |
| PLN | [pln/](pln/README.md) | Long-term forecast, retirement modelling, estate planning | 3 | v2 3 |
| ADV | [adv/](adv/README.md) | Financial adviser workspace (B2B) | 7 | v2 7 |
| NFR | [nfr/](nfr/README.md) | Non-functional requirements: security, compliance, availability, performance, DoD | 19 | MVP 18, v1-mobile 1 |
| DS | [ds/](ds/README.md) | Design system foundations: principles, brand, tokens, charts, status dictionary | 23 | MVP 23 |
| CMP | [cmp/](cmp/README.md) | UI components (one requirement per component) | 72 | MVP 69, v1 3 |
| FLW | [flw/](flw/README.md) | End-to-end user flows | 58 | MVP 44, v1 5, v2 9 |
| JRN | [jrn/](jrn/README.md) | User journeys | 9 | MVP 5, v2 2, n/a 2 |
| SCR | [scr/](scr/README.md) | Screen inventory and screen rules | 2 | n/a 2 |
| ARC | [arc/](arc/README.md) | Architecture requirements | 11 | MVP 11 |
| CICD | [cicd/](cicd/README.md) | CI/CD and operations requirements | 12 | MVP 11, v1-mobile 1 |

## Folders

- [acc/](acc/README.md)
- [sub/](sub/README.md)
- [adm/](adm/README.md)
- [ast/](ast/README.md)
- [val/](val/README.md)
- [fin/](fin/README.md)
- [inv/](inv/README.md)
- [cry/](cry/README.md)
- [bud/](bud/README.md)
- [fcs/](fcs/README.md)
- [doc/](doc/README.md)
- [ins/](ins/README.md)
- [not/](not/README.md)
- [dat/](dat/README.md)
- [sup/](sup/README.md)
- [rpt/](rpt/README.md)
- [imp/](imp/README.md)
- [ux/](ux/README.md)
- [plt/](plt/README.md)
- [grid/](grid/README.md)
- [wgt/](wgt/README.md)
- [cht/](cht/README.md)
- [l10n/](l10n/README.md)
- [leg/](leg/README.md)
- [vlt/](vlt/README.md)
- [ai/](ai/README.md)
- [int/](int/README.md)
- [pln/](pln/README.md)
- [adv/](adv/README.md)
- [nfr/](nfr/README.md)
- [ds/](ds/README.md)
- [cmp/](cmp/README.md)
- [flw/](flw/README.md)
- [jrn/](jrn/README.md)
- [scr/](scr/README.md)
- [arc/](arc/README.md)
- [cicd/](cicd/README.md)
