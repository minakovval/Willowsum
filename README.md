# Willowsum

**Створено:** 2026-11-01 · **Оновлено:** 2026-11-13

Household wealth and budget platform for families in the EU and Ukraine: assets, valuations, accounts,
budget, documents and a client-side encrypted vault. Built from scratch.

## Status

PoC development. The owner approved the PoC design and started development on 2026-11-06 (decision of
2026-11-02 «design before code»: each release is designed on the canvas and approved before its code is
written). The PoC shell code already in `main` (PRs #46, #47, #52, #54, #55) is the starting point.

- Requirements: [docs/requirements/](docs/requirements/README.md) — 435 requirements; 431 are a card plus
  release slices (PoC → PoC v2 → MVP → v1-mobile → v1 → v2). PoC scope: `00-general.md`, section 0.2.
- Rules for agents and contributors: [AGENTS.md](AGENTS.md).
- Project state and owner decisions: [docs/decisions/](docs/decisions/) — one file per decision in
  [log/](docs/decisions/log/); [state-2026-11-05.md](docs/decisions/state-2026-11-05.md) is the archive.
- Design artifacts (canvas, design system, Claude Doc, release sheet) and their repo snapshots:
  [docs/design/ARTIFACTS.md](docs/design/ARTIFACTS.md); snapshots in `design/`.
- UX: [docs/ux/](docs/ux/README.md) — screen map, use cases, journeys.
- Traceability and build sequence per release (generated, not committed): run
  `node tools/req-check/index.mjs --quiet --traceability` (writes the git-ignored `docs/traceability/`), or open the
  latest run of the workflow «Requirements traceability» on `main` (artifact `traceability`).
- Agent skills: `.claude/skills/implement-requirement`, `.claude/skills/review-pr`.

## Suggested order of work

1. Done: PoC design on the canvas, approved by the owner on 2026-11-06.
2. Now: build the PoC in the waves of the generated `docs/traceability/release-poc.md` (see above). The PoC sections are «Гроші» and
   «Планування».
3. Then PoC v2 (design first, then code), MVP («Сейф» is part of MVP), v1-mobile, v1, v2.

Each step is one requirement per session and one PR, as described in AGENTS.md.
