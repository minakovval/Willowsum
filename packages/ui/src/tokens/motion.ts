/**
 * Motion — DS-13 (and DS-18 item 7 for revealing a hidden amount). All durations in ms.
 * Hover and focus may take 120–200 ms; the product uses 150 ms everywhere so the switch thumb,
 * field border and link colour (all exactly 150 ms) and hover feel the same.
 */
export const motion = {
  "duration-hover-min": 120,
  "duration-hover-max": 200,
  "duration-interaction": 150,
  "duration-spinner": 800,
  "duration-spinner-reduced": 2400,
  "duration-skeleton": 1600,
  /** CMP-22@PoC «Повільне завантаження»: after 3 s a «Ще завантажується…» line appears under the skeleton. */
  "duration-skeleton-slow": 3000,
  /** CMP-20: a success or info toast closes itself after 8 s… */
  "duration-toast": 8000,
  /** …and after 10 s when it has the «Відмінити» (undo) action. */
  "duration-toast-undo": 10000,
  "duration-reveal-hold": 350,
  "duration-reveal-visible": 3000,
  /** With reduced motion: «не більше 0,01 мс». */
  "duration-reduced": 0.01,
} as const;

export const easings = {
  "easing-out": "ease-out",
  "easing-in-out": "ease-in-out",
  "easing-linear": "linear",
} as const;

export type MotionToken = keyof typeof motion;
