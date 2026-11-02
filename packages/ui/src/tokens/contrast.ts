/** WCAG 2.2 relative luminance and contrast ratio for `#RRGGBB` colours. */

const channel = (hex: string, i: number): number => {
  const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

export function relativeLuminance(hex: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`Expected #RRGGBB, got ${hex}`);
  return 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Rounded down to two decimals, so a displayed «4.50» never hides 4.499. */
export const formatRatio = (ratio: number): string => (Math.floor(ratio * 100) / 100).toFixed(2);
