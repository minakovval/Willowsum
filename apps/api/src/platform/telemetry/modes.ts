/**
 * `WS_TELEMETRY` (ARC-09, ADR-0006): where telemetry goes.
 * - `test` — the default (local development and CI): every signal passes the redaction filter and is kept in
 *   bounded memory in the process; nothing leaves the machine.
 * - `otlp` — deployed environments: OTLP/HTTP to `WS_OTLP_ENDPOINT` with the `WS_OTLP_AUTHORIZATION` header.
 * - `off` — nothing is exported: log records (through the same redaction filter) are written to standard
 *   output as JSON lines, the structured logs on the server; spans and metrics are not kept. Requests still get
 *   a random trace id (the support code of errors). The PoC runs in production this way (owner, 2026-11-12).
 */
export const TELEMETRY_MODES = ["test", "otlp", "off"] as const;
export type TelemetryMode = (typeof TELEMETRY_MODES)[number];
