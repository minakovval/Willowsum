/**
 * Rules of a space (ACC-01@PoC FR 7, ACC-08@PoC FR 1, 5 and its edge case; ADR-0010).
 */

/** The roles of a space (00-general «Ролі і права»); PoC has one user per space, its Owner. */
export const SPACE_ROLES = ["owner", "admin", "editor", "viewer", "advisor"] as const;
export type SpaceRole = (typeof SPACE_ROLES)[number];

/** A space name is 1–60 characters (ACC-08 FR 5). */
export const SPACE_NAME_MAX = 60;
export const SPACE_NAME_PREFIX = "Родина ";

/**
 * The name of a user's first space: «Родина <Прізвище>» (ACC-01 FR 7). The sign-up form has one field «Ім'я»,
 * so the surname is its last word; a one-word name gives «Родина <Ім'я>» (ACC-08 edge case). Characters are
 * counted as Unicode code points and the name is cut to 60 (ACC-08 FR 5) without splitting a surrogate pair.
 */
export function firstSpaceName(displayName: string): string {
  const words = displayName.normalize("NFC").trim().split(/\s+/u).filter(Boolean);
  const surname = words.at(-1) ?? "";
  const name = `${SPACE_NAME_PREFIX}${surname}`.trim();
  return [...name].slice(0, SPACE_NAME_MAX).join("");
}

/**
 * A new name of a space (ACC-08@PoC FR 5, AC5): NFC, without leading or trailing whitespace, 1–60 characters
 * counted as code points, one line (no control characters); uniqueness is not required. Null — not saved.
 */
export function spaceName(input: string): string | null {
  const name = input.normalize("NFC").trim();
  const chars = [...name];
  if (chars.length < 1 || chars.length > SPACE_NAME_MAX) return null;
  if (chars.some((c) => /\p{Cc}/u.test(c))) return null;
  return name;
}
