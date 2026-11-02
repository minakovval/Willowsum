/** Spacing and radii — DS-09 items 1–4. */

export const space = {
  "space-1": 4,
  "space-2": 8,
  "space-3": 12,
  "space-4": 16,
  "space-5": 24,
  "space-6": 32,
  "space-7": 48,
  "space-8": 64,
} as const;

export type SpaceToken = keyof typeof space;

export const radii = {
  "radius-none": 0,
  "radius-sm": 4,
  "radius-md": 8,
  "radius-lg": 14,
  "radius-pill": 999,
} as const;

export type RadiusToken = keyof typeof radii;
