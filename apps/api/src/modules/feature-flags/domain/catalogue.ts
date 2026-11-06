import { z } from "zod";

/**
 * The flag catalogue (CICD-06 FR 1–2, ARC-01 FR 7): every function has a key in the feature catalogue
 * (plan-catalog) and a flag here, under the same key, that can switch it off in production without a
 * release. Each flag names its owner and a review date.
 *
 * - `release` — a temporary flag of a new function. It ships «off»; the owner rolls it out (test spaces →
 *   a share of spaces → all). It is removed from the code no later than 30 days after full rollout: the day
 *   the rollout reached «all» is written into `fullyEnabledOn` in the PR that records it, and `check:flags`
 *   (CI) fails after 30 days.
 * - `operational` — a permanent switch of a core function (the owner may switch it off in an incident). It
 *   is never removed, but it still has an owner and a review date.
 *
 * `check:flags` fails for a flag past its review date too (the owner re-decides and moves the date).
 */
export const FLAG_KINDS = ["release", "operational"] as const;
export type FlagKind = (typeof FLAG_KINDS)[number];

/** Days a release flag may stay fully enabled before it must be removed from the code (CICD-06 FR 2). */
export const FULL_ROLLOUT_MAX_DAYS = 30;

const isoDate = z.iso.date();

export const flagDefinition = z
  .object({
    kind: z.enum(FLAG_KINDS),
    /** Who decides about the flag: a role or team name, never a person's name or email. */
    owner: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/),
    /** The owner reviews the flag by this day (YYYY-MM-DD, UTC). */
    reviewBy: isoDate,
    /** Release flags: the day the rollout reached «all» (YYYY-MM-DD, UTC); set in the PR that records it. */
    fullyEnabledOn: isoDate.optional(),
    description: z.string().min(1).max(300),
  })
  .strict()
  .refine((f) => f.kind === "release" || f.fullyEnabledOn === undefined, {
    message: "only release flags record fullyEnabledOn",
  });

export type FlagDefinition = z.infer<typeof flagDefinition>;

export const FLAGS = {
  "household.core": {
    kind: "operational",
    owner: "product-owner",
    reviewBy: "2027-02-04",
    description:
      "Робота з власним простором через API; вимикає всі маршрути простору з ключем household.core",
  },
} as const satisfies Record<string, FlagDefinition>;

export type FlagKey = keyof typeof FLAGS;
export const FLAG_KEYS = Object.keys(FLAGS) as FlagKey[];

export function isFlagKey(key: string): key is FlagKey {
  return Object.hasOwn(FLAGS, key);
}
