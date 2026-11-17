/**
 * Windows-1251 encoding for synthetic Ukrainian bank CSVs (IMP-06 FR 2: the engine must detect it without a
 * BOM). Node can decode it (TextDecoder) but not encode it, so this maps ASCII, the Cyrillic letters and the
 * few punctuation marks the generator writes; any other character throws instead of being silently replaced.
 */
const EXTRA: Readonly<Record<string, number>> = {
  Ё: 0xa8,
  ё: 0xb8,
  Є: 0xaa,
  є: 0xba,
  І: 0xb2,
  і: 0xb3,
  Ї: 0xaf,
  ї: 0xbf,
  Ґ: 0xa5,
  ґ: 0xb4,
  "№": 0xb9,
  "«": 0xab,
  "»": 0xbb,
  "—": 0x97,
  " ": 0xa0,
};

export function encodeCp1251(value: string): Buffer {
  const bytes: number[] = [];
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) bytes.push(code);
    else if (code >= 0x0410 && code <= 0x044f) bytes.push(code - 0x0410 + 0xc0);
    else if (EXTRA[ch] !== undefined) bytes.push(EXTRA[ch]);
    else throw new Error(`Character «${ch}» (U+${code.toString(16).toUpperCase()}) has no Windows-1251 code here`);
  }
  return Buffer.from(bytes);
}
