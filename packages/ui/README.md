# @willowsum/ui — design-system foundations

**Purpose.** The design tokens, the generated CSS custom properties, and the base React pieces
every screen uses: theme, «Приховати суми», icons, the mark, and the app shell. Tokens live in
TypeScript (`src/tokens/*.ts`) and are the only place in the code where colours, sizes and layers
are written as literals. `src/styles/tokens.css` is generated from them and committed.

## Requirements covered

| ID | Status | What is here |
| --- | --- | --- |
| DS-06 | Tokens complete | All 21 colour tokens, both themes, exact values (light `ink-muted` = `#566174`); WCAG pair tests; ESLint + CSS test against colour literals |
| DS-07 | Partly | Chart fill steps 1–4, «Інше» hatch, stacked-area 5th layer, heat-map levels, waterfall hatch as tokens; status-tone pairs contrast-tested. No badge/banner/chart components yet |
| DS-08 | Tokens complete | Type scale + component sizes in rem, `.ws-text-*` classes, tabular figures for amounts, uppercase label; Inter / Inter Tight self-hosted (`@fontsource`, `font-display: swap`) |
| DS-09 | Tokens complete | Spacing, radii, `shadow-raised` per theme, overlay, z-index scale, content max 1200, rail 64, sidebar 212, card padding 16/24 |
| DS-10 | Partly | Breakpoints, width classes (columns, margins, gutters, band gap) as CSS vars per media query, nav form switch, table → card stack below 520 px container. No widget grid / page templates yet |
| DS-11 | Mostly | `ThemeProvider` + `ThemeSwitch` (Світла / Темна / Як у системі), live system changes, device storage with a private-mode fallback, print in light. The no-flash boot script is in `apps/web/index.html` |
| DS-12 | Partly | Icon set (82 names: 22 sections, 12 asset types, 9 money-and-cover, 4 PoC navigation pages and sections, actions, status) based on [Lucide](https://lucide.dev) (`lucide` 1.59.0, ISC), 1.5 px absolute round stroke at every size, outline only, `currentColor`, tones, sizes, parent → child pairs composed from the parent glyph, custom `metals` glyph, RTL flip for directional icons. No photo placeholder yet |
| DS-13 | Partly | Motion tokens; reduced motion makes transitions instant, stops the skeleton, slows the spinner to 2.4 s |
| DS-14 | Partly | 3 px focus ring with 2 px offset, skip links, 44 px targets in the shell |
| DS-18 | Partly | `HideAmountsProvider`, `Amount` (shows «•••», real value not in the DOM, hold 350 ms or Enter / Space shows it for 3 s), `Percent` (always visible), eye toggle with `aria-pressed`. Stored on this device only until the profile API exists (cross-device sync is still to do) |
| DS-02 | Partly | `WillowsumMark` (theme-aware fills), `Wordmark`, brand SVG files in `src/brand/assets` |
| CMP-69@PoC / UX-09@PoC | Partly | `AppShell`: 212 px sidebar collapsible to a 64 px icon rail (choice stored on this device until the profile API exists; «›» handle on the edge), brand link, «+ Додати» and profile menus (`MenuButton`), L1 sections with the L2 pages of the current one (20 / 16 px icons), count badge in `brand-2`, current item, skip links. `FocusShell` for focus mode. No bottom bar or width-driven rail in PoC |

## Public exports

- `.` (`src/index.ts`): every token module (`colors`, `CONTRAST_PAIRS`, `typeScale`, `space`, `radii`,
  `shadows`, `layers`, `motion`, `breakpoints`, `widthClasses`, `layout`, `navFormOf`, `widthClassOf`,
  `contrastRatio`, `buildTokensCss`, `cssVar`, …), `Icon`, `IconSvg`, `ICON_GROUPS`, `ICON_NAMES`,
  `ICON_PARENT_CHILD`, `WillowsumMark`, `Wordmark`, `ThemeProvider`, `useTheme`, `ThemeSwitch`,
  `THEME_STORAGE_KEY`, `HideAmountsProvider`, `useHideAmounts`, `Amount`, `Percent`,
  `HideAmountsToggle`, `HideAmountsSwitch`, `HIDDEN_AMOUNT`, `AppShell`, `FocusShell`, `MenuButton`,
  `NAV_COLLAPSED_STORAGE_KEY`, `MAIN_ID`, `NAV_ID`, `useMediaQuery`.
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
