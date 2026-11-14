import { deviceLabel, type DeviceName } from "./device.ts";
import type { SessionEndReason } from "./rules.ts";

/**
 * The sign-in journal (ACC-04@PoC business rules; NFR-15@PoC FR 29; owner decisions 2026-11-14): every sign-in,
 * failed sign-in, sign-in lock and session end of an account, with the IP address and the device (browser and
 * system), goes to the audit log of the account's space and is deleted with it. A failed sign-in for an address
 * without an account or a space, or of an unconfirmed account, goes nowhere. One entity per account
 * (`identity.sign-in`, the account's id) holds its journal; every entry is a `create` (nothing is changed).
 */
export const SIGN_IN_JOURNAL_ENTITY = "identity.sign-in";

/** Why a sign-in with a checked password failed. */
export type SignInFailure = "invalid-password" | "password-reset-required";

/** What locked sign-in of the address for 15 min (NFR-01 FR 9, FR 13): failed sign-ins or failed step-ups. */
export type SignInLockCause = "sign-in" | "step-up";

export type SignInEvent =
  | { readonly kind: "signed-in"; readonly accountId: string; readonly sessionId: string }
  | { readonly kind: "sign-in-failed"; readonly accountId: string; readonly reason: SignInFailure }
  | { readonly kind: "sign-in-locked"; readonly accountId: string; readonly reason: SignInLockCause }
  | {
      readonly kind: "session-ended";
      readonly accountId: string;
      readonly sessionId: string;
      readonly reason: SessionEndReason;
    };

/**
 * The request an event came with: its address as the server counts it (IPv4 as is, IPv6 its /64 network; NFR-14
 * FR 8) and its device. Null for the daily task, which ends sessions nobody came back to.
 */
export interface JournalClient {
  readonly address: string;
  readonly device: DeviceName;
}

/** An audit entry as the audit module takes it (`AuditEntryInput`), built without importing it. */
export interface JournalEntry {
  readonly actor: { readonly kind: "user"; readonly id: string } | { readonly kind: "system" };
  readonly channel: "web" | "system";
  readonly entity: { readonly type: typeof SIGN_IN_JOURNAL_ENTITY; readonly id: string };
  readonly action: "create";
  readonly changes: {
    readonly field: string;
    readonly before: null;
    readonly after: string | null;
    readonly sensitive: false;
  }[];
}

/** Session ends the user did themself: the sign-out and the password change in the profile. */
const BY_USER: ReadonlySet<SessionEndReason> = new Set(["signed-out", "password-change"]);

export function journalEntry(event: SignInEvent, client: JournalClient | null): JournalEntry {
  const byUser = event.kind === "signed-in" || (event.kind === "session-ended" && BY_USER.has(event.reason));
  const field = (name: string, value: string | null) =>
    ({ field: name, before: null, after: value, sensitive: false }) as const;
  return {
    actor: byUser ? { kind: "user", id: event.accountId } : { kind: "system" },
    channel: client ? "web" : "system",
    entity: { type: SIGN_IN_JOURNAL_ENTITY, id: event.accountId },
    action: "create",
    changes: [
      field("event", event.kind),
      ...("sessionId" in event ? [field("session", event.sessionId)] : []),
      ...("reason" in event ? [field("reason", event.reason)] : []),
      // An address the server could not read is not an address.
      field("ip", client && client.address !== "unknown" ? client.address : null),
      field("device", client ? deviceLabel(client.device) : null),
    ],
  };
}
