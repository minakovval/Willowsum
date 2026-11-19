/** A recipe that uses every group of rules (IMP-06@PoC FR 1). */
export const FULL_RECIPE = {
  schemaVersion: 1,
  file: {
    encoding: "windows-1251",
    delimiter: ";",
    quote: '"',
    sheet: "Виписка",
    skipRows: 2,
    headerRow: 3,
    footerRows: 1,
    footerPattern: "^Разом",
  },
  columns: [
    { column: 1, role: "date", header: "Дата" },
    { column: 2, role: "value-date" },
    { column: 3, role: "description" },
    { column: 4, role: "amount" },
    { column: 5, role: "balance" },
    { column: 6, role: "ignore" },
  ],
  dates: { format: "DD.MM.YYYY", order: "dmy", baseYear: 2000, timeZone: "Europe/Kyiv" },
  numbers: {
    decimalSeparator: ",",
    thousandsSeparator: " ",
    ambiguousIntegers: "thousands",
    currencySymbols: { "₴": "UAH", kr: "SEK" },
  },
  sign: { mode: "indicator", column: 7, outValues: ["Дебет"], inValues: ["Кредит"] },
  currency: { mode: "fixed", code: "UAH" },
  account: { by: "iban", value: "UA00 0000 0000 0000 0000 0000 000" },
  filters: {
    ignoreRows: ["^Разом", "^Всього"],
    statusColumn: 8,
    skipStatuses: ["Скасовано"],
    skipZeroAmounts: true,
  },
  extract: [{ column: 3, pattern: String.raw`Ref:\s*([A-Z0-9]{1,20})`, group: 1, target: "reference" }],
} as const;
