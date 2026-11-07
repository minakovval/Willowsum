import type { Attributes } from "@opentelemetry/api";
import type { FastifyRequest } from "fastify";
import { databaseErrorAttributes } from "../db/errors.ts";
import type { ErrorReport } from "../http/api.ts";
import { annotateRequestError, logRequestEvent } from "./http.ts";

/** The attributes of an error report: all of its fields are value-free by construction (api.ts). */
export function errorReportAttributes(report: ErrorReport): Attributes {
  return {
    "http.request.method": report.method,
    ...(report.route ? { "http.route": report.route } : {}),
    "http.response.status_code": report.status,
    "ws.problem.code": report.code,
    "error.type": report.errorClass,
    ...(report.database ? databaseErrorAttributes(report.database) : {}),
    ...(report.provider
      ? {
          "ws.provider": report.provider.provider,
          "ws.provider.operation": report.provider.operation,
          "ws.provider.outcome": report.provider.kind,
        }
      : {}),
  };
}

/**
 * The API's error reporter (ApiOptions.reportError, ARC-09 FR 2, NFR-10 FR 2): a server error becomes the
 * log event `api.server_error` in the request's trace, and the request span gets the same attributes.
 */
export function reportServerErrorToTelemetry(report: ErrorReport, request: FastifyRequest): void {
  const attributes = errorReportAttributes(report);
  annotateRequestError(request, attributes);
  logRequestEvent(request, "api.server_error", "error", attributes);
}
