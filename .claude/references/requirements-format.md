# Requirement sources, views and changes

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-13

Moved out of AGENTS.md without change (owner, 2026-11-13: shorter AGENTS.md and skills). Read when you read, change or move requirement text, or need the exact source and view rules.

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
dependent slice in the same PR or list it as follow-up in the PR body; the lead opens the issue (PRC-02). Edit only
sources: `--move` moves items between releases (and warns about cited item numbers that shift and about
the moved items still mentioned elsewhere); rewording is a plain edit of the source. Then regenerate, in the
same PR and in this order:

- the views: `node tools/req-check/index.mjs --views` (0 errors; commit the regenerated views);
- `node tools/req-check/index.mjs --check-mentions` (no test names an item its view does not have) and
  `node --test tools/req-check`. The traceability files and the req-check report are not committed (owner,
  2026-11-13): CI generates them on every PR and fails if that fails. The skill `change-requirement` has the
  full procedure.
