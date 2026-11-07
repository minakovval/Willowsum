import type { Rng } from "@willowsum/synthetic";

/**
 * Synthetic personal and financial values for the redaction tests (ARC-09 FR 2, NFR-10 FR 1): every kind the
 * requirements name — emails, amounts (with and without currency), IBANs, card and account numbers, tokens
 * (bearer, JWT, API keys), account names, addresses, coordinates, request bodies, query strings and URLs
 * with parameters. All values are made up (tools/synthetic Rng); none belongs to a real person.
 */
export type PiiKind =
  | "email"
  | "amount"
  | "amountWithCurrency"
  | "iban"
  | "card"
  | "accountNumber"
  | "bearer"
  | "jwt"
  | "apiKey"
  | "accountName"
  | "address"
  | "coordinates"
  | "body"
  | "query"
  | "url";

export const PII_KINDS: readonly PiiKind[] = [
  "email",
  "amount",
  "amountWithCurrency",
  "iban",
  "card",
  "accountNumber",
  "bearer",
  "jwt",
  "apiKey",
  "accountName",
  "address",
  "coordinates",
  "body",
  "query",
  "url",
];

const FIRST = ["olha", "taras", "iryna", "maksym", "sofiia", "andrii", "oksana", "dmytro"];
const LAST = ["kovalenko", "shevchenko", "bondarenko", "melnyk", "tkachenko", "kravchenko"];
const ACCOUNT_NAMES = [
  "Картка Золота",
  "Депозит у Банку А",
  "Family Savings",
  "Рахунок ФОП Мельник",
  "Kids Pocket Money",
  "Iryna's travel card",
];
const STREETS = ["вул. Хрещатик", "Main Street", "просп. Перемоги", "Rynok Square", "вул. Січових Стрільців"];
const CITIES = ["Київ", "Lviv", "Одеса", "Kharkiv", "Wrocław"];
const CURRENCIES = ["UAH", "EUR", "USD", "₴", "€", "$"];
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function digits(rng: Rng, n: number): string {
  let out = String(rng.int(1, 9));
  for (let i = 1; i < n; i++) out += String(rng.int(0, 9));
  return out;
}

function b64(rng: Rng, n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) out += B64[rng.int(0, B64.length - 1)];
  // Opaque keys mix letters and digits.
  return `${out}${rng.int(0, 9)}`;
}

export function piiValue(rng: Rng, kind: PiiKind): string {
  switch (kind) {
    case "email":
      return `${rng.pick(FIRST)}.${rng.pick(LAST)}${rng.int(1, 99)}@example.com`;
    case "amount":
      return rng.amount(7, 2, 20);
    case "amountWithCurrency": {
      const amount = rng.amount(6, 2);
      const currency = rng.pick(CURRENCIES);
      return rng.int(0, 1) === 0 ? `${amount} ${currency}` : `${currency}${amount.replace(".", ",")}`;
    }
    case "iban":
      return `UA${digits(rng, 2)}${digits(rng, 6)}${digits(rng, 19)}`;
    case "card": {
      const n = digits(rng, 16);
      return rng.int(0, 1) === 0 ? n : n.replace(/(\d{4})(?=\d)/g, "$1 ");
    }
    case "accountNumber":
      return digits(rng, rng.int(8, 14));
    case "bearer":
      return `Bearer ${b64(rng, 32)}`;
    case "jwt":
      return `eyJhbGciOiJIUzI1NiJ9.${b64(rng, 24)}.${b64(rng, 32)}`;
    case "apiKey":
      return `sk_test_${b64(rng, 28)}`;
    case "accountName":
      return rng.pick(ACCOUNT_NAMES);
    case "address":
      return `${rng.pick(STREETS)}, ${rng.int(1, 120)}, кв. ${rng.int(1, 300)}, ${rng.pick(CITIES)}`;
    case "coordinates":
      return `${rng.int(44, 52)}.${digits(rng, 5)}, ${rng.int(22, 40)}.${digits(rng, 5)}`;
    case "body":
      return JSON.stringify({ name: rng.pick(ACCOUNT_NAMES), amount: rng.amount(5, 2), currency: "UAH" });
    case "query":
      return `?email=${rng.pick(FIRST)}%40example.com&amount=${rng.amount(4, 2)}`;
    case "url":
      return `https://bank.example/accounts/${digits(rng, 10)}?token=${b64(rng, 24)}`;
  }
}

/**
 * The fragments that would identify a value if they leaked: the value itself and its distinctive parts
 * (an email's local part, an amount's digits, an address's street …).
 */
export function piiFragments(value: string): string[] {
  const parts = value
    .split(/[\s,;:?&=/"{}]+/)
    // Distinctive parts only: with a digit, a capital or a non-ASCII letter (not words like «accounts»).
    .filter((p) => p.length >= 4 && /[0-9A-Z]|[^ -~]/.test(p) && p !== "Bearer" && p !== "UAH");
  return [value, ...parts];
}
