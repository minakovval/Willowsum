/**
 * CMP-07 order when an amount does not fit its own line (moving the whole amount to a new line is
 * done by layout: amounts are a single unbreakable run):
 *   1. the full value at 100 %, then 80 % of its size;
 *   2. the abbreviated value at 80 %;
 *   3. the abbreviated value shrinking further, down to 55 %.
 * `fits(text, scale)` is the measurement (in the browser: the rendered width against the box).
 */
export interface FitChoice {
  text: string;
  scale: number;
  abbreviated: boolean;
}

export const FIT_FULL_MIN = 0.8;
export const FIT_MIN = 0.55;

export function chooseFit(
  full: string,
  compact: string | null,
  fits: (text: string, scale: number) => boolean,
): FitChoice {
  if (fits(full, 1)) return { text: full, scale: 1, abbreviated: false };
  if (fits(full, FIT_FULL_MIN)) return { text: full, scale: FIT_FULL_MIN, abbreviated: false };
  if (compact) {
    for (let s = FIT_FULL_MIN; s >= FIT_MIN - 1e-9; s -= 0.05) {
      const scale = Math.round(s * 100) / 100;
      if (fits(compact, scale)) return { text: compact, scale, abbreviated: true };
    }
    return { text: compact, scale: FIT_MIN, abbreviated: true };
  }
  for (let s = FIT_FULL_MIN - 0.05; s >= FIT_MIN - 1e-9; s -= 0.05) {
    const scale = Math.round(s * 100) / 100;
    if (fits(full, scale)) return { text: full, scale, abbreviated: false };
  }
  return { text: full, scale: FIT_MIN, abbreviated: false };
}
