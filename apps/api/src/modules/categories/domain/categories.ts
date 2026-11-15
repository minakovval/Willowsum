import type { CategoryKind } from "./catalogue.ts";

/**
 * Rules of the category tree (BUD-01@PoC FR 2, FR 3, FR 8, FR 10, FR 11), pure: names, colours and the icon on
 * its circle, which category may be hidden or merged into which.
 */

/** Name of a category or group: one line, up to 60 characters (lead decision: the longest system name has 21). */
export const NAME_MAX = 60;
/** The dark icon on a light circle (DS-06 `ink`, light theme). */
export const INK = "#1B2230";
export const WHITE = "#FFFFFF";
/** FR 10: the icon is white when white on the colour has a contrast of at least 3 : 1, else `ink`. */
export const ICON_CONTRAST_MIN = 3;

/** «active» — in the tree; «hidden» — FR 3, out of the budget plan; «retired» — a custom category merged away. */
export const CATEGORY_STATES = ["active", "hidden", "retired"] as const;
export type CategoryState = (typeof CATEGORY_STATES)[number];

const BIDI = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/u;
const CONTROL = /[\p{Cc}\u2028\u2029]/u;
const VISIBLE = /[^\s\p{Cf}\p{Z}]/u;
const COLOR_RE = /^#[0-9A-F]{6}$/;
/** A Lucide icon name: lower-case words joined by hyphens. */
const ICON_RE = /^[a-z0-9]+(?:-[a-z0-9]+){0,5}$/;

/** A name as stored: NFC, trimmed, inner whitespace one space; undefined — empty, too long or not one line. */
export function categoryName(text: string): string | undefined {
  if (CONTROL.test(text.replaceAll(/[\t ]/g, "")) || BIDI.test(text)) return undefined;
  const value = text.normalize("NFC").trim().replaceAll(/\s+/gu, " ");
  if (value === "" || [...value].length > NAME_MAX || !VISIBLE.test(value)) return undefined;
  return value;
}

/** «Назва категорії унікальна в просторі» (FR 2): names compare without case (the database key is `lower(name)`). */
export function sameName(a: string, b: string): boolean {
  return a.toLocaleLowerCase("uk") === b.toLocaleLowerCase("uk");
}

/** A colour as stored: #RRGGBB in upper case; undefined when not one. */
export function categoryColor(text: string): string | undefined {
  const value = text.toUpperCase();
  return COLOR_RE.test(value) ? value : undefined;
}

export function categoryIcon(text: string): string | undefined {
  return text.length <= 64 && ICON_RE.test(text) ? text : undefined;
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG 2.2 contrast ratio of two #RRGGBB colours (a display rule, not money). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** FR 10: the colour of the icon on the category's circle. */
export function iconTone(color: string): "white" | "ink" {
  return contrastRatio(WHITE, color) >= ICON_CONTRAST_MIN ? "white" : "ink";
}

export interface MergeSide {
  readonly id: string;
  readonly kind: CategoryKind;
  readonly state: CategoryState;
}

export type MergeProblem = "same" | "service" | "kinds_differ" | "target_hidden";

/**
 * FR 8: only categories of one type merge («дохід» with «дохід», «витрата» with «витрата»), else «Категорії різних
 * типів не можна об'єднати». «Переказ» and «Коригування» are neither (FR 1) and never merge (lead decision, as they
 * are never hidden, FR 3). The target is a category in use: a hidden one is shown first (lead decision).
 */
export function mergeProblem(source: MergeSide, target: MergeSide): MergeProblem | null {
  if (source.id === target.id) return "same";
  if (source.kind === "service" || target.kind === "service") return "service";
  if (source.kind !== target.kind) return "kinds_differ";
  if (target.state !== "active") return "target_hidden";
  return null;
}

/**
 * FR 3: a merged system category is never deleted — it stays hidden and may be shown again (edge case 5); a custom
 * one is taken out of use.
 */
export function stateAfterMerge(system: boolean): CategoryState {
  return system ? "hidden" : "retired";
}

/** FR 11: «обов'язкова» belongs to expense categories only; income and service categories have none (null). */
export function hasEssential(kind: CategoryKind): boolean {
  return kind === "expense";
}

export type DeleteProblem = "system" | "not_empty";

/**
 * FR 12: only a custom category is deleted, and only while it is empty — no transaction or split part has it, no
 * category rule, recurring payment (lead decision, #260: like rules and limits, so nothing is lost), budget limit or
 * «План» cell of any month refers to it, and no category was merged into it (its records went there, FR 8).
 * System categories are never deleted (FR 3): hidden only.
 */
export function deleteProblem(
  category: { readonly systemKey: string | null },
  used: boolean,
): DeleteProblem | null {
  if (category.systemKey !== null) return "system";
  return used ? "not_empty" : null;
}
