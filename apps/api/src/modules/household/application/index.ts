// Application layer of household: use cases, transactions, permission checks (ARC-01 FR 5).
// Uses ports; adapters are wired in ../index.ts.
export { ensureFirstSpace } from "./spaces.ts";
export type { SpaceAudit, SpaceMembership, SpacesDeps, SpacesStore, SpacesTx } from "./spaces.ts";
export {
  destroySpaceKey,
  fieldOpener,
  newSpaceKey,
  openBytes,
  openField,
  openWithFieldOpener,
  rewrapFromSource,
  rewrapSpaceKeys,
  unopenableSpaceKeys,
  sealBytes,
  sealField,
  SEAL_BYTES_MAX,
  SEAL_MAX_LENGTH,
  wipeFieldOpener,
} from "./space-keys.ts";
export type {
  FieldOpener,
  RewrapFromResult,
  RewrapResult,
  RewrapSource,
  SpaceKeyAudit,
  SpaceKeysDeps,
} from "./space-keys.ts";
export { abortDataKeyRotations, rotateDataKeys, RotationTargetError } from "./data-key-rotation.ts";
export type {
  DataKeyAbortResult,
  DataKeyRotationOptions,
  DataKeyRotationResult,
} from "./data-key-rotation.ts";
export { renameSpace } from "./settings.ts";
export type { RenameResult, SpaceRenameAudit, SpaceSettings, SpaceSettingsTx } from "./settings.ts";
