/**
 * `WS_TELEMETRY` (ARC-09, ADR-0006): where telemetry goes.
 * - `test` — the default (local development and CI): every signal passes the redaction filter and is kept in
 *   bounded memory in the process; nothing leaves the machine.
 * - `otlp` — deployed environments: OTLP/HTTP to `WS_OTLP_ENDPOINT` with the `WS_OTLP_AUTHORIZATION` header.
 * - `off` — nothing is kept or sent; requests still get a random trace id (the support code of errors).
 */
export const TELEMETRY_MODES = ["test", "otlp", "off"] as const;
export type TelemetryMode = (typeof TELEMETRY_MODES)[number];
