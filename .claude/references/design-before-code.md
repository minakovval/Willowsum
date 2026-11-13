# Process: design before code

**Створено:** 2026-11-13 · **Оновлено:** 2026-11-13

Moved out of AGENTS.md without change (owner, 2026-11-13: shorter AGENTS.md and skills). Read when you work on design, the canvas or a release whose design is not approved yet.

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
