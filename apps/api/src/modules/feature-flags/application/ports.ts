import type { AuditLog } from "../../audit/index.ts";
import type { Rollout } from "../domain/index.ts";

/** Everything the flag check needs that is the same for every space: read in one query, cached by the runtime. */
export interface FlagSnapshot {
  /** Stored rollout of each flag that has one; a flag without a stored state is off. */
  readonly rollouts: ReadonlyMap<string, Rollout>;
  /** Modules switched off by their kill switch. */
  readonly killed: ReadonlySet<string>;
  /** When each flag at «all» reached it. */
  readonly fullyEnabledAt: ReadonlyMap<string, Date>;
}

/** Port: the module's own storage (schema `feature_flags`). */
export interface FlagStore {
  snapshot(): Promise<FlagSnapshot>;
  /** Is this space a test space now? Read in a transaction bound to that space. */
  isTestHousehold(householdId: string): Promise<boolean>;
  /** Stores the rollout; returns the flag's row id and the state before (off when it had none). */
  setRollout(key: string, rollout: Rollout): Promise<{ id: string; before: Rollout }>;
  setKillSwitch(module: string, disabled: boolean): Promise<{ id: string; before: boolean }>;
  /** Marks or unmarks a test space (keeps history); returns whether it was one before. */
  setTestHousehold(householdId: string, isTest: boolean): Promise<{ before: boolean }>;
}

/** What the module writes to the audit log (П-10). */
export type FlagAudit = Pick<AuditLog, "record" | "recordPlatform">;

/** Who changes a flag: staff (an opaque id) or the system. A household's user never does. */
export type FlagActor = { readonly kind: "staff"; readonly id: string } | { readonly kind: "system" };
