/**
 * The file's encoding (IMP-06@PoC FR 1, FR 8, AC12): by its BOM if it has one; otherwise every supported encoding reads
 * a sample and the most plausible reading wins — the share of letters of the expected alphabets, no broken characters
 * (replacement marks, control codes, stray symbols), no case flips or mixed scripts inside a word, and words of the
 * header that a statement uses. Every other reading is an alternative with its score and a live sample. Pure and
 * deterministic (FR 9): the platform's decoders only; ties go to the order of `ENCODINGS`.
 */
export const ENCODINGS = [
  "utf-8",
  "utf-16le",
  "utf-16be",
  "windows-1251",
  "windows-1252",
  "cp866",
  "koi8-u",
] as const;
export type Encoding = (typeof ENCODINGS)[number];

export interface EncodingGuess {
  readonly encoding: Encoding;
  /** 0–1, two decimals. */
  readonly score: number;
  /** «bom» — the byte-order mark decided; «content» — the reading of a sample. */
  readonly reason: "bom" | "content";
  /** The first line of the sample in this reading (≤ 80 characters): the live example of the alternative. */
  readonly sample: string;
}

export interface EncodingResult {
  readonly chosen: EncodingGuess;
  /** The other readings, best first (none when a BOM decided). */
  readonly alternatives: readonly EncodingGuess[];
}

/** The platform decoder's label of each encoding. */
const LABEL: Readonly<Record<Encoding, string>> = {
  "utf-8": "utf-8",
  "utf-16le": "utf-16le",
  "utf-16be": "utf-16be",
  "windows-1251": "windows-1251",
  "windows-1252": "windows-1252",
  cp866: "ibm866",
  "koi8-u": "koi8-u",
};

/** Bytes of the sample that every reading scores. */
const SAMPLE_BYTES = 64 * 1024;
/** Characters of a reading scored. */
const SCORED_CHARS = 8000;

function bomOf(bytes: Uint8Array): Encoding | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  return null;
}

/** The text of the bytes in an encoding; a BOM is dropped. Undecodable bytes become U+FFFD (never an exception). */
export function decodeText(bytes: Uint8Array, encoding: Encoding): string {
  return new TextDecoder(LABEL[encoding]).decode(bytes);
}

const CYRILLIC = /[а-яёіїєґ]/;
const COMMON_CYRILLIC = new Set(Array.from("оаніитерсвлкдмуп"));
const LATIN_EXTENDED = /[À-ɏ]/;
const ALLOWED_SYMBOLS = new Set(Array.from("«»–—‘’‚“”„№€₴£¥·…°§©®±× "));
const HEADER_WORDS = [
  "дата",
  "сума",
  "опис",
  "валют",
  "залишок",
  "баланс",
  "рахун",
  "признач",
  "контрагент",
  "операц",
  "комісі",
  "кредит",
  "дебет",
  "статус",
  "date",
  "amount",
  "descr",
  "currenc",
  "balance",
  "account",
  "refer",
  "payee",
  "debit",
  "credit",
  "datum",
  "betrag",
  "buchung",
  "währung",
  "saldo",
  "kwota",
];

const firstLine = (text: string): string =>
  (text.split(/\r\n|\n|\r/).find((l) => l.trim().length > 0) ?? "").slice(0, 80);

function isJunk(c: string, code: number): boolean {
  if (c === "\t" || c === "\n" || c === "\r") return false;
  if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || c === "�") return true;
  if (code >= 0xe000 && code <= 0xf8ff) return true;
  return code > 0x7f && !/\p{L}|\p{N}/u.test(c) && !ALLOWED_SYMBOLS.has(c);
}

/** How plausible a reading is (higher is better; unclamped). */
function plausibility(text: string): number {
  let ascii = 0;
  let extended = 0;
  let cyrillic = 0;
  let other = 0;
  let junk = 0;
  let breaks = 0;
  let mixed = 0;
  let common = 0;
  let prev = "";
  let wordScripts = 0; // bit 1: Latin, bit 2: Cyrillic
  const endWord = () => {
    if (wordScripts === 3) mixed++;
    wordScripts = 0;
  };
  for (const c of Array.from(text.slice(0, SCORED_CHARS))) {
    const code = c.codePointAt(0)!;
    const lower = c.toLowerCase();
    if (/\p{L}/u.test(c)) {
      if (/[a-z]/.test(lower)) {
        ascii++;
        wordScripts |= 1;
      } else if (CYRILLIC.test(lower)) {
        cyrillic++;
        wordScripts |= 2;
        if (COMMON_CYRILLIC.has(lower)) common++;
      } else if (LATIN_EXTENDED.test(c)) {
        extended++;
        wordScripts |= 1;
      } else other++;
      if (prev && /\p{Ll}/u.test(prev) && /\p{Lu}/u.test(c)) breaks++;
      prev = c;
      continue;
    }
    endWord();
    prev = "";
    if (isJunk(c, code)) junk++;
  }
  endWord();
  const letters = ascii + extended + cyrillic + other;
  // Accented Latin letters are expected only as a minority of the Latin ones (German, Polish …).
  const expected = ascii + cyrillic + Math.min(extended, Math.floor((ascii + extended) / 4));
  const foreign = letters - expected;
  const base = (expected - foreign - 3 * junk - 2 * breaks - 2 * mixed) / Math.max(1, letters + junk);
  const tokens = firstLine(text)
    .toLowerCase()
    .split(/[^\p{L}]+/u);
  const hits = HEADER_WORDS.filter((w) => tokens.some((t) => t.startsWith(w))).length;
  // The frequent Cyrillic letters, weighed by the Cyrillic share of the letters.
  const frequent = (0.2 * common) / Math.max(1, letters);
  return base + 0.05 * Math.min(hits, 4) + frequent;
}

/** The best reading's plausibility: 1 plus both bonuses. */
const MAX_PLAUSIBILITY = 1.4;
const round2 = (x: number): number => Math.round(Math.min(1, Math.max(0, x / MAX_PLAUSIBILITY)) * 100) / 100;

function sampleOf(bytes: Uint8Array): Uint8Array {
  const length = Math.min(bytes.length, SAMPLE_BYTES);
  return bytes.subarray(0, length - (length % 2));
}

/** The live example of a reading (FR 8): the first line of the sample in that encoding, e.g. one a recipe sets. */
export function encodingSample(bytes: Uint8Array, encoding: Encoding): string {
  return firstLine(decodeText(sampleOf(bytes), encoding));
}

/** The file's encoding with the alternatives (FR 8). */
export function detectEncoding(bytes: Uint8Array): EncodingResult {
  const bom = bomOf(bytes);
  if (bom) {
    const sample = decodeText(bytes.subarray(0, SAMPLE_BYTES), bom);
    return {
      chosen: { encoding: bom, score: 1, reason: "bom", sample: firstLine(sample) },
      alternatives: [],
    };
  }
  const sample = sampleOf(bytes);
  const readings: { encoding: Encoding; raw: number; sample: string }[] = [];
  for (const encoding of ENCODINGS) {
    let text: string;
    if (encoding === "utf-8") {
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(sample, { stream: true });
      } catch {
        continue; // not UTF-8 at all
      }
    } else text = decodeText(sample, encoding);
    readings.push({ encoding, raw: plausibility(text), sample: firstLine(text) });
  }
  // Stable: equal scores keep the order of ENCODINGS.
  readings.sort((a, b) => round2(b.raw) - round2(a.raw) || b.raw - a.raw);
  const [best, ...rest] = readings.map((r): EncodingGuess => ({
    encoding: r.encoding,
    score: round2(r.raw),
    reason: "content",
    sample: r.sample,
  }));
  return { chosen: best!, alternatives: rest };
}
