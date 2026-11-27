import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";
import { sealedColumnsPart, type ResealPart } from "../../../../platform/modules/reseal.ts";
import { NUMBER_FIELD } from "../../application/index.ts";

/**
 * NFR-01@PoC FR 3: the space's sealed account numbers (`accounts.number_sealed`, field `accounts.number`), sealed
 * again with the space's new data key by the data-key rotation. Only the sealed value changes: the account's version,
 * `updated_at` and audit stay as they are (the number itself is the same).
 */
export function accountsResealPart(db: ModuleDatabase): ResealPart {
  return sealedColumnsPart("accounts", db, [
    {
      table: "accounts",
      keys: ["id"],
      column: "number_sealed",
      sealedFor: { kind: "field", field: NUMBER_FIELD },
    },
  ]);
}
