// Adapters of file-storage: database (ModuleDatabase, schema «file_storage»), the parsing worker, the type check.
export { databaseFilesStore, SPACE_LIMITS_LOCK } from "./db/store.ts";
export { isolatedInspector } from "./isolation/run.ts";
export type { Inspector, IsolationOptions } from "./isolation/run.ts";
export { CONTENT_TYPES, FILE_FORMATS, inspectFile } from "./inspection/inspect.ts";
export type { Ceilings, FileFormat, Inspection } from "./inspection/inspect.ts";
