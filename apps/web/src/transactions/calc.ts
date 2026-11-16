import { Decimal } from "@willowsum/domain-kernel";

/**
 * BUD-13@PoC FR 7: the calculator of a part's amount field — numbers with the locale's decimal comma or a point,
 * + − × ÷ (also - * /) and brackets, a leading minus. Exact decimals (NFR-06): never a float. Null for an
 * expression that is not complete or divides by zero.
 */
type Token = { kind: "num"; value: Decimal } | { kind: "op"; value: "+" | "-" | "*" | "/" | "(" | ")" };

const OPS: Readonly<Record<string, "+" | "-" | "*" | "/" | "(" | ")">> = {
  "+": "+",
  "-": "-",
  "−": "-",
  "*": "*",
  "×": "*",
  "/": "/",
  "÷": "/",
  ":": "/",
  "(": "(",
  ")": ")",
};

function tokens(text: string, decimalComma: boolean): Token[] | null {
  const out: Token[] = [];
  const src = text.replace(/[\s\u00a0\u202f]/g, "");
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    const op = OPS[ch];
    if (op) {
      out.push({ kind: "op", value: op });
      i++;
      continue;
    }
    const m = /^\d+(?:[.,]\d+)*/.exec(src.slice(i));
    if (!m) return null;
    let raw = m[0];
    // «1,234.50» in English: the comma groups; in Ukrainian «132,40» the comma is the decimal separator.
    raw = decimalComma ? raw.replace(/,/g, ".") : raw.replace(/,/g, "");
    if ((raw.match(/\./g) ?? []).length > 1) return null;
    out.push({ kind: "num", value: new Decimal(raw) });
    i += m[0].length;
  }
  return out;
}

/** The value of `text`, or null. */
export function evaluate(text: string, decimalComma = true): Decimal | null {
  const found = tokens(text, decimalComma);
  if (!found || found.length === 0) return null;
  const list: readonly Token[] = found;
  let at = 0;
  const peek = () => list[at];
  const isOp = (v: string) => {
    const t = peek();
    return t?.kind === "op" && t.value === v;
  };

  function primary(): Decimal | null {
    const t = peek();
    if (!t) return null;
    if (t.kind === "num") {
      at++;
      return t.value;
    }
    if (t.value === "-" || t.value === "+") {
      at++;
      const v = primary();
      return v === null ? null : t.value === "-" ? v.neg() : v;
    }
    if (t.value === "(") {
      at++;
      const v = sum();
      if (v === null || !isOp(")")) return null;
      at++;
      return v;
    }
    return null;
  }

  function product(): Decimal | null {
    let v = primary();
    while (v !== null && (isOp("*") || isOp("/"))) {
      const op = (list[at++] as { value: string }).value;
      const r = primary();
      if (r === null) return null;
      if (op === "/" && r.isZero()) return null;
      v = op === "*" ? v.mul(r) : v.div(r);
    }
    return v;
  }

  function sum(): Decimal | null {
    let v = product();
    while (v !== null && (isOp("+") || isOp("-"))) {
      const op = (list[at++] as { value: string }).value;
      const r = product();
      if (r === null) return null;
      v = op === "+" ? v.plus(r) : v.minus(r);
    }
    return v;
  }

  const result = sum();
  return result !== null && at === list.length ? result : null;
}
