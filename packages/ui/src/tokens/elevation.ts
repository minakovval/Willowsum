/** Shadows and layers — DS-09 items 5–7. */

/**
 * Level 0 is a 1 px `line` border; level 1 the raised card; menus and popovers use
 * `shadow-popover`; a dialog uses `shadow-dialog` over the `scrim` (canvas P0, 2026-11-05).
 */
export const shadows = {
  "shadow-raised": {
    light: "0 1px 2px rgba(11, 37, 69, 0.10), 0 4px 12px rgba(11, 37, 69, 0.06)",
    dark: "0 1px 2px rgba(0, 0, 0, 0.40)",
  },
  "shadow-popover": {
    light: "0 8px 24px rgba(11, 37, 69, 0.16)",
    dark: "0 8px 24px rgba(0, 0, 0, 0.45)",
  },
  "shadow-dialog": {
    light: "0 2px 4px rgba(11, 37, 69, 0.06), 0 24px 48px rgba(11, 37, 69, 0.20)",
    dark: "0 24px 48px rgba(0, 0, 0, 0.55)",
  },
} as const;

/** DS-09: backdrop blur behind a modal dialog, in px. */
export const SCRIM_BLUR = 2;

export type ShadowToken = keyof typeof shadows;

/**
 * z-index scale. Modal dialogs use the browser top layer (`<dialog>.showModal()`), so they need no
 * value. Local layers 1–4 are only used inside a component (map, charts).
 */
export const layers = {
  "layer-content": 0,
  "layer-local-1": 1,
  "layer-local-2": 2,
  "layer-local-3": 3,
  "layer-local-4": 4,
  "layer-sticky": 10,
  "layer-tooltip": 30,
  "layer-nav": 40,
  "layer-drawer-scrim": 45,
  "layer-drawer": 50,
  "layer-toast": 60,
  "layer-top": 1000,
} as const;

export type LayerToken = keyof typeof layers;
