import type { HouseholdFreeDatabase } from "../../../../platform/http/route.ts";
import type { AuditLog } from "../../../audit/index.ts";
import { normalizeEmail } from "../../domain/index.ts";

/**
 * Erasure of an account on the person's request (NFR-12@PoC FR 3; ADR-0013): the owner's erasure script only. The
 * account goes with every row of it — confirmation and reset links, sign-up tokens, sessions (ON DELETE CASCADE), so
 * every open session ends at once. Short-lived throttle and sign-in-guard rows hold only keyed digests and are swept by
 * the daily task within their windows. The platform log gets the id and the reason first, never the address.
 */
export interface IdentityErasure {
  /** The id of the account with this address (normalised as at sign-up), or null. */
  accountIdByEmail(email: string): Promise<string | null>;
  /** Deletes the account and its rows; false if there was none. */
  eraseAccount(accountId: string): Promise<boolean>;
}

export function createIdentityErasure(options: {
  readonly db: HouseholdFreeDatabase;
  readonly audit: Pick<AuditLog, "recordPlatform">;
}): IdentityErasure {
  return {
    accountIdByEmail: (email) =>
      options.db.transaction(async (q) => {
        const { rows } = await q.query<{ id: string }>(
          `SELECT id FROM accounts WHERE email_normalized = $1`,
          [normalizeEmail(email)],
        );
        return rows[0]?.id ?? null;
      }),
    async eraseAccount(accountId) {
      const exists = await options.db.transaction(
        async (q) => ((await q.query(`SELECT 1 FROM accounts WHERE id = $1`, [accountId])).rowCount ?? 0) > 0,
      );
      if (!exists) return false;
      // Recorded first: a failed write leaves the account for a repeat (at most a second entry, never none).
      await options.audit.recordPlatform({
        actor: { kind: "system" },
        channel: "system",
        entity: { type: "identity.account", id: accountId },
        action: "delete",
        changes: [{ field: "reason", before: null, after: "erasure-request", sensitive: false }],
      });
      return options.db.transaction(
        async (q) => ((await q.query(`DELETE FROM accounts WHERE id = $1`, [accountId])).rowCount ?? 0) > 0,
      );
    },
  };
}
