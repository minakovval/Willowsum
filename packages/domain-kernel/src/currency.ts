import { DomainError } from "./errors.ts";

/**
 * Units an amount can be held in (NFR-06 FR 1, FR 3): ISO 4217 currencies with their minor units,
 * precious metals (XAU, XAG, XPT, XPD; ISO 4217 «N.A.» minor unit) and crypto-assets (up to 18 decimals).
 * The table is reference data, not business rules: adding a currency is a data change.
 */
export type CurrencyKind = "fiat" | "metal" | "crypto";

export interface CurrencyInfo {
  readonly code: string;
  readonly kind: CurrencyKind;
  /** Decimal places used when the amount is shown (and when a function explicitly asks to round). */
  readonly minorUnits: number;
}

/** ISO 4217 currencies whose minor unit is not 2. Every other listed code has 2. */
const MINOR_UNITS: Readonly<Record<string, number>> = {
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  UYI: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
  CLF: 4,
  UYW: 4,
};

/**
 * ISO 4217 alphabetic codes that are active, plus codes withdrawn in 2025 or later that are kept so that
 * historical amounts stay readable (ANG → XCG, BGN → EUR). Fund codes (BOV, CHE, CHW, CLF, COU, MXV, USN,
 * UYI, UYW) are included; special drawing units with no minor unit (XDR, XSU, XUA), testing (XTS) and
 * «no currency» (XXX) codes are not. Codes withdrawn earlier (HRK, SLL, ZWL, CUC, …) are not accepted.
 */
const ISO_4217 =
  `AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BOV BRL BSD BTN BWP BYN
BZD CAD CDF CHE CHF CHW CLF CLP CNY COP COU CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS
GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK
LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MXV MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB
PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS
TMT TND TOP TRY TTD TWD TZS UAH UGX USD USN UYI UYU UYW UZS VED VES VND VUV WST XAF XCD XCG XOF XPF YER ZAR ZMW
ZWG`
    .split(/\s+/)
    .filter(Boolean);

/** Precious metals: troy ounces, shown with 4 decimals (lead decision, NFR-06). */
const METALS = ["XAU", "XAG", "XPT", "XPD"];
const METAL_MINOR_UNITS = 4;

/** Crypto-assets known so far, with the decimals of their smallest unit (≤ 18). Extended with the crypto module. */
const CRYPTO: Readonly<Record<string, number>> = { BTC: 8, ETH: 18, USDT: 6, USDC: 6, SOL: 9 };

const REGISTRY: ReadonlyMap<string, CurrencyInfo> = new Map<string, CurrencyInfo>([
  ...ISO_4217.map((code): [string, CurrencyInfo] => [
    code,
    { code, kind: "fiat", minorUnits: MINOR_UNITS[code] ?? 2 },
  ]),
  ...METALS.map((code): [string, CurrencyInfo] => [
    code,
    { code, kind: "metal", minorUnits: METAL_MINOR_UNITS },
  ]),
  ...Object.entries(CRYPTO).map(([code, minorUnits]): [string, CurrencyInfo] => [
    code,
    { code, kind: "crypto", minorUnits },
  ]),
]);

export type CurrencyCode = string & { readonly __brand: "CurrencyCode" };

export function currencyInfo(code: string): CurrencyInfo {
  const info = REGISTRY.get(code);
  if (!info) throw new DomainError("INVALID_CURRENCY", "Unknown currency code");
  return info;
}

export function isCurrencyCode(code: string): boolean {
  return REGISTRY.has(code);
}

export function currencyCode(code: string): CurrencyCode {
  return currencyInfo(code).code as CurrencyCode;
}

export function knownCurrencies(): readonly CurrencyInfo[] {
  return [...REGISTRY.values()];
}
