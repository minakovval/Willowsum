/**
 * The merchant of a bank description (BUD-14@PoC FR 1, FR 2; wave 2 row 22). Pure and deterministic: the same
 * description always gives the same merchant, and no external service (AI or a merchant directory) is asked.
 *
 * Cleaning drops what is not the counterparty's name: a payment terminal's prefix («SUMUP *», «SQ *», «POS»), a card
 * mask («**1234», «4441XXXXXX1234»), a store or reference number and what follows it (city, country), and a legal form
 * («ТОВ», «ФОП», «LLC», «GmbH»). A payment intermediary («PAYPAL *SPOTIFY…») is not the merchant: the real recipient
 * is, and the intermediary is the transaction's «канал»; without a visible recipient the intermediary is the merchant,
 * marked «посередник».
 */

/** What a description says of its merchant. */
export interface NormalizedMerchant {
  /** The name shown until the user renames the merchant (FR 3). */
  readonly name: string;
  /** The space's match key: descriptions with one key are one merchant (FR 3 «нові транзакції … потрапляють»). */
  readonly key: string;
  /** FR 1: the payment intermediary the payment went through («канал»), or null. */
  readonly channel: string | null;
  /** FR 1: no recipient is visible — the intermediary itself is the merchant («посередник»). */
  readonly intermediary: boolean;
}

/** The longest merchant name kept (a rename too); a description longer than this is cut on a word. */
export const MERCHANT_NAME_MAX = 100;

/** Payment intermediaries and money-transfer services (FR 1), as a description spells them → the channel's name. */
const INTERMEDIARIES: readonly (readonly [RegExp, string])[] = [
  [/^PAYPAL\b/i, "PayPal"],
  [/^PP\b(?=\s*\*)/i, "PayPal"],
  [/^LIQPAY\b/i, "LiqPay"],
  [/^WAYFORPAY\b/i, "WayForPay"],
  [/^WFP\b(?=\s*\*)/i, "WayForPay"],
  [/^FONDY\b/i, "Fondy"],
  [/^PORTMONE\b/i, "Portmone"],
  [/^IPAY\b/i, "iPay"],
  [/^WISE\b(?=\s*[*:/]|\s*$)/i, "Wise"],
  [/^WESTERN\s+UNION\b/i, "Western Union"],
  [/^MONEYGRAM\b/i, "MoneyGram"],
];

/** A terminal's or acquirer's prefix that only stands before a «*» (SumUp, Square, Zettle, Shopify, Toast…). */
const STAR_PREFIX = /^(?:SUMUP|SUM UP|SQ|SQU|ZETTLE|IZ|IZETTLE|SP|TST|PY|CKO|DRI|GOOGLE|APPLE)\s*\*\s*/i;
/** A word prefix of a card payment («POS», «Покупка», «Оплата карткою»…), followed by a space or «:». */
const WORD_PREFIX =
  /^(?:POS|PURCHASE|CARD\s+PURCHASE|CARD\s+PAYMENT|PAYMENT|APPLE\s+PAY|GOOGLE\s+PAY|ПОКУПКА|ОПЛАТА(?:\s+КАРТКОЮ)?|ОПЛАТА\s+ТОВАРІВ(?:\s+І\s+ПОСЛУГ)?|ПЛАТІЖ)\s*[:-]?\s+/iu;
/**
 * Card masks: «**1234», «XXXX1234», «4441 11** **** 1234», «444111******1234». Runs of mask characters are separated by
 * exactly one space or dash, so a run splits one way only: a crafted description («1234****…a») cannot make the match
 * backtrack exponentially (the pattern `(?:[*Xx•]{2,}[\s-]?)+` did — security review of #305).
 */
const CARD_MASK =
  /(?<![\p{L}\p{N}])(?:\d{4,6}[\s-]?)?[*Xx•]{2,}(?:[\s-][*Xx•]{2,})*[\s-]?\d{2,4}(?![\p{L}\p{N}])/gu;
/** Legal forms dropped at either end of the name (case-insensitive, whole words). */
const LEGAL_FORMS = new Set([
  "тов",
  "тзов",
  "пп",
  "фоп",
  "прат",
  "пат",
  "ат",
  "кп",
  "дп",
  "ооо",
  "ип",
  "llc",
  "ltd",
  "limited",
  "gmbh",
  "inc",
  "corp",
  "plc",
  "sl",
  "s.l.",
  "sa",
  "s.a.",
  "srl",
  "s.r.l.",
  "spa",
  "s.p.a.",
  "bv",
  "b.v.",
  "nv",
  "oy",
  "ab",
  "ag",
  "sas",
  "sarl",
]);

const QUOTES = /["«»„“”`]|(?<!\p{L})['‘’]|['‘’](?!\p{L})/gu;
const EDGE_PUNCTUATION = /^[\s*#.,:;/\\|_-]+|[\s*#.,:;/\\|_-]+$/gu;

function collapse(text: string): string {
  return text.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

/** A store, terminal or reference number (three digits or more in a word) ends the name: city and country follow. */
function beforeNumber(text: string): string {
  const words = text.split(" ");
  const at = words.findIndex((w) => /\d{3,}/u.test(w));
  return at === -1 ? text : words.slice(0, at).join(" ");
}

function withoutLegalForms(text: string): string {
  const words = text.split(" ").filter((w) => w.length > 0);
  const legal = (w: string) => LEGAL_FORMS.has(w.toLocaleLowerCase("uk").replace(/,$/u, ""));
  while (words.length > 1 && legal(words[0]!)) words.shift();
  while (words.length > 1 && legal(words[words.length - 1]!)) words.pop();
  return words.join(" ");
}

/** An all-capitals bank name reads as a name: «STARBUCKS COFFEE» → «Starbucks Coffee»; short words («ATB», «BP») stay. */
function readable(text: string): string {
  if (/\p{Ll}/u.test(text)) return text;
  return text
    .split(" ")
    .map((w) =>
      w
        .split("-")
        .map((part) => {
          if (part.replace(/[^\p{L}]/gu, "").length <= 3) return part;
          return part.charAt(0) + part.slice(1).toLocaleLowerCase("uk");
        })
        .join("-"),
    )
    .join(" ");
}

function clean(text: string): string {
  let out = text.replace(CARD_MASK, " ");
  out = collapse(out.replace(QUOTES, " "));
  for (let pass = 0; pass < 3; pass++) {
    const next = out.replace(STAR_PREFIX, "").replace(WORD_PREFIX, "");
    if (next === out) break;
    out = next;
  }
  out = beforeNumber(out);
  out = withoutLegalForms(out.replace(EDGE_PUNCTUATION, ""));
  return out.replace(EDGE_PUNCTUATION, "");
}

function cut(name: string): string {
  if (name.length <= MERCHANT_NAME_MAX) return name;
  const head = name.slice(0, MERCHANT_NAME_MAX);
  const space = head.lastIndexOf(" ");
  return space > 0 ? head.slice(0, space) : head;
}

/** The match key of a name: letters and digits only, lower case, single spaces. */
export function merchantKey(name: string): string {
  return collapse(
    name
      .normalize("NFKC")
      .toLocaleLowerCase("uk")
      .replace(/[^\p{L}\p{N}]+/gu, " "),
  );
}

/**
 * FR 1: the merchant of a bank description, or null when it has none (empty, or nothing but numbers and masks is
 * left and no intermediary is named).
 */
export function normalizeDescription(description: string | null | undefined): NormalizedMerchant | null {
  if (description === null || description === undefined) return null;
  let text = collapse(description);
  if (text.length === 0) return null;
  // A terminal prefix may stand before the intermediary too («SQ *PAYPAL…» is not seen; «POS PAYPAL *…» is).
  text = text.replace(WORD_PREFIX, "");
  for (const [pattern, channel] of INTERMEDIARIES) {
    const match = pattern.exec(text);
    if (!match) continue;
    const recipient = cut(readable(clean(text.slice(match[0].length).replace(/^\s*[*:/]+\s*/u, ""))));
    if (merchantKey(recipient).length > 0 && /\p{L}/u.test(recipient)) {
      return { name: recipient, key: merchantKey(recipient), channel, intermediary: false };
    }
    return { name: channel, key: merchantKey(channel), channel, intermediary: true };
  }
  let name = cut(readable(clean(text)));
  if (!/\p{L}/u.test(name)) {
    // Nothing but numbers once cleaned: the description without its masks is the name, as the bank wrote it.
    name = cut(readable(collapse(text.replace(CARD_MASK, " ")).replace(EDGE_PUNCTUATION, "")));
  }
  const key = merchantKey(name);
  if (key.length === 0) return null;
  return { name, key, channel: null, intermediary: false };
}

/**
 * FR 2, AC13: the initials on the grey disc that stands for every merchant in this release (no logos): the first
 * letter of the first two words that start with a letter or digit, upper case — «ТОВ Ромашка» → «ТР», «Starbucks» →
 * «S».
 */
export function merchantInitials(name: string): string {
  const words = collapse(name)
    .split(" ")
    .map((w) => w.replace(/^[^\p{L}\p{N}]+/u, ""))
    .filter((w) => w.length > 0);
  return words
    .slice(0, 2)
    .map((w) => String.fromCodePoint(w.codePointAt(0)!).toLocaleUpperCase("uk"))
    .join("");
}

/** FR 3 «Перейменувати мерчанта»: the user's name — one line, 1–100 characters once trimmed; null if not valid. */
export function merchantName(input: string): string | null {
  if ([...input].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)) return null;
  const name = collapse(input);
  if (name.length === 0 || name.length > MERCHANT_NAME_MAX || merchantKey(name).length === 0) return null;
  return name;
}
