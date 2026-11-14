import { z } from "zod";

/**
 * The profile's format and time zone (ACC-05@PoC FR 3): taken from the browser at sign-up — `navigator.language` and
 * `Intl.DateTimeFormat().resolvedOptions().timeZone`. The interface has one language; the locale decides only how
 * dates, numbers and amounts look.
 */
export const LOCALE_MAX_LENGTH = 35;
export const TIME_ZONE_MAX_LENGTH = 64;

/** The canonical form of a BCP 47 language tag (`uk-ua` → `uk-UA`), or null when it is not one. */
export function canonicalLocale(tag: string): string | null {
  if (tag.length === 0 || tag.length > LOCALE_MAX_LENGTH || !/^[A-Za-z0-9-]+$/.test(tag)) return null;
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? null;
  } catch {
    return null;
  }
}

/** An IANA time zone the runtime knows (`Europe/Kyiv`). Kept as sent: canonicalising could rename a zone. */
export function isTimeZone(zone: string): boolean {
  if (zone.length === 0 || zone.length > TIME_ZONE_MAX_LENGTH || !/^[A-Za-z0-9_+\-/]+$/.test(zone))
    return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export const localeSchema = z
  .string()
  .max(LOCALE_MAX_LENGTH)
  .refine((tag) => canonicalLocale(tag) !== null, { error: "invalid_locale" })
  .transform((tag) => canonicalLocale(tag)!);

export const timeZoneSchema = z
  .string()
  .max(TIME_ZONE_MAX_LENGTH)
  .refine(isTimeZone, { error: "invalid_time_zone" });
