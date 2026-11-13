// Application layer of household: use cases, transactions, permission checks (ARC-01 FR 5).
// Uses ports; adapters are wired in ../index.ts.
export { ensureFirstSpace } from "./spaces.ts";
export type { SpaceAudit, SpaceMembership, SpacesDeps, SpacesStore, SpacesTx } from "./spaces.ts";
export {
  destroySpaceKey,
  newSpaceKey,
  openField,
  rewrapSpaceKeys,
  sealField,
  SEAL_MAX_LENGTH,
} from "./space-keys.ts";
export type { RewrapResult, SpaceKeyAudit, SpaceKeysDeps } from "./space-keys.ts";
export { renameSpace } from "./settings.ts";
export type { RenameResult, SpaceRenameAudit, SpaceSettings, SpaceSettingsTx } from "./settings.ts";
