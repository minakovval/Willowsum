// Application layer of file-storage: use cases, transactions, permission checks (ARC-01 FR 5).
// Uses ports; adapters are wired in ../index.ts.
export {
  cleanFileName,
  FILE_KINDS,
  FileNotFoundError,
  findFile,
  linkFile,
  openLink,
  removeFile,
  spaceUsage,
  storeFile,
} from "./files.ts";
export type {
  Download,
  FileCrypto,
  FileInspection,
  FileKind,
  FileObjects,
  FilesAudit,
  FilesDeps,
  FilesStore,
  FilesTx,
  StoredFile,
  StoreRequest,
} from "./files.ts";
export { linkKey, signLink, verifyLink } from "./signed-link.ts";
export type { LinkKey } from "./signed-link.ts";
export { uploadBudget } from "./upload-budget.ts";
export type { UploadBudget } from "./upload-budget.ts";
