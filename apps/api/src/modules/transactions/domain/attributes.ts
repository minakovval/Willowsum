/**
 * The attributes of a transaction (BUD-13@PoC FR 1–4): «Нотатка» and «Теги». No flags (FR 3, owner 2026-11-02) and no
 * attachments in this release (FR 4, owner 2026-11-12). Pure rules, no I/O.
 */

/** FR 1: «Нотатка» — up to 2 000 characters. */
export const NOTE_MAX = 2000;
/** FR 2: a tag — up to 60 characters. */
export const TAG_NAME_MAX = 60;
/** FR 2, «Досягнуто 20 тегів»: at most 20 tags on a transaction. */
export const TAGS_PER_TRANSACTION_MAX = 20;

const BIDI = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/u;
const CONTROL = /[\p{Cc}\u2028\u2029]/u;
const VISIBLE = /[^\s\p{Cf}\p{Z}]/u;

/** «Нотатка»: NFC, trimmed, up to 2 000 code points, line feeds allowed; empty — none; undefined — invalid. */
export function noteText(text: string): string | null | undefined {
  const value = text.normalize("NFC").replace(/\r\n?/g, "\n").trim();
  if (value === "") return null;
  if ([...value].length > NOTE_MAX || BIDI.test(value) || CONTROL.test(value.replaceAll("\n", "")))
    return undefined;
  return value;
}

/**
 * A tag's name (FR 2): one line, NFC, the spaces at its ends trimmed, 1–60 code points; undefined — invalid (empty
 * too: a tag has a name).
 */
export function tagName(text: string): string | undefined {
  const value = text.normalize("NFC").trim();
  if (value === "" || [...value].length > TAG_NAME_MAX) return undefined;
  if (CONTROL.test(value) || BIDI.test(value) || !VISIBLE.test(value)) return undefined;
  return value;
}

/**
 * FR 2: tags are unique in the space without regard to case — «Ремонт» and «ремонт» are one tag. The key compares
 * names (a valid name, `tagName`); the name keeps the case it was first given.
 */
export function tagKey(name: string): string {
  return name.normalize("NFC").trim().toLowerCase();
}

/**
 * The tags of one transaction as sent (FR 2): each name checked, the same tag twice (by its key) kept once in the
 * order first given; more than 20 different tags — `too_many` («Досягнуто 20 тегів»).
 */
export function tagNames(
  names: readonly string[],
):
  | { readonly names: readonly string[] }
  | { readonly issue: { field: string; issue: "invalid" | "too_many" } } {
  const byKey = new Map<string, string>();
  for (const [i, raw] of names.entries()) {
    const name = tagName(raw);
    if (name === undefined) return { issue: { field: `tags.${i}`, issue: "invalid" } };
    if (!byKey.has(tagKey(name))) byKey.set(tagKey(name), name);
  }
  if (byKey.size > TAGS_PER_TRANSACTION_MAX) return { issue: { field: "tags", issue: "too_many" } };
  return { names: [...byKey.values()] };
}
