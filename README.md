# Willowsum

Household wealth and budget platform for families in the EU and Ukraine: assets, valuations, accounts,
budget, documents and a client-side encrypted vault. Built from scratch.

## Status

Requirements complete; implementation not started.

- Requirements: [docs/requirements/](docs/requirements/README.md) — 397 requirements, one file each.
- Rules for agents and contributors: [AGENTS.md](AGENTS.md).
- Agent skills: `.claude/skills/implement-requirement`, `.claude/skills/review-pr`.

## Suggested order of work

1. Foundation: ARC-01 (modular monolith skeleton), ARC-03 (data and household isolation), ARC-07 (API
   and clients), CICD-01…03 (branches, PR checks, build), NFR basics.
2. Design system: DS-*, then the CMP-* components used by the first screens.
3. MVP modules in dependency order: ACC → SUB/ADM → AST/VAL → FIN → BUD → IMP/DAT/DOC/NOT/RPT/SUP → UX/GRID/L10N/LEG.
4. Release «Сейф»: VLT-*. Then v1-mobile, v1, v2.

Each step is one requirement per session and one PR, as described in AGENTS.md.
