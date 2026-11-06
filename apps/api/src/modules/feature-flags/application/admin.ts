import { z } from "zod";
import { isFlagKey, overdueFullRollouts, rollout, FLAGS, type Rollout } from "../domain/index.ts";
import type { FlagActor, FlagAudit, FlagSnapshot, FlagStore } from "./ports.ts";

/** Audit entity types of this module. */
export const AUDIT_ENTITY = {
  flag: "feature-flags.flag",
  killSwitch: "feature-flags.kill-switch",
  testHousehold: "feature-flags.test-household",
} as const;

const actor = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("staff"), id: z.uuid() }).strict(),
  z.object({ kind: z.literal("system") }).strict(),
]);
const uuid = z.uuid();

const percentOf = (r: Rollout): string =>
  r.stage === "share" ? String(r.percent) : r.stage === "all" ? "100" : "0";

/**
 * The internal interface that changes flags, kill switches and test spaces (CICD-06). It is the only way to
 * change them: the owner's admin screen (ADM) will call it later; until then staff call it from
 * `scripts/flags.ts`. Every change writes an audit entry (П-10): flags and kill switches to the platform log,
 * a test-space mark to that space's own log. A change that changes nothing writes nothing. The change and its
 * entry are separate transactions, as everywhere until events exist (ARC-04).
 */
export interface FlagAdmin {
  setRollout(by: FlagActor, key: string, next: Rollout): Promise<{ before: Rollout; after: Rollout }>;
  setKillSwitch(
    by: FlagActor,
    module: string,
    disabled: boolean,
  ): Promise<{ before: boolean; after: boolean }>;
  setTestHousehold(
    by: FlagActor,
    householdId: string,
    isTest: boolean,
  ): Promise<{ before: boolean; after: boolean }>;
  /** The stored state (for the admin screen and scripts/flags.ts). */
  state(): Promise<FlagSnapshot>;
  /** Release flags at «all» for more than 30 days (CICD-06 FR 2), from the stored state. */
  overdue(now: Date): Promise<string[]>;
}

export function createFlagAdmin(deps: {
  readonly store: FlagStore;
  readonly audit: FlagAudit;
  /** Modules that may be switched off (module-rules.json). */
  readonly modules: readonly string[];
}): FlagAdmin {
  const { store, audit } = deps;
  return {
    setRollout: async (by, key, next) => {
      const who = actor.parse(by);
      if (!isFlagKey(key)) throw new Error(`Unknown flag ${key} (feature-flags)`);
      const after = rollout.parse(next);
      const current = (await store.snapshot()).rollouts.get(key) ?? { stage: "off" as const };
      if (current.stage === after.stage && percentOf(current) === percentOf(after)) {
        return { before: current, after };
      }
      const { id, before } = await store.setRollout(key, after);
      await audit.recordPlatform({
        actor: who,
        channel: "system",
        entity: { type: AUDIT_ENTITY.flag, id },
        action: "update",
        changes: [
          { field: "stage", before: before.stage, after: after.stage, sensitive: false },
          { field: "percent", before: percentOf(before), after: percentOf(after), sensitive: false },
        ],
      });
      return { before, after };
    },
    setKillSwitch: async (by, module, disabled) => {
      const who = actor.parse(by);
      if (!deps.modules.includes(module)) throw new Error(`Unknown module ${module}`);
      if (typeof disabled !== "boolean") throw new Error("disabled must be true or false");
      if ((await store.snapshot()).killed.has(module) === disabled)
        return { before: disabled, after: disabled };
      const { id, before } = await store.setKillSwitch(module, disabled);
      await audit.recordPlatform({
        actor: who,
        channel: "system",
        entity: { type: AUDIT_ENTITY.killSwitch, id },
        action: "update",
        changes: [{ field: "disabled", before: String(before), after: String(disabled), sensitive: false }],
      });
      return { before, after: disabled };
    },
    setTestHousehold: async (by, householdId, isTest) => {
      const who = actor.parse(by);
      uuid.parse(householdId);
      if (typeof isTest !== "boolean") throw new Error("isTest must be true or false");
      const { before } = await store.setTestHousehold(householdId, isTest);
      if (before !== isTest) {
        await audit.record(householdId, {
          actor: who,
          channel: "system",
          entity: { type: AUDIT_ENTITY.testHousehold, id: householdId },
          action: "update",
          changes: [
            { field: "testHousehold", before: String(before), after: String(isTest), sensitive: false },
          ],
        });
      }
      return { before, after: isTest };
    },
    state: () => store.snapshot(),
    overdue: async (now) => overdueFullRollouts(FLAGS, (await store.snapshot()).fullyEnabledAt, now),
  };
}
