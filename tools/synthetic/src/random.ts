/**
 * Deterministic pseudo-random numbers for synthetic data (ARC-03 FR 6): the same seed gives the same data
 * on every machine. sfc32 seeded by the cyrb128 string hash — a test-data generator, not cryptography:
 * nothing secret is derived from it.
 */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: string) {
    [this.a, this.b, this.c, this.d] = cyrb128(seed);
    for (let i = 0; i < 12; i++) this.next();
  }

  /** Next unsigned 32-bit integer. */
  next(): number {
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Integer in [min, max], both inclusive (max − min < 2^32). */
  int(min: number, max: number): number {
    return min + (this.next() % (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)]!;
  }

  /** A version-4-shaped UUID built from this generator (deterministic, not random). */
  uuid(): string {
    const bytes = Array.from({ length: 16 }, () => this.next() & 0xff);
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  /**
   * A decimal amount as a string, built digit by digit (never a float, NFR-06): up to `integerDigits`
   * digits before the point and exactly `scale` after; negative with probability `negativeShare` percent.
   */
  amount(integerDigits: number, scale: number, negativeShare = 0): string {
    const digits = this.int(1, integerDigits);
    let whole = String(this.int(1, 9));
    for (let i = 1; i < digits; i++) whole += String(this.int(0, 9));
    let fraction = "";
    for (let i = 0; i < scale; i++) fraction += String(this.int(0, 9));
    const sign = negativeShare > 0 && this.int(1, 100) <= negativeShare ? "-" : "";
    return `${sign}${whole}${scale > 0 ? `.${fraction}` : ""}`;
  }

  /** A UTC instant between `from` and `from + days`, as ISO 8601. */
  instant(from: string, days: number): string {
    const start = Date.parse(from);
    return new Date(start + this.int(0, days * 86_400 - 1) * 1000).toISOString();
  }
}

function cyrb128(text: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}
