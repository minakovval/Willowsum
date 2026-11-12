# Product requirements / Вимоги до продукту

**Створено:** 2026-11-01 · **Оновлено:** 2026-11-06

**English.** This folder is the single source of truth for Willowsum product requirements. It is a
versioned copy of the product specification: one file per requirement, plus
[00-general.md](00-general.md) with the product overview, releases, roles matrix, plan matrix, general
rules П-1…П-26, glossary and assumptions that apply to every requirement. Requirement IDs (for example
`BUD-03`, `AST-14a`) are stable: they are never renumbered or reused. Cite requirements by ID — start
branch names and PR titles with the ID (`BUD-03-safe-to-spend`, `BUD-03: safe-to-spend widget`).
A requirement changes only through a reviewed change to its file here, approved by the product owner.

**Українською.** Ця папка — єдине джерело правди щодо вимог до продукту Willowsum. Кожна вимога
лежить в окремому файлі; [00-general.md](00-general.md) містить загальні положення (продукт, релізи,
ролі, плани, загальні правила П-1…П-26, глосарій, припущення), що діють для всіх вимог. Ідентифікатори
вимог стабільні й ніколи не змінюються. Посилайтеся на вимогу за ідентифікатором — з нього починаються
назва гілки і назва PR.

## Release slices and links

Owner decision of 2026-11-04; the process is requirement PRC-01, the change process PRC-02.

Requirements are being migrated, in batches, from one file per requirement to a **card plus release slices**:

| File | Contents |
| --- | --- |
| `bud/BUD-16.md` — card | Heading, «Реліз» line naming every slice's release, link header with «Зрізи» and «Модуль», purpose, table of slices. No functional requirements and no criteria |
| `bud/BUD-16.poc.md`, `BUD-16.poc-v2.md`, `BUD-16.mvp.md`, `BUD-16.v1-mobile.md`, `BUD-16.v1.md`, `BUD-16.v2.md` — slices | One per release in which the requirement's scope changes. Heading `# BUD-16@PoC v2 · <title>`, `**Реліз:** PoC v2 · **Пріоритет:** S`, link header, then the full requirement text for that release |

A slice ID is written `BUD-16@PoC`, `BUD-16@PoC v2`, `BUD-16@MVP`. Release order: PoC → PoC v2 → MVP →
v1-mobile → v1 → v2 («Сейф» is part of MVP). A slice is **complete for its release**: every functional
requirement, rule, state, permission and acceptance criterion that holds there, with no «У релізі …»
override blocks; a later slice restates what it keeps. A slice stays in effect until the requirement's
next slice. A slice exists for each release on the «Реліз» line, and also for a release from which
behaviour that the general rules exclude from earlier releases starts (П-25 and П-26 for PoC and PoC v2;
plan limits from v1).

**Link header.** Right after the «Реліз» line, one field per line, fields in this fixed order; values are
comma-separated IDs, `—` for an empty list:

```markdown
**Зв'язки**
- Розширює: BUD-16@PoC
- Залежить від: BUD-01@PoC, BUD-02@PoC v2, BUD-05@PoC v2
- Дизайн: S-121, S-125
- Спільні правила: П-10, П-17, П-24, DS-01
- Сценарії: UC-BUD-87, UC-BUD-88
- Модуль: budget
- Перевіряється: —
```

| Field | Values | Rule |
| --- | --- | --- |
| Розширює | the same requirement's previous slice | exactly the slice of the previous release in which the requirement has a slice; `—` for the first slice |
| Залежить від | slices of other requirements (`FIN-01@PoC`); a plain ID only for a requirement without a release | same or earlier release, and the slice in effect in this slice's release; no cycles |
| Дизайн | screen IDs from `docs/ux/screen-map.md` (`S-121`) and canvas board names (`PocPlanBudget`) | screens must exist; board names are checked for shape only |
| Спільні правила | `П-n` from 00-general.md; IDs of DS, CMP, GRID, CHT, ARC, NFR, CICD, PRC, L10N, SCR | must exist and start no later than the slice |
| Сценарії | use-case IDs from `docs/ux/use-cases` (`UC-BUD-87`) | must exist |
| Модуль | module names from the ARC-01 catalogue | at least one, except in the shared areas DS, CMP, GRID, CHT, ARC, NFR, CICD, PRC, L10N, SCR (may be `—`) |
| Перевіряється | repository paths of tests | must exist |

A card's link header has only «Зрізи» (its slices, in release order, matching the files) and «Модуль» (exactly the union of its slices' modules).

**Self-contained text.** Requirement IDs may appear only in the link header. The body of a card or a
slice stays self-contained: no other requirement IDs (the checker enforces it).

**Not yet migrated.** A file without a link header keeps working as before: it counts as one implicit
slice per release on its «Реліз» line, without links, shown as «не мігровано» in the matrix. Only
top-level segments create implicit slices: the line is split on `;` and `·` outside parentheses, and a
segment counts when it starts with a release (`MVP (…)`) or ends with one (`решта — MVP`). A release
named only inside parentheses (`PoC (…; push — v1-mobile)`) and «основа в архітектурі й моделі даних — PoC»
create no slice. Other slices may depend on these implicit slices.

**Traceability.** `node tools/req-check/index.mjs --traceability` writes
[docs/traceability/](../traceability/README.md): `matrix.md` (one row per slice), `release-<key>.md` per
release (slices, Mermaid dependency graph, build sequence in waves) and `coverage.md` (screens without a
slice, slices without design, slices without criteria). The files are committed; CI regenerates them and
fails on any difference; the same CI step also regenerates `docs/validation/req-check-report.md`.
Run locally before pushing: `node --test tools/req-check` and
`node tools/req-check/index.mjs --report docs/validation/req-check-report.md --traceability` (0 errors).
CI jobs: `requirements` (these checks), `traceability` (PR title starts with a requirement ID), `web`, `secrets`,
`local-env`, `api`, `infra`.

**Change process (PRC-02).** Before changing a requirement, a slice, a screen, a canvas board or a
shared rule, run `node tools/req-check/index.mjs --impact <ID | slice | S-id | board | П-n | UC-id | module>`:
it lists every dependent slice transitively, with the files, screens, use cases, docs/ux mentions,
tests and modules to update. Update dependent slices in the same PR or list each one in the PR body as
follow-up with an issue; regenerate the traceability files and the report; record the owner's decision
in the PR body and in the decision log (`docs/decisions/`). Scope the owner removes from PoC moves to
PoC v2. Merge conditions are those of AGENTS.md step 7:

- CI green on the latest commit and «Ready» from a review in a separate session; changes to auth,
  permissions, encryption, money calculations, database schema, pipeline or infrastructure also need a
  separate security review;
- PRs that change requirements, AGENTS.md or skills: the PR body records the owner's decision;
- PRs that act on the cloud or production — applying infrastructure, deploying or releasing to
  production, or changing the workflows that do this or their trust settings (OIDC trust, production
  secrets store) or production DNS: only after the owner comments approval on that PR from their own GitHub
  account. Infrastructure code without apply, CI checks and the local environment need no such comment;
- no merge while the owner has said «stop» or has an open question on the PR;
- production releases and production actions need the owner's approval; never push to `main` directly.

When these hold, the authoring agent merges without asking the owner again.

Each module folder has a `README.md` with the module intro and a table of its requirements
(ID, title, release, priority). Text from a specification tab that is not part of any single
requirement is kept in the README of that module.

## Modules (435 requirements)

| Code | Folder | Scope | Requirements | Release mix |
| --- | --- | --- | --- | --- |
| ACC | [acc/](acc/README.md) | Account, sign-in, 2FA, sessions, profile, household space, roles, scope, audit log | 12 | PoC 5, MVP 5, v1-mobile 1, v2 1 |
| SUB | [sub/](sub/README.md) | Plans, entitlements, subscription lifecycle, billing and payments | 8 | MVP 5, v2 3 |
| ADM | [adm/](adm/README.md) | Platform admin panel: feature catalogue, plan x feature matrix, versions, staff | 9 | MVP 5, v1 4 |
| AST | [ast/](ast/README.md) | Physical assets, liabilities and collateral, lots, locations, groups, media | 17 | MVP 13, v1 3, v2 1 |
| VAL | [val/](val/README.md) | Valuation: observations, current-value policy, FX, ownership shares, net worth, map | 11 | PoC 2, MVP 6, v1 3 |
| FIN | [fin/](fin/README.md) | Accounts, bank aggregation, transactions, journal, recurring payments | 19 | PoC 4, PoC v2 2, MVP 3, v1 6, v2 4 |
| INV | [inv/](inv/README.md) | Investment instruments, prices and FX service, cost basis | 3 | MVP 1, v1 2 |
| CRY | [cry/](cry/README.md) | Crypto exchange journals and wallet/exchange/bank transfer pairing | 2 | v1 2 |
| BUD | [bud/](bud/README.md) | Budget, categories, safe-to-spend, savings goals, spending reports | 20 | PoC 14, PoC v2 3, MVP 3 |
| FCS | [fcs/](fcs/README.md) | Forecasts: period spending forecast, pace check and warnings, pace and forecast chart | 3 | PoC v2 3 |
| DOC | [doc/](doc/README.md) | Document storage, document types, expiry dates and links, OCR migration | 3 | MVP 2, v2 1 |
| INS | [ins/](ins/README.md) | Insurance policies, coverage analysis and insurance schedule | 2 | MVP 2 |
| NOT | [not/](not/README.md) | Reminders, notifications and notification triggers | 2 | MVP 1, v1 1 |
| DAT | [dat/](dat/README.md) | Universal list, global search, bulk actions, shared data rules | 5 | PoC 3, PoC v2 1, MVP 1 |
| SUP | [sup/](sup/README.md) | Support and help centre | 1 | PoC v2 1 |
| RPT | [rpt/](rpt/README.md) | Standard reports and report schedules | 2 | MVP 1, v2 1 |
| IMP | [imp/](imp/README.md) | File import engine: uploads, batches, multi-currency events, pairing, recipes | 19 | PoC 15, PoC v2 1, MVP 3 |
| UX | [ux/](ux/README.md) | Onboarding, complexity levels, navigation, home screen, hide amounts, personalisation | 9 | PoC 1, MVP 5, v2 3 |
| PLT | [plt/](plt/README.md) | Widgets, quick actions and other platforms | 2 | v1-mobile 1, v2 1 |
| GRID | [grid/](grid/README.md) | Layout grid, navigation shell and page templates | 8 | PoC 5, MVP 3 |
| WGT | [wgt/](wgt/README.md) | Home widgets: widget framework, registry, edit mode, one file per widget | 25 | MVP 25 |
| CHT | [cht/](cht/README.md) | Charts: reusable chart components (time series, spending vs budget, composition) | 4 | PoC 2, PoC v2 1, MVP 1 |
| L10N | [l10n/](l10n/README.md) | Localisation framework and translations | 2 | MVP 2 |
| LEG | [leg/](leg/README.md) | Legal documents, consent and in-app privacy settings | 1 | MVP 1 |
| VLT | [vlt/](vlt/README.md) | Personal documents vault: categories, encryption classes, sharing, emergency access | 21 | MVP 18, v2 3 |
| AI | [ai/](ai/README.md) | AI assistant, explanations and document parsing | 4 | v1 3, v2 1 |
| INT | [int/](int/README.md) | Open data access (API) | 1 | v2 1 |
| PLN | [pln/](pln/README.md) | Long-term forecast, retirement modelling, estate planning | 3 | v2 3 |
| ADV | [adv/](adv/README.md) | Financial adviser workspace (B2B) | 7 | v2 7 |
| NFR | [nfr/](nfr/README.md) | Non-functional requirements: security, compliance, availability, performance, DoD | 19 | PoC 17, PoC v2 1, v1-mobile 1 |
| DS | [ds/](ds/README.md) | Design system foundations: principles, brand, tokens, charts, status dictionary | 23 | PoC 16, PoC v2 1, MVP 6 |
| CMP | [cmp/](cmp/README.md) | UI components (one requirement per component) | 74 | PoC 40, MVP 26, v1 3, PoC v2 5 |
| FLW | [flw/](flw/README.md) | End-to-end user flows | 58 | PoC 11, MVP 28, v1 5, v2 9, PoC v2 5 |
| JRN | [jrn/](jrn/README.md) | User journeys | 9 | PoC 2, MVP 3, v2 2, n/a 2 |
| SCR | [scr/](scr/README.md) | Screen inventory and screen rules | 2 | n/a 2 |
| ARC | [arc/](arc/README.md) | Architecture requirements | 11 | PoC 9, PoC v2 2 |
| CICD | [cicd/](cicd/README.md) | CI/CD and operations requirements | 12 | PoC 9, MVP 2, v1-mobile 1 |
| PRC | [prc/](prc/README.md) | Engineering and delivery process: requirement process (release slices, links, traceability), change process and impact analysis | 2 | PoC 2 |

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
- [prc/](prc/README.md)
