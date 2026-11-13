// Domain layer of household: pure rules, no I/O (ARC-01 FR 5). Allowed imports: this folder,
// @willowsum/domain-kernel, zod, decimal.js.
export {
  firstSpaceName,
  SPACE_NAME_MAX,
  SPACE_NAME_PREFIX,
  SPACE_ROLES,
  spaceName,
  type SpaceRole,
} from "./spaces.ts";
export {
  keyRef,
  SPACE_KEY_ERROR_CODES,
  SpaceKeyError,
  type SpaceKeyErrorCode,
  type StoredSpaceKey,
} from "./keys.ts";
