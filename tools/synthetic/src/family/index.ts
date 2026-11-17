import { familyLedger, type FamilyLedger, type FamilyOptions } from "./model.ts";
import { statements, type RenderedStatement, type StatementFile } from "./statements.ts";

export type { FamilyAccount, FamilyLedger, FamilyOptions, FamilyTransaction, FamilyTransfer, RevertedOperation } from "./model.ts";
export type { RenderedStatement, StatementFile, StatementRow } from "./statements.ts";
export { encodeCp1251 } from "./cp1251.ts";
export { excelSerial, storedZip, xlsx } from "./xlsx.ts";

/** The ground truth written next to the statements: what an importer must read from each file. */
export interface FamilyTruth extends FamilyLedger {
  readonly generator: "willowsum-synthetic-family";
  readonly version: 1;
  readonly synthetic: true;
  readonly seed: string;
  readonly years: 2 | 3;
  readonly files: readonly StatementFile[];
}

export interface FamilyDataset {
  readonly truth: FamilyTruth;
  readonly statements: readonly RenderedStatement[];
}

/** A family's bank statements and their ground truth (ARC-03 FR 6). Same options → same bytes. */
export function generateFamily(options: FamilyOptions): FamilyDataset {
  const ledger = familyLedger(options);
  const rendered = statements(ledger);
  return {
    truth: {
      generator: "willowsum-synthetic-family",
      version: 1,
      synthetic: true,
      seed: options.seed,
      years: options.years,
      ...ledger,
      files: rendered.map((s) => s.file),
    },
    statements: rendered,
  };
}
