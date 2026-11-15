// Application layer of accounts: use cases, transactions, permission checks (ARC-01 FR 5).
// Uses ports; adapters are wired in ../index.ts.
export {
  accountView,
  createAccount,
  createdAccountView,
  findDuplicate,
  NUMBER_FIELD,
  type AccountAudit,
  type AccountsDeps,
  type AccountsTx,
  type AccountView,
  type Caller,
  type CreateResult,
  type CreatedAccount,
  accountCreatedValues,
  type Duplicate,
  type DuplicateCandidate,
  type NumberSeal,
  type StoredAccount,
  type StoredOwner,
  type StoredSubaccount,
} from "./accounts.ts";
export {
  accountsPage,
  accountsSummary,
  type AccountListItem,
  type AccountsListTx,
  type AccountsSummary,
  type ConvertedAmount,
  type CurrencyShare,
  type ListPosition,
  type ReportedSum,
} from "./summary.ts";
export {
  balanceNow,
  closeAccount,
  closingPreview,
  deleteAdjustment,
  reconcileStatement,
  reopenAccount,
  updateBalance,
  type CurrencyBalance,
  type ManageRefusal,
  type Settlement,
  type StatementResult,
} from "./manage.ts";
export type { AdjustmentView } from "./adjustments.ts";
export {
  settingsHandOff,
  SETTINGS_FIELDS,
  updateAccountSettings,
  type SettingsInput,
  type SettingsResult,
} from "./settings.ts";
export { updateAccountDetails, type DetailsResult } from "./details.ts";
export {
  applyHandOff,
  applyMoves,
  handOffKey,
  type AccountKinds,
  type AuditChange,
  type AuditValue,
  type HandOffMove,
  type HandOffStatus,
  type ManageActor,
  type ManagedHandOff,
  type HandOff,
  type HandOffAudit,
  type HandOffDeps,
  type HandOffSubaccount,
} from "./hand-off.ts";
