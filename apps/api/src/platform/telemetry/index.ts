// Telemetry of the backend (ARC-09, NFR-10, ADR-0006): OpenTelemetry traces, metrics and logs through the
// redaction filter; the exporter is configuration only (WS_TELEMETRY, WS_OTLP_ENDPOINT, WS_OTLP_AUTHORIZATION).
export { databaseErrorAttributes, databaseErrorFields } from "../db/errors.ts";
export type { DatabaseErrorFields } from "../db/errors.ts";
export { errorReportAttributes, reportServerErrorToTelemetry } from "./errors.ts";
export {
  MEMORY_LIMIT,
  MemoryExporters,
  redactLogRecord,
  redactResourceMetrics,
  redactSpan,
} from "./exporters.ts";
export {
  annotateRequestError,
  instrumentHttp,
  logRequestEvent,
  requestContext,
  requestTraceId,
} from "./http.ts";
export { jobTraceCarrier, runJob, runScheduled } from "./jobs.ts";
export type { JobTraceCarrier } from "./jobs.ts";
export { TELEMETRY_MODES } from "./modes.ts";
export type { TelemetryMode } from "./modes.ts";
export {
  ATTRIBUTE_RULES,
  looksPersonal,
  REDACTED,
  redactAttributes,
  redactName,
  redactSpanName,
} from "./redaction.ts";
export { HTTP_DURATION_BUCKETS_S, logEvent, METRICS, recordBankSyncRun } from "./signals.ts";
export {
  METRIC_EXPORT_INTERVAL_MS,
  randomIdGenerator,
  SERVICE_NAME,
  startTelemetry,
  TELEMETRY_SCOPE,
} from "./telemetry.ts";
export type { Telemetry, TelemetryOptions } from "./telemetry.ts";
