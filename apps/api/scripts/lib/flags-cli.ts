import {
  FULL_ROLLOUT_MAX_DAYS,
  type FlagActor,
  type FlagDefinition,
  type Rollout,
} from "../../src/modules/feature-flags/index.ts";

/** A command of scripts/flags.ts (CICD-06: staff change flags through FlagAdmin until the ADM screen exists). */
export type FlagCommand =
  | { readonly kind: "state" }
  | { readonly kind: "rollout"; readonly key: string; readonly rollout: Rollout; readonly actor: FlagActor }
  | {
      readonly kind: "kill-switch";
      readonly module: string;
      readonly disabled: boolean;
      readonly actor: FlagActor;
    }
  | {
      readonly kind: "test-space";
      readonly householdId: string;
      readonly isTest: boolean;
      readonly actor: FlagActor;
    };

export const FLAGS_USAGE = `Usage: node scripts/flags.ts <command> [--actor <staff uuid>]
  state                                   flags, kill switches, overdue release flags
  rollout <flag> off|test|share:<1-99>|all
  kill <module>       revive <module>     module kill switch on / off
  test-space <household uuid> on|off      mark or unmark a test space
Changes need --actor (the staff member's id); each change is audited.`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function parseRollout(text: string | undefined): Rollout {
  if (text === "off" || text === "test" || text === "all") return { stage: text };
  const share = /^share:(\d{1,2})$/.exec(text ?? "");
  if (share && Number(share[1]) >= 1) return { stage: "share", percent: Number(share[1]) };
  throw new Error("rollout: off | test | share:<1-99> | all");
}

/** Parses the arguments; throws with a message that names what is wrong (never echoes other values). */
export function parseFlagCommand(argv: readonly string[]): FlagCommand {
  const args = [...argv];
  const at = args.indexOf("--actor");
  let actor: FlagActor | undefined;
  if (at >= 0) {
    const id = args[at + 1] ?? "";
    if (!UUID_RE.test(id)) throw new Error("--actor must be the staff member's UUID");
    actor = { kind: "staff", id };
    args.splice(at, 2);
  }
  const [command, a, b, ...rest] = args;
  if (rest.length > 0) throw new Error("too many arguments");
  const need = (): FlagActor => {
    if (!actor) throw new Error("changes need --actor <staff uuid>");
    return actor;
  };
  switch (command) {
    case "state":
      if (a !== undefined) throw new Error("state takes no arguments");
      return { kind: "state" };
    case "rollout":
      if (!a || b === undefined) throw new Error("rollout <flag> <stage>");
      return { kind: "rollout", key: a, rollout: parseRollout(b), actor: need() };
    case "kill":
    case "revive":
      if (!a || b !== undefined) throw new Error(`${command} <module>`);
      return { kind: "kill-switch", module: a, disabled: command === "kill", actor: need() };
    case "test-space":
      if (!a || !UUID_RE.test(a) || (b !== "on" && b !== "off"))
        throw new Error("test-space <household uuid> on|off");
      return { kind: "test-space", householdId: a, isTest: b === "on", actor: need() };
    default:
      throw new Error("unknown command");
  }
}

/**
 * After `rollout <release flag> all`: the 30-day rule of CICD-06 FR 2 is checked on the code (`check:flags`
 * reads `fullyEnabledOn`), so the day must be written there. Null for other changes and operational flags.
 */
export function rolloutReminder(
  key: string,
  rollout: Rollout,
  flags: Readonly<Record<string, FlagDefinition>>,
  today: string,
): string | null {
  if (rollout.stage !== "all" || flags[key]?.kind !== "release") return null;
  return `Reminder: ${key} is now fully enabled. In the PR that records it, set fullyEnabledOn: "${today}" for ${key} in FLAGS (feature-flags/domain/catalogue.ts); remove the flag from the code within ${FULL_ROLLOUT_MAX_DAYS} days (check:flags fails after that).`;
}
