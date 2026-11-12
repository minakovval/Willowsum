import type { Attributes, Link } from "@opentelemetry/api";
import { ExportResultCode, hrTimeToTimeStamp, type ExportResult } from "@opentelemetry/core";
import { resourceFromAttributes, type Resource } from "@opentelemetry/resources";
import type { LogRecordExporter, ReadableLogRecord } from "@opentelemetry/sdk-logs";
import type {
  AggregationTemporality,
  InstrumentType,
  MetricData,
  PushMetricExporter,
  ResourceMetrics,
} from "@opentelemetry/sdk-metrics";
import type { ReadableSpan, SpanExporter, TimedEvent } from "@opentelemetry/sdk-trace";
import {
  redactAttributes,
  redactName,
  redactSeverityText,
  redactSpanName,
  redactUnit,
  redactVersion,
} from "./redaction.ts";

/**
 * Exporter-level redaction (ARC-09 FR 2, ADR-0006): every exporter of the process — OTLP or in-memory — is
 * wrapped, so what a test sees in memory is exactly what would be sent. The wrappers copy each item with
 * only the allow-listed attributes (redaction.ts) and drop free text: span status messages, exception
 * messages and stack traces, scope attributes, link and event attributes outside the allow-list, metric
 * descriptions; severity texts, scope versions and metric units only when they fit their grammar.
 */

const resources = new WeakMap<Resource, Resource>();

export function redactResource(resource: Resource): Resource {
  let out = resources.get(resource);
  if (!out) {
    out = resourceFromAttributes(redactAttributes(resource.attributes));
    resources.set(resource, out);
  }
  return out;
}

const scope = <T extends { name: string; version?: string; schemaUrl?: string }>(s: T) => {
  const version = redactVersion(s.version);
  return { name: redactName(s.name), ...(version !== undefined ? { version } : {}) };
};

function redactEvent(event: TimedEvent): TimedEvent {
  return { time: event.time, name: redactName(event.name), attributes: redactAttributes(event.attributes) };
}

function redactLink(link: Link): Link {
  return { context: link.context, attributes: redactAttributes(link.attributes) };
}

export function redactSpan(span: ReadableSpan): ReadableSpan {
  const context = span.spanContext();
  return {
    name: redactSpanName(span.name),
    kind: span.kind,
    spanContext: () => context,
    ...(span.parentSpanContext ? { parentSpanContext: span.parentSpanContext } : {}),
    startTime: span.startTime,
    endTime: span.endTime,
    // The code only (OK / ERROR): a status message may hold an error message.
    status: { code: span.status.code },
    attributes: redactAttributes(span.attributes),
    links: span.links.map(redactLink),
    events: span.events.map(redactEvent),
    duration: span.duration,
    ended: span.ended,
    resource: redactResource(span.resource),
    instrumentationScope: scope(span.instrumentationScope),
    droppedAttributesCount: span.droppedAttributesCount,
    droppedEventsCount: span.droppedEventsCount,
    droppedLinksCount: span.droppedLinksCount,
  };
}

export function redactLogRecord(record: ReadableLogRecord): ReadableLogRecord {
  return {
    hrTime: record.hrTime,
    hrTimeObserved: record.hrTimeObserved,
    ...(record.spanContext ? { spanContext: record.spanContext } : {}),
    ...(redactSeverityText(record.severityText) !== undefined ? { severityText: record.severityText } : {}),
    ...(record.severityNumber !== undefined ? { severityNumber: record.severityNumber } : {}),
    // The body is an event name, never a message.
    body: redactName(record.body),
    ...(record.eventName !== undefined ? { eventName: redactName(record.eventName) } : {}),
    resource: redactResource(record.resource),
    instrumentationScope: scope(record.instrumentationScope),
    attributes: redactAttributes(record.attributes),
    droppedAttributesCount: record.droppedAttributesCount,
  };
}

function redactMetric(metric: MetricData): MetricData {
  // The description is free text: never exported. The unit only when it is a unit.
  const descriptor = {
    ...metric.descriptor,
    name: redactName(metric.descriptor.name),
    description: "",
    unit: redactUnit(metric.descriptor.unit),
  };
  const points = <T>(dataPoints: readonly { attributes: Attributes; value: T }[]) =>
    dataPoints.map((p) => ({ ...p, attributes: redactAttributes(p.attributes) }));
  return { ...metric, descriptor, dataPoints: points(metric.dataPoints as never) } as MetricData;
}

export function redactResourceMetrics(metrics: ResourceMetrics): ResourceMetrics {
  return {
    resource: redactResource(metrics.resource),
    scopeMetrics: metrics.scopeMetrics.map((s) => ({
      scope: scope(s.scope),
      metrics: s.metrics.map(redactMetric),
    })),
  };
}

export function redactingSpanExporter(inner: SpanExporter): SpanExporter {
  return {
    export: (spans, done) => inner.export(spans.map(redactSpan), done),
    shutdown: () => inner.shutdown(),
    ...(inner.forceFlush ? { forceFlush: () => inner.forceFlush!() } : {}),
  };
}

export function redactingLogRecordExporter(inner: LogRecordExporter): LogRecordExporter {
  return {
    export: (records, done) => inner.export(records.map(redactLogRecord), done),
    shutdown: () => inner.shutdown(),
    forceFlush: () => inner.forceFlush(),
  };
}

export function redactingMetricExporter(inner: PushMetricExporter): PushMetricExporter {
  return {
    export: (metrics, done) => inner.export(redactResourceMetrics(metrics), done),
    shutdown: () => inner.shutdown(),
    forceFlush: () => inner.forceFlush(),
    ...(inner.selectAggregationTemporality
      ? { selectAggregationTemporality: (type: InstrumentType) => inner.selectAggregationTemporality!(type) }
      : {}),
    ...(inner.selectAggregation
      ? { selectAggregation: (type: InstrumentType) => inner.selectAggregation!(type) }
      : {}),
  };
}

/** Items kept by the `test` mode: the newest `limit` of each signal (a long local run stays bounded). */
export const MEMORY_LIMIT = 1_000;

const ok: ExportResult = { code: ExportResultCode.SUCCESS };

class Bounded<T> {
  items: T[] = [];
  private readonly limit: number;
  constructor(limit: number) {
    this.limit = limit;
  }
  push(values: readonly T[]): void {
    this.items.push(...values);
    if (this.items.length > this.limit) this.items.splice(0, this.items.length - this.limit);
  }
}

/** The in-memory exporters of the `test` mode (local development, CI and tests). */
export class MemoryExporters {
  private readonly spanStore: Bounded<ReadableSpan>;
  private readonly logStore: Bounded<ReadableLogRecord>;
  private readonly metricStore: Bounded<ResourceMetrics>;
  readonly spans: SpanExporter;
  readonly logs: LogRecordExporter;
  readonly metrics: PushMetricExporter;

  constructor(limit = MEMORY_LIMIT, temporality?: AggregationTemporality) {
    this.spanStore = new Bounded(limit);
    this.logStore = new Bounded(limit);
    this.metricStore = new Bounded(limit);
    const done = async () => undefined;
    this.spans = {
      export: (items, cb) => {
        this.spanStore.push(items);
        cb(ok);
      },
      shutdown: done,
      forceFlush: done,
    };
    this.logs = {
      export: (items, cb) => {
        this.logStore.push(items);
        cb(ok);
      },
      shutdown: done,
      forceFlush: done,
    };
    this.metrics = {
      export: (item, cb) => {
        this.metricStore.push([item]);
        cb(ok);
      },
      shutdown: done,
      forceFlush: done,
      ...(temporality !== undefined ? { selectAggregationTemporality: () => temporality } : {}),
    };
  }

  finishedSpans(): readonly ReadableSpan[] {
    return this.spanStore.items;
  }

  logRecords(): readonly ReadableLogRecord[] {
    return this.logStore.items;
  }

  resourceMetrics(): readonly ResourceMetrics[] {
    return this.metricStore.items;
  }

  reset(): void {
    this.spanStore.items = [];
    this.logStore.items = [];
    this.metricStore.items = [];
  }
}

/** One structured log line on the server (mode `off`): JSON, one record per line. */
export interface ServerLogLine {
  readonly time: string;
  readonly severity?: string;
  readonly event: unknown;
  readonly trace_id?: string;
  readonly span_id?: string;
  readonly resource: Attributes;
  readonly attributes: Attributes;
  /** Lines dropped just before this one because standard output was not draining. */
  readonly dropped_lines?: number;
}

export function serverLogLine(record: ReadableLogRecord): ServerLogLine {
  return {
    time: hrTimeToTimeStamp(record.hrTime),
    ...(record.severityText !== undefined ? { severity: record.severityText } : {}),
    event: record.body,
    ...(record.spanContext
      ? { trace_id: record.spanContext.traceId, span_id: record.spanContext.spanId }
      : {}),
    resource: record.resource.attributes,
    attributes: record.attributes,
  };
}

/** A writable stream the server log lines go to (process.stdout by default). */
export interface ServerLogStream {
  write(chunk: string): boolean;
  readonly writableLength: number;
}

/** At most this many bytes of log lines wait in the process for a slow standard output; newer lines are dropped. */
export const SERVER_LOG_MAX_PENDING_BYTES = 1024 * 1024;
/** How long forceFlush and shutdown wait for standard output to drain before giving up. */
export const SERVER_LOG_FLUSH_TIMEOUT_MS = 2_000;

/**
 * Structured logs on the server without export (mode `off`; PoC by the owner's decision of 2026-11-12, NFR-10
 * FR 1): each log record is written to standard output as one JSON line. Like every exporter it is wrapped by
 * the redaction filter (telemetry.ts), so a line holds exactly what OTLP would have sent.
 *
 * Standard output to a pipe or socket is asynchronous in Node: a reader that stalls makes the stream buffer in
 * the process. Lines beyond SERVER_LOG_MAX_PENDING_BYTES are dropped (and counted on the next line written), so
 * memory stays bounded; forceFlush and shutdown wait (bounded) until the stream has drained, so the lines are
 * not lost when the process exits after its stop hooks.
 */
export class JsonLinesLogExporter implements LogRecordExporter {
  private readonly out: ((line: string) => void) | ServerLogStream;
  private dropped = 0;

  constructor(out: ((line: string) => void) | ServerLogStream = process.stdout) {
    this.out = out;
  }

  export(records: ReadableLogRecord[], done: (result: ExportResult) => void): void {
    for (const record of records) {
      const line = serverLogLine(record);
      const text = `${JSON.stringify(this.dropped > 0 ? { ...line, dropped_lines: this.dropped } : line)}\n`;
      if (typeof this.out === "function") {
        this.out(text);
        continue;
      }
      if (this.out.writableLength + Buffer.byteLength(text) > SERVER_LOG_MAX_PENDING_BYTES) {
        this.dropped += 1;
        continue;
      }
      this.dropped = 0;
      this.out.write(text);
    }
    done(ok);
  }

  async shutdown(): Promise<void> {
    await this.forceFlush();
  }

  async forceFlush(): Promise<void> {
    const out = this.out;
    if (typeof out === "function") return;
    const deadline = Date.now() + SERVER_LOG_FLUSH_TIMEOUT_MS;
    while (out.writableLength > 0 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
