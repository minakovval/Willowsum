import { z } from "zod";

/**
 * Rollout of a flag (CICD-06 FR 1). A function ships «off»; the owner turns it on step by step:
 * - `off` — nobody (the default: a flag without a stored state is off);
 * - `test` — only the spaces marked as test spaces;
 * - `share` — test spaces plus `percent` % of all spaces, chosen by a deterministic bucket of each space;
 * - `all` — every space.
 * A function that is off is hidden: its routes answer as if they did not exist (DAT-05 FR 7).
 */
export const ROLLOUT_STAGES = ["off", "test", "share", "all"] as const;
export type RolloutStage = (typeof ROLLOUT_STAGES)[number];

export const rollout = z.discriminatedUnion("stage", [
  z.object({ stage: z.literal("off") }).strict(),
  z.object({ stage: z.literal("test") }).strict(),
  z.object({ stage: z.literal("share"), percent: z.number().int().min(1).max(99) }).strict(),
  z.object({ stage: z.literal("all") }).strict(),
]);
export type Rollout = z.infer<typeof rollout>;

export const OFF: Rollout = Object.freeze({ stage: "off" });

/** Buckets per flag: a space is in the share when its bucket is below `percent`. */
export const BUCKETS = 100;

/**
 * The bucket (0–99) of a space for one flag: FNV-1a (32 bit) of «<flag>:<householdId>». Deterministic, so a
 * space keeps its answer on every server and request; raising the share only adds spaces. The flag key is
 * part of the input, so each flag picks a different set of spaces. Not a security function: it only spreads
 * spaces evenly.
 */
export function bucketOf(flag: string, householdId: string): number {
  let hash = 0x811c9dc5;
  const input = `${flag}:${householdId.toLowerCase()}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % BUCKETS;
}

/** Is the flag on for this space? `isTestHousehold` is asked only when the stage needs it. */
export async function isOnFor(
  flag: string,
  state: Rollout,
  householdId: string,
  isTestHousehold: () => Promise<boolean>,
): Promise<boolean> {
  switch (state.stage) {
    case "off":
      return false;
    case "all":
      return true;
    case "share":
      if (bucketOf(flag, householdId) < state.percent) return true;
      return isTestHousehold();
    case "test":
      return isTestHousehold();
  }
}
