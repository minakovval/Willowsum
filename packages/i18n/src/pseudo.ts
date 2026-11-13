import type { MessageKey, Messages } from "./types.ts";

/**
 * NFR-09@PoC FR 2: the left-to-right pseudo-locale. Each message becomes «[Šéţţíñĝš ~~~]»: every Latin
 * letter accented (text that skipped the catalogue stays plain and stands out), the text lengthened by at
 * least 40 % (long translations show up in the layout) and wrapped in brackets (cut-off text shows up).
 * `{placeholders}`, digits, symbols and spaces are kept as they are.
 */
const PLAIN = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ACCENTED = "áƀçďéƒĝĥíĵķĺɱñóþǫŕšţúṽŵẋýžÁƁÇĎÉƑĜĤÍĴĶĹṀÑÓÞǪŔŠŢÚṼŴẊÝŽ";
const MAP = new Map([...PLAIN].map((c, i) => [c, [...ACCENTED][i]!]));
const PLACEHOLDER = /(\{\w+\})/;
/** Share of the text added as padding. */
const GROWTH = 0.4;

export function pseudoLocalize(message: string): string {
  const parts = message.split(PLACEHOLDER);
  const body = parts
    .map((p) => (PLACEHOLDER.test(p) ? p : [...p].map((c) => MAP.get(c) ?? c).join("")))
    .join("");
  // Padding: «[» + text + « » + «~»… + «]» is at least 1.4 × the original length.
  const pad = Math.max(1, Math.ceil(message.length * GROWTH) - 3);
  return `[${body} ${"~".repeat(pad)}]`;
}

/** Keys kept as they are in every language: the product name is never translated (DS-02). */
const UNTRANSLATED: ReadonlySet<MessageKey> = new Set(["brand.name", "brand.markLabel"]);

/** The pseudo catalogue generated from a source catalogue, key for key. */
export function pseudoCatalogue(source: Messages): Messages {
  const out = {} as Record<MessageKey, string>;
  for (const key of Object.keys(source) as MessageKey[])
    out[key] = UNTRANSLATED.has(key) ? source[key] : pseudoLocalize(source[key]);
  return out;
}
