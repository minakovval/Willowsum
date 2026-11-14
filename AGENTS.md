# Rules for AI agents working in this repository

**Створено:** 2026-11-01 · **Оновлено:** 2026-11-14

This is the single rule set for every agent (and human) changing this repository. It keeps the hard rules and
the essentials; rarely needed parts are in `.claude/references/`, each linked below with «read when …» (owner,
2026-11-13). If a task conflicts with these rules, stop and ask the product owner.

Willowsum is built from scratch, requirement by requirement, following the architecture (ARC) and delivery
(CICD) requirements. Current phase: PoC development (design approved by the owner on 2026-11-06): build the PoC
in the waves of the generated `release-poc.md` (see the table below) with the canvas (`design/canvas/`) as the
visual reference. No code for a later release (PoC v2, MVP, …) until the owner has approved its design and
started its development — [design before code](.claude/references/design-before-code.md) (read when you work
on design or the canvas).

## Where things are

| What | Where |
| --- | --- |
| Product requirements (single source of truth) | `docs/requirements/` — one source file per requirement (`bud/BUD-16.md`, edited) and generated release views (`bud/BUD-16.poc.md`, read-only); one slice at a glance: `node tools/req-check/index.mjs --show BUD-16@PoC` |
| Product, releases, roles, plans, rules П-1…П-26, glossary | `docs/requirements/00-general.md` (grep, do not read whole) |
| Requirement process and format | `docs/requirements/prc/` (PRC-01, PRC-02), `docs/requirements/README.md`; [sources, views and changes](.claude/references/requirements-format.md) (read when you change requirement text) |
| Traceability matrix, build sequence per release, coverage, req-check report (generated, **not committed**) | `node tools/req-check/index.mjs --quiet --traceability --report docs/validation/req-check-report.md` (git-ignored output); without a checkout: artifact `traceability` of the latest «Requirements traceability» run on `main` |
| ARC, CICD, NFR; design system, components, flows | `docs/requirements/arc/`, `cicd/`, `nfr/`; `ds/`, `cmp/`, `flw/`, `jrn/`, `scr/` |
| Architecture decisions | `docs/adr/` — do not contradict an accepted ADR; propose a new one |
| Decision log | one new file per decision in `docs/decisions/log/` (`YYYY-MM-DD-<short-slug>.md`, numeric suffix if taken); `docs/decisions/state-2026-11-05.md` is the archive, never appended to |
| Screens (S-NNN, entry points), use cases, journeys | `docs/ux/` |
| Design artifacts and snapshots | `docs/design/ARTIFACTS.md`; `design/` |
| Coverage tables of design decisions | `docs/validation/` |
| External services, owner browser tasks | `docs/ops/` — [rules](.claude/references/external-services.md) (read when a PR adds a service or the owner must act in a console) |
| Everything else (full table, phase notes) | [where things are](.claude/references/where-things-are.md) (read when this table does not name it) |
| Modules and who owns what | [module map](.claude/references/module-map.md) (read when you need which module owns a capability); catalogue in `docs/requirements/arc/ARC-01.md`, ledger rules in `ARC-11.md` |

Requirement views are self-contained. A requirement changes only through a PR to its **source** that records
the owner's decision; never edit a view (run `node tools/req-check/index.mjs --views`; CI fails on a stale
view). Before changing a requirement, screen or shared rule run `--impact <target>` and update or list every
dependent slice (PRC-02; skill `change-requirement`).

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

## Modules

Each module has a card (`README.md` in the module folder): purpose, requirement IDs, public interface,
events published and consumed, owned tables. Start every task by reading the card; update it in the same
PR when the interface changes. Create new modules only with the scaffold generator.

Modules talk to each other only through their public interface and events. Never import another
module's internals or touch its database schema. Shared code without business rules (money, dates, IDs,
errors) lives only in `packages/domain-kernel`.

## Process: one requirement = one session = one branch = one PR

1. A task names one requirement ID (or a small group in one module). No ID → do not start.
2. Load only the view of the target release (`--show <ID@release>` prints it with its dependencies,
   decisions and coverage), what its «Зв'язки» header names, the `00-general.md` sections it relies on, the
   module card and that module's code. Wide searches: a read-only subagent; keep only its conclusion.
3. Follow `implement-requirement`. Tests first: one automated test per acceptance criterion and edge case.
4. Branch `<ID>-<slug>` or the working branch the lead names; the PR title starts with the ID
   (`BUD-03: safe-to-spend widget`).
5. Review in a **different** session: `review-pr`; PRs labelled `sensitive` (CI sets it from file paths: auth,
   permissions, encryption, money, schema, pipeline, infrastructure) also `security-review`. Every review
   names the full head SHA it reviewed and ends with a line of its own: `Verdict: Ready` or
   `Verdict: Changes requested`, and `Security verdict: Ready` or `Security verdict: Changes requested` (the
   daily check, ADR-0008, reads exactly these lines; owner, 2026-11-12). Review rounds (owner, 2026-11-12):
   - Only a security bypass, data loss or leak, or a violation of the claimed requirement (FR/AC or shared
     rule) blocks. Everything else goes to «Follow-ups» (the lead opens the issue) and never starts a round by itself.
   - A re-review checks only the fixes and its own previous findings. At most two rounds; after that the
     reviewer supplies a ready fix with a test and confirms it with a verdict on the final head.
   - Mutation testing only for critical modules: data isolation, money, authentication, encryption.
   - A recurring finding becomes a CI check or a test. Before pushing, run the local check for
     secret-shaped literals (CI job `secrets`) and, before pushing or setting a PR body,
     `git fetch origin main` and `node tools/pr-rules/index.mjs local --title "<title>" --body-file <file>`
     (what the jobs `traceability` and the label job check; owner, 2026-11-13). A test named by a requirement
     item that does not exist fails the job `requirements` (`--check-mentions`).
   - Keep PRs small: split a large part (backend and UI) so each PR fits one review round.
6. All CI checks green (jobs `requirements`, `changes`, `web`, `traceability`, `secrets`, `local-env`, `api`, `infra`, `e2e`;
   a job its path filter skips counts as passed — [CI minutes](.claude/references/ci-minutes.md), read when you
   change a workflow). Never skip, disable or weaken a test to get green.
7. The lead merges (squash) only when CI is green on the latest commit and both verdicts are Ready **on that
   exact head SHA**; any later commit needs a re-review (a docs-only sync that leaves the PR's diff unchanged:
   the lead's check and review, merge rules). PRs that change requirements, AGENTS.md or skills
   (label `owner-decision`) need the owner's decision recorded in the body and the decision log. Only what
   acts on the cloud or production (`tofu apply`, deploy or release, the workflows and trust settings that do
   it, production DNS) needs the owner's approval on the PR. Agents never write «Схвалюю» or «Approved», and
   write `Рішення власника (YYYY-MM-DD): схвалено …` only for a decision the owner gave. Never push to `main`.
   Full conditions, exceptions and «merge on Ready, follow up separately»:
   [merge rules](.claude/references/merge-rules.md) (read when you merge or write «Owner decision»).

The lead writes to the owner in chat only about a merge, a decision needed or a problem; no technical messages
(owner, 2026-11-14) — `pr-pipeline`, «Мовчання в чаті».

If the work does not fit one session, split it by acceptance criteria into several PRs, each green on its
own, and list in the PR body which criteria are left.

**Parallel branches** (owner, 2026-11-12): up to 3 working branches at a time — `claude/adoring-cray-feh4dh`
and `claude/adoring-cray-feh4dh-<task>` — each in its own worktree with its own PR, test database
(`pnpm db:test`; integration tests as `pnpm db:test run -- pnpm test:integration`, roles are cluster-wide) and
the same rules; a branch is deleted after its PR is merged.

**Skills** (`.claude/skills/`): `implement-requirement`, `review-pr`, `security-review`, `fix-review-findings`,
`pr-pipeline`, `browser-task`, `sync-branch`, `change-requirement`, `deploy`, `screen-from-canvas`, `plan-wave`,
`investigate-ci-failure` — what each does: [skills list](.claude/references/skills-list.md) (read when you pick a
skill or add one). Token economy: `pr-pipeline`, «Token economy».

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
  provider sandboxes — never production data, secrets or real credentials. Secrets never go to chat, issues,
  PRs or the repository.
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
