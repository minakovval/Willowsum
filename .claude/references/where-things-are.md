# Where things are (full table and phase notes)

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-13

Moved out of AGENTS.md without change (owner, 2026-11-13: shorter AGENTS.md and skills). Read when the short table in AGENTS.md does not name what you look for.

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
