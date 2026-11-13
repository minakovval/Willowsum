# Rules for AI agents working in this repository

**Створено:** 2026-11-01 · **Оновлено:** 2026-11-13

This is the single rule set for every agent (and human) changing this repository. It is short on purpose:
read it fully, then load only the files your task needs. If a task conflicts with this file, stop and ask
the product owner.

Willowsum is built from scratch. The requirements are complete; the code is written requirement by
requirement, following the architecture requirements (ARC) and delivery requirements (CICD).

Current phase: PoC development. On 2026-11-06 the owner approved the PoC design («дизайн ок») and started
development; build the PoC requirement by requirement in the waves of the generated `release-poc.md`
(«Where things are»: not committed, generate it or read it from main's `traceability` artifact), with the canvas (snapshot in `design/canvas/`) as the visual reference. The PoC shell code already in
`main` (PRs #46, #47, #52, #54, #55) is the starting point; issues #49 and #51 are now open for work.
«Process: design before code» still applies to every later release (PoC v2, MVP, …): no code for a
release until the owner has approved its design and started its development.

## Where things are

| What | Where |
| --- | --- |
| Product requirements (single source of truth) | `docs/requirements/` — one source file per requirement ID (`bud/BUD-16.md`, edited) and its generated release views (`bud/BUD-16.poc.md`, …, read-only); index per module |
| Product, releases, roles, plan matrix, general rules П-1…П-26, glossary | `docs/requirements/00-general.md` |
| Requirement process: sources, release views, links, traceability; change process | `docs/requirements/prc/` (PRC-01, PRC-02); format in `docs/requirements/README.md` («Source and generated release views») |
| Release views (generated, committed) | next to their sources — regenerate with `node tools/req-check/index.mjs --views` |
| Traceability matrix, per-release build sequence, coverage, req-check report (generated, **not committed**; owner, 2026-11-13) | on demand: `node tools/req-check/index.mjs --quiet --traceability --report docs/validation/req-check-report.md` writes `docs/traceability/` and the report (both git-ignored); without a checkout: the latest run of the workflow «Requirements traceability» on `main` (summary: report and PoC build sequence; artifact `traceability`: every file) |
| Architecture and delivery requirements | `docs/requirements/arc/`, `docs/requirements/cicd/` |
| Non-functional requirements | `docs/requirements/nfr/` |
| Design system, components, flows | `docs/requirements/ds/`, `cmp/`, `flw/`, `jrn/`, `scr/` |
| Architecture decisions (written while building) | `docs/adr/` — do not contradict an accepted ADR; propose a new one |
| Project state and owner decision log | `docs/decisions/`: one new file per decision in `log/` (`YYYY-MM-DD-<short-slug>.md`, a numeric suffix if the name is taken; owner, 2026-11-13); `state-2026-11-05.md` is the archive of everything before, never appended to |
| Screen map (screens S-NNN, entry points), use cases, user journeys | `docs/ux/` |
| Design artifacts (canvas, design system, Claude Doc, release sheet), snapshots, recovery | `docs/design/ARTIFACTS.md`; snapshots in `design/` |
| Coverage tables of design decisions | `docs/validation/` |
| External services (integrations list), browser instructions for the owner | `docs/ops/` (`integrations.md`, `browser-tasks/`) |

Requirement views are self-contained: you never need another source to implement one. A requirement
changes only through a PR to its source file that records the owner's decision.

Each migrated requirement has **one source file** (`bud/BUD-16.md`, owner, 2026-11-12): the card part, then
`## Джерело зрізів` and the text of every release, each release-specific line tagged with its releases
(`[PoC]`, `[PoC v2]`, `[PoC–MVP]`, `[лише PoC]`). Its **release views** (`bud/BUD-16.poc.md`,
`BUD-16.poc-v2.md`, …; ID `BUD-16@PoC`, also called slices) are generated from it. A view is complete for its
release: to build a release, read only the views of that release (and the latest earlier view of each
requirement that has none in it). Never edit a view: edit the source and run
`node tools/req-check/index.mjs --views`; CI fails on a view that differs from its source. Links to other
requirements, screens, П-rules, use cases, modules and tests live only in the fixed «Зв'язки» header; IDs are
allowed there and nowhere else in the text. Requirements not migrated yet (JRN-00, JRN-08, SCR-01, SCR-02)
keep the old one-file format. Format, tags and commands: `docs/requirements/README.md`, «Source and generated
release views». Scope that the owner removes from PoC (from 2026-11-04) moves to PoC v2: move its items with
`node tools/req-check/index.mjs --move <ID> --items FR4,AC5 --to "PoC v2"`, which changes their tags in the
source and regenerates the views.

Before changing a requirement, a screen or a shared rule, run
`node tools/req-check/index.mjs --impact <ID|slice|S-id|board|П-n|UC-id|module>` and update every
dependent slice in the same PR or list it as follow-up with an issue in the PR body (PRC-02). Edit only
sources: `--move` moves items between releases (and warns about cited item numbers that shift and about
the moved items still mentioned elsewhere); rewording is a plain edit of the source. Then regenerate, in the
same PR and in this order:

- the views: `node tools/req-check/index.mjs --views` (0 errors; commit the regenerated views);
- `node tools/req-check/index.mjs --check-mentions` (no test names an item its view does not have) and
  `node --test tools/req-check`. The traceability files and the req-check report are not committed (owner,
  2026-11-13): CI generates them on every PR and fails if that fails. The skill `change-requirement` has the
  full procedure.

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
| PRC | `docs/requirements/`, `tools/req-check/`, `tools/pr-rules/`, `.github/workflows/` |

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
2. Load only the requirement file (for a migrated requirement: the view of the target release,
   `<ID>.<release key>.md`, plus what its «Зв'язки» header names), the sections of `00-general.md` it relies on, the module card and
   the code of that module. For wide searches use a read-only subagent and keep only its conclusion.
3. Follow the `implement-requirement` skill. Tests first: one automated test per acceptance criterion
   and per edge case.
4. Branch `<ID>-<slug>`, or the working branch the lead names («Parallel branches» below); PR title starts
   with the ID, e.g. `BUD-03: safe-to-spend widget`.
5. Review is done in a **different** session with the `review-pr` skill. A security review in another
   session (`security-review` skill) is needed only for PRs labelled `sensitive` (CI sets it from file paths: auth, permissions,
   encryption, money calculations, database schema, pipeline, infrastructure). Every review names the head
   commit (full SHA) it reviewed and ends with a line of its own: `Verdict: Ready` or
   `Verdict: Changes requested` (review-pr), and `Security verdict: Ready` or
   `Security verdict: Changes requested` (security review). The daily check (ADR-0008) reads exactly these
   lines (owner, 2026-11-12). Review rounds (owner, 2026-11-12):
   - Only these block: a security bypass, data loss or leak, or a violation of the requirement the PR
     claims (its FR/AC or a shared rule). Everything else is non-blocking: it goes to «Follow-ups» in the PR
     body or to an issue and never starts a new round by itself.
   - A re-review checks only the fixes and its own previous findings (the diff since the last reviewed head),
     not the whole PR again.
   - At most two rounds. If something blocking remains after round 2, the reviewer supplies a ready fix with
     a test; the author applies it, and the reviewer briefly confirms that fix, still with a verdict that
     names the final head SHA.
   - Mutation testing is required only for critical modules: data isolation, money, authentication,
     encryption.
   - A recurring finding moves into automation: a repeated class of finding becomes a CI check or a test;
     before pushing, agents run a local check for secret-shaped literals (what the CI job `secrets` checks),
     and before pushing or setting a PR body, the local PR description and sensitive-label check
     `node tools/pr-rules/index.mjs local --title "<title>" --body-file <file>` (what the job `traceability`
     and the label job check; owner, 2026-11-13). A test named by a requirement item that does not exist fails
     the job `requirements` (`--check-mentions`).
   - Keep PRs small: split a large requirement part (e.g. backend and UI) so each PR fits one review round.
6. All CI checks green (jobs `requirements`, `changes`, `web`, `traceability`, `secrets`, `local-env`, `api`, `infra`, `e2e`;
   a job its path filter skips counts as passed, see «CI minutes» below). Never skip, disable or weaken a
   test to get green.
7. The lead merges the PR (squash) only when CI is green on the latest commit and both verdicts are Ready
   on the exact head: the review session gave «Ready» (plus the security review for sensitive areas) **on the
   commit being merged** (owner, 2026-11-13): before merging, compare the SHA each review names with the PR head; any later
   commit, even a small fix, needs a re-review of that fix (owner, 2026-11-12). PRs that change requirements, AGENTS.md or
   skills (label `owner-decision`) are merged only when the PR body records the owner's decision they implement (and the decision
   log in `docs/decisions/` has it). A purely mechanical sync of a list in AGENTS.md that a test requires needs no
   owner decision: only adding or removing a CI job name in the job list of step 6, or a skill's name with its
   own `description` line in «Skills»; nothing else qualifies. The PR body still notes it under «Owner
   decision» as a mechanical sync. Any change to a rule needs one (owner, 2026-11-13). For a docs-only PR that moves scope between releases, a security review (when needed) covers only the moved lines that state a protection (owner, 2026-11-12). The owner's approval on the PR is needed only for what acts on the
   cloud or production. It is either a comment from the owner's own GitHub account with a line that is exactly
   «Схвалюю» or «Approved», or the owner's decision from chat recorded in the PR body as a line
   `Рішення власника (YYYY-MM-DD): схвалено …` (owner, 2026-11-12). Agents never write a «Схвалюю» or
   «Approved» line, and write the body line only for a decision the owner actually gave. Approval is needed for: applying
   infrastructure (`tofu apply`), deploying or releasing to production, and changing the workflows that do
   this or the trust settings they use (OIDC trust, the production secrets store) or production DNS. Code
   that is only validated (infrastructure as code without apply, KMS and access rules described as code),
   CI check jobs and the local environment need no approval (owner, 2026-11-06). If the owner commented
   «stop» or asked a question on the PR, do not merge until they answer. Production releases still need the
   owner's approval. Never push to `main` directly: the free GitHub plan cannot block it, so the process
   is the protection.
   Once these conditions hold: do not ask the owner to confirm the merge; merge at once and tell the
   owner it is merged. **Merge on Ready, follow up separately** (owner, 2026-11-13): when both verdicts are Ready
   and only non-blocking findings remain, the lead merges; those items go to a follow-up PR or issue, not into
   the same PR, so they do not start another review round. Exception: a non-blocking item the reviewer marks as
   cheap and safe to fold in may still be added before merge, at the lead's choice (it then needs a re-review of
   that commit, as above).

If the work does not fit one session, split it by acceptance criteria into several PRs, each green on
its own, and list in the PR body which criteria are left.

**Parallel branches** (owner, 2026-11-12): up to 3 working branches at a time — the lead's branch
`claude/adoring-cray-feh4dh` and `claude/adoring-cray-feh4dh-<task>` — each in its own git worktree with its
own PR. The same review, CI and merge rules apply to each; a branch is deleted after its PR is merged. Each
agent uses its own test database (`pnpm db:test`); integration tests run as
`pnpm db:test run -- pnpm test:integration`, because PostgreSQL roles are shared by the whole cluster
(`infra/local/README.md`).

**Skills** (`.claude/skills/`, owner, 2026-11-12): `implement-requirement` (author), `review-pr` (reviewer),
`security-review` (security reviewer of `sensitive` PRs), `fix-review-findings` (author, after reviews),
`pr-pipeline` (the lead's loop over these), `browser-task` (instructions for the owner's local Claude session
with a browser), `sync-branch` (merge `origin/main` into a working branch: merge only, checks, confirmation on the new
head), `change-requirement` (changing requirements, screens or П-rules without code: decisions collected first, impact, `--move` in the source, views regenerated, one batch PR, lighter review), `deploy` (deploying to Oracle Cloud; the server does not exist yet, so unverified steps are marked), `screen-from-canvas` (author of a design-system component or screen: requirement view, card, board and tokens; tests by criteria, states, gallery entry, uk and en strings, accessibility, a 1280 px screenshot check), `plan-wave` (the lead's plan of the next delivery wave: uncovered PoC slices ordered by dependency, grouped into reviewable PRs, owner questions marked, `docs/plans/poc-wave-N.md`), `investigate-ci-failure` (a red or blocked CI run: reproduce locally, compare with `main`, at most one re-run, root cause, the failing run and the same check green after the fix). Token economy (owner request, 2026-11-12): pick each agent's model by risk, give re-reviews to
a fresh agent with a narrow brief, let reviewers rely on CI — rules in `pr-pipeline`, «Token economy».

**CI minutes** (lead, 2026-11-12; updated by the owner's decision of 2026-11-13, item 5: the repository is
public since 2026-11-13, so GitHub Actions minutes are free, but jobs stay lean and path-filtered): a new push cancels the PR's run in progress;
the pnpm store is cached; the job `changes` skips `web`, `api`, `local-env`, `infra` and `e2e`
when the PR's paths do not need them (docs-only PRs skip all five; `e2e`, NFR-07@PoC, runs on every code change
except `infra/`, `tools/` and the root lint, format and ignore files, with only Chromium and WebKit installed and cached; a skipped job concludes `skipped` and
counts as passed only when `tools/pr-rules/lib/ci-paths.mjs` says the PR did not need it). Do not add
scheduled or frequent workflows without counting their minutes. «Requirements traceability» runs once per push to
`main` (about a minute; owner, 2026-11-13) to publish the generated traceability files.

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

## External services and owner actions

Owner decision of 2026-11-12:

- `docs/ops/integrations.md` is the single list of all third-party services: purpose, account, how we
  interact, where credentials live, data sent, region, plan, requirements, status. The PR that adds or
  changes an integration updates its row.
- Agents never hold the owner's accounts or keys. When the owner must act in a browser (accounts,
  settings, DNS, legal acceptance), the lead writes a ready instruction in `docs/ops/browser-tasks/` for the
  owner's local Claude session with a browser. That session does the work itself and stops only for
  sign-in, payment, legal acceptance and saving secrets to the owner's password manager. Secrets never go
  to chat, issues, PRs or the repository.

## Definition of Done

- Every acceptance criterion and edge case has an automated test; CI green.
- Permission tests for every role and for a scoped member when data access changed.
- Entitlement check with the feature key; audit entries written; feature flag for new functions.
- Empty / loading / error states, WCAG 2.2 AA, i18n strings, widths 390, 768 and 1280 px (PoC and PoC v2:
  1280 px desktop and light theme only, П-25).
- No new High/Critical security findings.
- API contract updated; help texts updated if user-visible.
