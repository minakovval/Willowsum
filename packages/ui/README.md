# @willowsum/ui — design-system foundations

**Purpose.** The design tokens, the generated CSS custom properties, and the base React pieces
every screen uses: theme, «Приховати суми», icons, the mark, and the app shell. Tokens live in
TypeScript (`src/tokens/*.ts`) and are the only place in the code where colours, sizes and layers
are written as literals. `src/styles/tokens.css` is generated from them and committed.

## Requirements covered

| ID | Status | What is here |
| --- | --- | --- |
| DS-06 | PoC complete except AC2 | All 64 colour tokens, both themes, exact values (light `ink-muted` = `#566174`), including the canvas P0 tokens `surface-inset`, `tint-*`, `on-warning`, `skeleton`, `goal-*`, `scrim` and `gain-soft`, `loss-soft`, `warning-line` (#51); WCAG pair tests; ESLint + CSS test against colour literals; colour-role checks (`src/tokens/roles.ts`: accent only fills the small leaf, never text; ink on surface-300; warning colours never mark a goal or an error; controls bordered in `border-control`) run over this package and `apps/web`; disabled button style. AC2 (contrast on every route in a browser) belongs to the NFR-07 Playwright PR
| DS-07 | Partly | Chart fill steps 1–4 (= `series-1`…`4`, canvas P0), «Інше» hatch, stacked-area 5th layer, heat-map levels, waterfall hatch as tokens; status-tone pairs contrast-tested. No badge/banner/chart components yet |
| DS-08 | PoC complete | Type scale + component sizes in rem, `.ws-text-*` classes, tabular figures for amounts, `.ws-num` amount column (end-aligned), `.ws-label` (13/16 500 capitals +8 %), links underlined in running text, `.ws-link` for a standalone link, `.ws-prose` measure; Inter / Inter Tight self-hosted (`@fontsource`, `font-display: swap`). One h1 per route is checked in `apps/web`
| DS-09 | Tokens complete | Spacing, radii (with `radius-xl` 16), `shadow-raised`, `shadow-popover`, `shadow-dialog` per theme, overlay, dialog `scrim` with a 2 px blur, z-index scale, content max 1200, rail 64, sidebar 212, card padding 16/24 |
| DS-10 | Partly | Breakpoints, width classes (columns, margins, gutters, band gap) as CSS vars per media query, nav form switch, table → card stack below 520 px container. No widget grid / page templates yet |
| DS-11 | Mostly | `ThemeProvider` + `ThemeSwitch` (Світла / Темна / Як у системі), live system changes, device storage with a private-mode fallback, print in light. The no-flash boot script is in `apps/web/index.html` |
| DS-12 | Partly | Icon set (82 names: 22 sections, 12 asset types, 9 money-and-cover, 4 PoC navigation pages and sections, actions, status) based on [Lucide](https://lucide.dev) (`lucide` 1.59.0, ISC), 1.8 px absolute round stroke at every size (canvas P0; 2 px for «+» and «✓» in buttons), outline only, `currentColor`, tones, sizes, parent → child pairs composed from the parent glyph, custom `metals` glyph, RTL flip for directional icons. No photo placeholder yet |
| DS-13 | PoC complete for what exists | Motion tokens; every transition is `duration-interaction` (150 ms); skeleton shimmer (one pass in 1.6 s, static with reduced motion); `.ws-chart` draws without animation; reduced motion makes transitions instant, stops the skeleton, slows the spinner to 2.4 s. Tooltip and toast timing come with their components
| DS-14 | Partly | 3 px focus ring with 2 px offset, skip links, 44 px targets in the shell |
| DS-18 | Partly | `HideAmountsProvider`, `Amount` (shows «•••», real value not in the DOM, hold 350 ms or Enter / Space shows it for 3 s), `Percent` (always visible), eye toggle with `aria-pressed`. Stored on this device only until the profile API exists (cross-device sync is still to do). Kept for MVP: the PoC app shell does not show the toggle |
| DS-04 / CMP-07 | Partly | `formatCompactAmount({ value, currency, locale })`: two decimals below 100, one from 100; units and layout by interface language — uk «тис., млн, млрд, трлн, квдрлн, квінтлн», «128,4 тис. €», «−1,24 млн ₴»; en «k, M, bn, tn, qd, qn», symbol first, no space, decimal point, «€128.4k», «−€128.4k»; `FitAmount` fit order; `formatCompactNumber({ value, locale, axis })` for chart labels («128,4 тис.»; axis ticks drop trailing zeros, «120 тис.»); `Delta` (DS-04@PoC: a change with an arrow in `gain` / `loss` / `ink-muted`, no sign, the accessible name with «зросло» / «знизилось» / «без змін»; the amount part is left out while amounts are hidden); `Amount` takes `spoken` (the full spoken form for screen readers). The English units are prepared for MVP: the PoC interface is Ukrainian only |
| DS-02 | Partly | `WillowsumMark` (theme-aware fills), `Wordmark`, brand SVG files in `src/brand/assets` |
| CMP-25@PoC | PoC complete | `Tooltip` (wraps one focusable element, e.g. an icon-only button), `TruncatedText` (one line with an ellipsis; focusable with a tooltip only while cut off), `useTooltip` (the behaviour for a component that shortens its own content: `FitAmount` uses it once abbreviated, replacing its `title`). Shown at once on hover and keyboard focus; Esc, pointer leave, blur and scroll close it; WCAG 2.2 1.4.13 hoverable, dismissible, persistent; `role="tooltip"` + `aria-describedby`; above the element, below it when there is no room, inside the window; fixed on `layer-tooltip`; 320 px at most, 6 × 10 px padding, `tooltip` type token, no motion. Touch screens and dark theme: MVP
| CMP-69@PoC / UX-09@PoC | Partly | `AppShell`: 212 px sidebar collapsible to a 64 px icon rail (choice stored on this device until the profile API exists; «›» handle on the edge), brand link, «+ Додати» and profile menus (`MenuButton`), L1 sections with the L2 pages of the current one (20 / 16 px icons), count badge in `brand-2`, current item, skip links. `FocusShell` for focus mode. No bottom bar or width-driven rail in PoC |

## Public exports

- `.` (`src/index.ts`): every token module (`colors`, `CONTRAST_PAIRS`, `typeScale`, `space`, `radii`,
  `shadows`, `layers`, `motion`, `breakpoints`, `widthClasses`, `layout`, `navFormOf`, `widthClassOf`,
  `contrastRatio`, `buildTokensCss`, `cssVar`, the colour-role and motion checks `cssDeclarations`, `accentUsageViolations`, `accentTextViolations`, `surface300TextViolations`, `warningMeaningViolations`, `controlBorderViolations`, `transitionDurationViolations`, …), `Icon`, `IconSvg`, `ICON_GROUPS`, `ICON_NAMES`,
  `ICON_PARENT_CHILD`, `WillowsumMark`, `Wordmark`, `ThemeProvider`, `useTheme`, `ThemeSwitch`,
  `THEME_STORAGE_KEY`, `HideAmountsProvider`, `useHideAmounts`, `Amount`, `Percent`,
  `HideAmountsToggle`, `HideAmountsSwitch`, `HIDDEN_AMOUNT`, `Delta`, `AppShell`, `FocusShell`, `MenuButton`,
  `NAV_COLLAPSED_STORAGE_KEY`, `MAIN_ID`, `NAV_ID`, `useMediaQuery`, `FitAmount`, `Tooltip`, `TruncatedText`, `useTooltip`, `placeTooltip`, `formatCompactAmount`, `formatCompactNumber`.
- `./tokens`: tokens only (no React).
- `./styles.css`: generated tokens + base + component + shell styles.
- `./fonts.css`: the self-hosted Inter / Inter Tight faces.
- `./test-utils`: `installMatchMedia`, `setViewport` (a jsdom `matchMedia` for width and theme tests).

## Rules

- Change a token only in `src/tokens/*.ts`, then run `pnpm --filter @willowsum/ui build` to
  regenerate `src/styles/tokens.css`. A test fails if the committed file is stale, and the token
  snapshot shows the change in review.
- CSS custom properties use the `--ws-` prefix (`var(--ws-surface-100)`).
- Theme: `data-theme="light" | "dark"` on the root element, or no attribute for the system theme.
  The same attribute on any element scopes a theme to that subtree.
- User-facing text comes from `@willowsum/i18n`; components here hold no strings of their own.

Events, tables: none (presentation only).
