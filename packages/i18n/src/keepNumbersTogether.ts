/**
 * DS-08 item 11, CMP-07: a number never breaks across lines together with its sign, currency, unit or
 * percent sign. Replaces ordinary spaces inside a number (digit groups) and between a number and the
 * word or symbol attached to it with a no-break space (U+00A0). Text elsewhere keeps normal wrapping.
 */
const NBSP = " ";
const CURRENCY = "€₴$£¥₽";
const groupSpace = /(\d)[ \u202F](?=\d{3}(?!\d))/g; // "12 345" becomes "12<nbsp>345"
const numberThenUnit = new RegExp(`(\\d)[ ](?=[%${CURRENCY}]|[\\p{L}]{1,12}(?![\\p{L}]))`, "gu"); // "30 днів", "15 %", "12 €"
const currencyThenNumber = new RegExp(`([${CURRENCY}]|(?<![\\p{L}])[A-Z]{3})[ ](?=[−\\-+]?\\d)`, "gu"); // "€ 12", "UAH 5"

export function keepNumbersTogether(text: string): string {
  let out = text;
  // Repeat for runs like "1 234 567".
  for (let i = 0; i < 4; i++) out = out.replace(groupSpace, `$1${NBSP}`);
  out = out.replace(numberThenUnit, `$1${NBSP}`);
  out = out.replace(currencyThenNumber, `$1${NBSP}`);
  return out;
}
