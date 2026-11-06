# Willowsum

**Створено:** 2026-11-01 · **Оновлено:** 2026-11-06

Household wealth and budget platform for families in the EU and Ukraine: assets, valuations, accounts,
budget, documents and a client-side encrypted vault. Built from scratch.

## Status

Design phase. Owner decision of 2026-11-02 «design before code»: the PoC is designed as mockups on the
canvas and the requirements are validated against it; application code (`apps/`, `packages/`) does not
change until the owner has approved every PoC design detail and explicitly starts development. The PoC
shell code already in `main` (PRs #46, #47, #52, #54, #55) is kept and frozen (owner, 2026-11-06).

- Requirements: [docs/requirements/](docs/requirements/README.md) — 435 requirements; 431 are a card plus
  release slices (PoC → PoC v2 → MVP → v1-mobile → v1 → v2). PoC scope: `00-general.md`, section 0.2.
- Rules for agents and contributors: [AGENTS.md](AGENTS.md).
- Project state and owner decisions: [docs/decisions/](docs/decisions/state-2026-11-05.md).
- Design artifacts (canvas, design system, Claude Doc, release sheet) and their repo snapshots:
  [docs/design/ARTIFACTS.md](docs/design/ARTIFACTS.md); snapshots in `design/`.
- UX: [docs/ux/](docs/ux/README.md) — screen map, use cases, journeys.
- Traceability and build sequence per release (generated): [docs/traceability/](docs/traceability/README.md).
- Agent skills: `.claude/skills/implement-requirement`, `.claude/skills/review-pr`.

## Suggested order of work

1. Now: PoC design on the canvas; each approved design step goes into the requirements in one PR.
2. After the owner starts development: build the PoC in the waves of
   [docs/traceability/release-poc.md](docs/traceability/release-poc.md) — foundation first (ARC, CICD,
   NFR), then the design system (DS, CMP) and the PoC modules («Гроші», «Планування»).
3. Then PoC v2, MVP («Сейф» is part of MVP), v1-mobile, v1, v2.

Each step is one requirement per session and one PR, as described in AGENTS.md.
