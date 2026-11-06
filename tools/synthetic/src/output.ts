import type { GeneratedRow } from "./generate.ts";

/** One CSV field as PostgreSQL COPY … (FORMAT csv) reads it: null is an empty unquoted field. */
export function csvField(value: string | null): string {
  if (value === null) return "";
  return `"${value.replaceAll('"', '""')}"`;
}

export interface CsvChunk {
  readonly table: string;
  /** The column-name line that starts each table. */
  readonly header: boolean;
  readonly text: string;
}

/**
 * Turns the stream into CSV lines per table, header first. Rows of a table arrive together (generate()
 * emits table by table); the first row of a table fixes its columns.
 */
export function* toCsv(rows: Iterable<GeneratedRow>): Generator<CsvChunk> {
  let current: { table: string; columns: string[] } | undefined;
  for (const { table, row } of rows) {
    if (current?.table !== table) {
      current = { table, columns: Object.keys(row) };
      yield { table, header: true, text: `${current.columns.join(",")}\n` };
    }
    const columns = current.columns;
    if (Object.keys(row).length !== columns.length || columns.some((c) => !(c in row)))
      throw new Error(`${table}: every row must have the same columns`);
    yield { table, header: false, text: `${columns.map((c) => csvField(row[c] ?? null)).join(",")}\n` };
  }
}

/** A psql script: one `COPY … FROM stdin` block per table, for the schema owner loading a test database. */
export function* toSql(rows: Iterable<GeneratedRow>): Generator<string> {
  let open = false;
  yield "-- Synthetic data (ARC-03 FR 6). Never real data.\n";
  for (const { table, header, text } of toCsv(rows)) {
    if (header) {
      if (open) yield "\\.\n";
      yield `COPY ${table} (${text.trimEnd()}) FROM stdin WITH (FORMAT csv);\n`;
      open = true;
    } else {
      yield text;
    }
  }
  if (open) yield "\\.\n";
}
