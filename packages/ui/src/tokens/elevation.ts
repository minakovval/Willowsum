/** Shadows and layers — DS-09 items 5–7. */

/** Level 1 (raised card). Level 0 is a 1 px `line` border; level 2 is the `overlay` scrim. */
export const shadows = {
  "shadow-raised": {
    light: "0 1px 2px rgba(11, 37, 69, 0.10), 0 4px 12px rgba(11, 37, 69, 0.06)",
    dark: "0 1px 2px rgba(0, 0, 0, 0.40)",
  },
} as const;

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
