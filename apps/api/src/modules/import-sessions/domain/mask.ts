/** IMP-05 business rule: an IBAN or a card or account number in a bank's text shows only its last 4 characters. */
export function maskNumbers(text: string | null): string | null {
  if (text === null) return null;
  const last4 = (run: string) => `…${run.replace(/[\s.-]/g, "").slice(-4)}`;
  // Groups are printed with a space of any kind (a no-break one too), a hyphen or (an IBAN) a dot, one or two of them; a number
  // glued to a label («IBANUA…», «N4111…», «PAY_UA…») is a number all the same; full-width forms count as their ASCII.
  return text
    .replace(
      /[A-Zａ-ｚＡ-Ｚ]{2}[\d０-９]{2}(?:[\s.-]{0,2}[A-Z0-9ａ-ｚＡ-Ｚ０-９]){11,30}(?![A-Z0-9])/gi,
      last4,
    )
    .replace(/(?<![\d０-９])[\d０-９](?:[\s-]{0,2}[\d０-９*Xx•]){11,22}(?![\d０-９])/g, last4);
}
