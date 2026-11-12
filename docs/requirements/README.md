# Product requirements / Вимоги до продукту

**Створено:** 2026-11-01 · **Оновлено:** 2026-11-12

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
| `bud/BUD-16.md` — card (the source) | Heading, «Реліз» line naming every slice's release, link header with «Зрізи» and «Модуль», purpose, table of slices; then `## Джерело зрізів` and the slice text with release tags. The card part has no functional requirements and no criteria |
| `bud/BUD-16.poc.md`, `BUD-16.poc-v2.md`, `BUD-16.mvp.md`, `BUD-16.v1-mobile.md`, `BUD-16.v1.md`, `BUD-16.v2.md` — slices (generated views) | One per release in which the requirement's scope changes. Heading `# BUD-16@PoC v2 · <title>`, the «згенеровано» header, `**Реліз:** PoC v2 · **Пріоритет:** S`, link header, then the full requirement text for that release |

Since 2026-11-12 (owner decision, PRC-01) the card of a migrated requirement is its **source**: one file
that also holds the text of every slice, each release-specific line tagged with its releases. The slice files
are **views generated** from it (see «Source and generated release views» below); they keep their paths and
their content, and are read exactly as before. Only the source is edited.

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

## Source and generated release views

Owner decision of 2026-11-12 (PRC-01). A migrated requirement has **one source file**, `bud/BUD-16.md`. Its
release views `bud/BUD-16.poc.md`, `BUD-16.poc-v2.md`, … are generated from it by
`node tools/req-check/index.mjs --views`, the way `docs/traceability/` is. To implement a release, read only
that release's view (as before); to change a requirement, edit only the source and regenerate.

**Shape of the source.** The card part, unchanged (heading, «Реліз» line, «Зв'язки» with «Зрізи» and
«Модуль», purpose, table of slices), then a blank line, the fixed line `## Джерело зрізів`, then the
**slice text**: every line that any view has after its heading, merged once, with release tags.

```markdown
## Джерело зрізів

[лише PoC] **Реліз:** PoC · **Пріоритет:** S
[PoC v2] **Реліз:** PoC v2 · **Пріоритет:** S

**Зв'язки**
- [лише PoC] Розширює: —
- [PoC v2] Розширює: BUD-16@PoC
- [лише PoC] Залежить від: BUD-02@PoC
- [PoC v2] Залежить від: BUD-02@PoC v2, BUD-05@PoC v2
- Модуль: budget
…
**Функціональні вимоги**
#. [PoC] Пункт, що діє з PoC в усіх релізах.
#. [лише PoC] Пункт, що діє лише в PoC (у PoC v2 його прибрано або замінено).
#. [PoC v2] Нове формулювання того самого пункту з PoC v2.
| [PoC v2] Рядок таблиці | так |
[PoC v2]
```

**Release tags.** A tag is `[…]` at the start of a line's text: after the indentation and a list marker
(`1. `, `#. `, `- `), after the opening `| ` of a table row, or at the very start of any other line (a tagged
empty line is just `[PoC v2]`). One space after the tag belongs to the tag. Inside the brackets,
comma-separated terms:

| Term | Releases |
| --- | --- |
| `PoC v2` | PoC v2 and every later release |
| `PoC–MVP` | PoC to MVP, inclusive (en dash, no spaces) |
| `лише PoC` | PoC only |

Release order: PoC → PoC v2 → MVP → v1-mobile → v1 → v2. A line **without a tag** is in every view. The
view of release R holds every line whose tag includes R — tagged for R, or for an earlier release and not
ended before R — in source order, so an item tagged `[PoC]` stays in every later view until a tag ends it
(`[PoC–PoC v2]`, `[лише PoC]`) and a per-release variant replaces it. Rewording is two lines with adjacent
ranges, old then new; a renumbered item is one line.

**Numbering.** `#.` at the start of an item is numbered when the view is generated: the previous number of
the same list in that view plus one (1 first). A numbered line closes deeper lists; any other non-blank line
closes the lists at its indentation and deeper. Write an explicit number (`7. [MVP] …`) only where the view
needs a number that `#.` would not give; `#. ` is reserved and never appears in a view.

**Rules** (req-check, check 7):

- Every list item of the slice text (functional requirements, criteria, edge cases, any `1. `, `#. ` or
  `- ` line, also indented ones) carries a tag, also when it holds in every release (`[PoC]`); the field
  lines of the «Зв'язки» block are tagged only where they differ between releases. A continuation line
  is a line of its own and needs its own tag when its item has one.
- A tag must parse and select at least one view; the views are the releases in «Зрізи».
- Each view on disk must equal what the source generates (`view-stale`, `view-missing`, `view-extra`). A slice
  file whose line 2 is the «Згенеровано з» header but which no source generates (the source's
  `## Джерело зрізів` section was deleted or broken) is an error too (`view-orphan`).
  CI regenerates the views with the traceability files and fails on any difference.
- All other checks (structure, links, criteria, facts, self-containedness, `--impact`, traceability) read the
  generated views; a finding in a view points at the source line it came from, prefixed with the slice ID.

**Generated view.** Line 1 is the heading `# BUD-16@PoC v2 · <title>` (title from the card), line 2 the
header below, then the selected lines. Apart from line 2, a view is byte for byte the slice file it replaced.

```markdown
> Згенеровано з [BUD-16.md](BUD-16.md) командою `node tools/req-check/index.mjs --views`. Не редагувати: змінюйте джерело.
```

**Commands.**

| Command | What it does |
| --- | --- |
| `node tools/req-check/index.mjs --views` | Write every view from its source; remove view files a source no longer lists; then check |
| `node tools/req-check/index.mjs --convert <ID\|all>` | Turn a card and its slice files into a source; written only when every view round-trips byte for byte, otherwise the requirement keeps its card and slice files and is listed as an exception |
| `node tools/req-check/index.mjs --move <ID> --items FR4,AC5 --to "PoC v2" [--from PoC]` | Move items (numbered as in the `--from` view, default the first) so that they start in the target release: changes the tags of the item and its continuation lines, regenerates the views, prints the changed views, the dependents (`--impact` of each changed slice), the mentions of the items' «…» phrases elsewhere and any item now beside a variant of itself. It also warns about the items whose number changed in a view and every citation of such a number (`FR 15`, `AC 3`) in the same source and in tests and docs (`BUD-12@PoC FR 15`), and about the moved items' phrases still used in other items of the same source; fix each in the same PR. The target view must exist; add a new release by hand first («Зрізи», the card's «Реліз» line and table, the release and «Розширює» lines of the slice text) |
| `node tools/req-check/index.mjs --coverage` | Per-item and per-release coverage: tests named by item (`ACC-01 FR 12`, `UX-09@PoC AC7`, `BUD-16 EC2`; `item n` = FR, `criterion n` = AC) are mapped to items of the views. An item of a source is one source line, so a test of PoC FR 3 also covers that item in every later view that keeps the line, whatever its number there. A plain ID means the release named for it elsewhere in the test file, else its first slice. Without a «Функціональні вимоги» label, FR n is item n of the first numbered list |

**Rollback.** The last commit in the card plus slice files format is on branch
`claude/adoring-cray-feh4dh-requirements-format-v1` (5f563b03e90ef636e5aaab624b6ed5e2100d3efb). To roll back
and keep later edits: run `--views`, then for each source cut the card part back out (everything before the
blank line and `## Джерело зрізів`) and delete line 2 of each view; the views are then the slice files again,
edited by hand.

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

**Change process (PRC-02).** Edit only sources: move scope between releases with `--move`, reword in the
source, then regenerate the views with `--views` (never edit or hand-merge a view). Before changing a
requirement, a slice, a screen, a canvas board or a shared rule, run `node tools/req-check/index.mjs --impact <ID | slice | S-id | board | П-n | UC-id | module>`:
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
