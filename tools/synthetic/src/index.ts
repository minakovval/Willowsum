// Synthetic data generator (ARC-03 FR 6, П-9). Synthetic only — never real data.
export { Rng } from "./random.ts";
export { defineSyntheticTable } from "./define.ts";
export type { SyntheticContext, SyntheticHousehold, SyntheticRow, SyntheticTable } from "./define.ts";
export { generate, syntheticHouseholds } from "./generate.ts";
export type { GenerateOptions, GeneratedRow } from "./generate.ts";
export { csvField, toCsv, toSql } from "./output.ts";
export type { CsvChunk } from "./output.ts";
export { loadModuleGenerators } from "./modules.ts";
