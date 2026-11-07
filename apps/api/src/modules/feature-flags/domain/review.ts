import { FULL_ROLLOUT_MAX_DAYS, flagDefinition, type FlagDefinition } from "./catalogue.ts";

const DAY_MS = 86_400_000;

/** How deep `requires` may chain: the same bound as the runtime's flagOn. */
export const MAX_REQUIRES_DEPTH = 8;

function days(from: string, to: string): number {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Today in UTC as YYYY-MM-DD. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * What `check:flags` reports (CICD-06 FR 2): a flag without a valid owner or review date, a flag past its
 * review date, and a release flag fully enabled for more than 30 days (it must be removed from the code).
 * `knownFeatures` (the plan-catalog keys) must match the flags exactly: every function has a key in the
 * feature catalogue and a flag (ARC-01 FR 7), and no flag exists without its function.
 */
export function flagReviewProblems(
  flags: Readonly<Record<string, unknown>>,
  today: string,
  knownFeatures: readonly string[],
): string[] {
  const problems: string[] = [];
  for (const [key, raw] of Object.entries(flags)) {
    const parsed = flagDefinition.safeParse(raw);
    if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".") || "flag"))];
      problems.push(`${key}: invalid definition (${fields.join(", ")}): needs kind, owner, reviewBy`);
      continue;
    }
    const flag: FlagDefinition = parsed.data;
    if (days(flag.reviewBy, today) > 0)
      problems.push(`${key}: review date ${flag.reviewBy} has passed; the owner ${flag.owner} reviews it`);
    if (flag.fullyEnabledOn !== undefined) {
      const enabledFor = days(flag.fullyEnabledOn, today);
      if (enabledFor > FULL_ROLLOUT_MAX_DAYS)
        problems.push(
          `${key}: fully enabled since ${flag.fullyEnabledOn} (${enabledFor} days); remove the flag from the code (≤ ${FULL_ROLLOUT_MAX_DAYS} days)`,
        );
    }
    if (flag.requires !== undefined) {
      // The chain of «requires» must end at a flag that requires nothing, without coming back.
      const seen = new Set([key]);
      let next: string | undefined = flag.requires;
      // Bounded like flagOn: a broken cycle check fails a test instead of hanging check:flags.
      for (let depth = 0; next !== undefined; depth++) {
        if (depth >= MAX_REQUIRES_DEPTH) {
          problems.push(`${key}: requires chains deeper than ${MAX_REQUIRES_DEPTH} flags`);
          break;
        }
        if (seen.has(next) || !Object.hasOwn(flags, next)) {
          problems.push(
            `${key}: requires ${flag.requires}, which is ${seen.has(next) ? "a cycle" : "not a flag"}`,
          );
          break;
        }
        seen.add(next);
        const parent = flagDefinition.safeParse(flags[next]);
        next = parent.success ? parent.data.requires : undefined;
      }
    }
    if (!knownFeatures.includes(key))
      problems.push(`${key}: no such key in the feature catalogue (plan-catalog FEATURES)`);
  }
  for (const feature of knownFeatures) {
    if (!Object.hasOwn(flags, feature))
      problems.push(`${feature}: a function without a flag (ARC-01 FR 7); add it to FLAGS`);
  }
  return problems;
}

/**
 * The same 30-day rule on the stored state (for the scheduled reminder once the scheduler exists, ARC-04):
 * release flags whose rollout reached «all» more than 30 days ago.
 */
export function overdueFullRollouts(
  flags: Readonly<Record<string, FlagDefinition>>,
  fullyEnabledAt: ReadonlyMap<string, Date>,
  now: Date,
): string[] {
  const today = utcDay(now);
  return [...fullyEnabledAt]
    .filter(([key, at]) => flags[key]?.kind === "release" && days(utcDay(at), today) > FULL_ROLLOUT_MAX_DAYS)
    .map(([key]) => key)
    .sort();
}
