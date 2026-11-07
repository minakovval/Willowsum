// Створено: 2026-11-07 · Оновлено: 2026-11-07
//
// SLOs and alert rules as code (ARC-09 FR 4, NFR-10 FR 5–6, ADR-0006). This file is the single source: the
// rule file, the routing and the dashboard in infra/observability/ are generated from it by
// `node tools/observability/index.mjs --write`, and `pnpm check:alerts` (CI job `infra`) fails when they
// differ or when a rule breaks the checks in lib.mjs.
//
// Metric names are the Prometheus names under which Grafana Cloud (Mimir, OTLP ingestion) stores the
// OpenTelemetry metrics of apps/api/src/platform/telemetry/signals.ts: dots become underscores, the unit
// `s` adds `_seconds`, a monotonic counter adds `_total`; attributes become labels the same way
// (`http.response.status_code` → `http_response_status_code`). A test in apps/api keeps the two lists equal.
// One Grafana Cloud stack per environment, so the rules do not filter by environment.

/** The metrics the rules read: OpenTelemetry name → Prometheus name. */
export const METRICS = Object.freeze({
  "http.server.request.duration": "http_server_request_duration_seconds",
  "ws.provider.calls": "ws_provider_calls_total",
  "ws.bank_sync.runs": "ws_bank_sync_runs_total",
});

const DURATION = METRICS["http.server.request.duration"];
const BANK_SYNC = METRICS["ws.bank_sync.runs"];

/**
 * The timing behind «the on-call person gets the alert within 5 minutes» (NFR-10 FR 6, ARC-09 criterion
 * «час від збою до алерту ≤ 5 хв»). For a paging alert, from the moment the condition holds in the process:
 * the metric export interval (apps/api METRIC_EXPORT_INTERVAL_MS) + one more interval for rate() to see the
 * new sample + the rule evaluation interval + the rule's `for` + the routing's group_wait ≤ the limit.
 */
export const TIMING = Object.freeze({
  metricExportIntervalS: 30,
  evaluationIntervalS: 60,
  groupWaitS: 30,
  groupIntervalS: 60,
  repeatIntervalS: 4 * 3600,
  maxAlertDelayS: 300,
});

/** The SLOs (ARC-09 FR 4). Thresholds are the requirement's numbers; tests check them. */
export const SLOS = Object.freeze([
  {
    id: "api-availability",
    title: "API availability",
    objective: 0.999,
    window: "30d",
    description: "Share of API requests (health probes excluded) answered without a 5xx, over 30 days.",
    requirement: "ARC-09 FR 4; NFR-10 FR 5",
  },
  {
    id: "api-read-latency",
    title: "API read latency p95",
    thresholdS: 0.3,
    quantile: 0.95,
    methods: "GET|HEAD",
    minRequests5m: 20,
    description: "95th percentile of read (GET, HEAD) request duration over 5 minutes.",
    requirement: "ARC-09 FR 4; NFR-10 FR 5",
  },
  {
    id: "api-write-latency",
    title: "API write latency p95",
    thresholdS: 0.5,
    quantile: 0.95,
    methods: "POST|PUT|PATCH|DELETE",
    minRequests5m: 20,
    description: "95th percentile of write (POST, PUT, PATCH, DELETE) request duration over 5 minutes.",
    requirement: "ARC-09 FR 4; NFR-10 FR 5",
  },
  {
    id: "api-5xx-ratio",
    title: "API 5xx ratio",
    maxRatio: 0.01,
    description: "Share of API requests answered with a 5xx, over 5 minutes.",
    requirement: "ARC-09 FR 4; NFR-10 FR 6",
  },
  {
    id: "bank-sync-failure-ratio",
    title: "Bank sync failure ratio",
    maxRatio: 0.05,
    window: "1h",
    description: "Share of failed bank synchronisation runs over 1 hour (fed by bank-sync from FIN).",
    requirement: "NFR-10 FR 6",
  },
]);

const slo = (id) => SLOS.find((s) => s.id === id);
const BUDGET = 1 - slo("api-availability").objective;

/** Error-ratio windows of the multi-window, multi-burn-rate alerts (Google SRE workbook, chapter 5). */
export const ERROR_RATIO_WINDOWS = Object.freeze(["5m", "30m", "1h", "2h", "6h", "1d", "3d"]);

/**
 * A deliberate 503 is not an error of the service: a module switched off by its kill switch (CICD-06). The API
 * labels it `ws.unavailable.reason="kill_switch"` (a closed set); it is left out of the 5xx numerator, so a
 * planned action never pages on-call or burns the budget (lead's decision, ADR-0006). The same 503 answered
 * because the flag state is unknown (a failing database, fail closed) is labelled `flags_unknown` and counts,
 * as does a 503 during a graceful stop (a restart loop must show). A module left switched off is a ticket
 * instead (ApiModuleSwitchedOff).
 */
export const SERVER_ERROR_SELECTOR = `http_response_status_code=~"5..", ws_unavailable_reason!="kill_switch"`;

const errorRatio = (w) =>
  `sum(rate(${DURATION}_count{${SERVER_ERROR_SELECTOR}}[${w}])) / sum(rate(${DURATION}_count[${w}]))`;
const requests = (s) =>
  `sum(increase(${DURATION}_count{http_request_method=~"${s.methods}"}[5m]))`;
const p95 = (s) =>
  `histogram_quantile(${s.quantile}, sum by (le) (rate(${DURATION}_bucket{http_request_method=~"${s.methods}"}[5m])))`;

export const RECORDING_RULES = Object.freeze([
  { record: "ws:api_requests:rate5m", expr: `sum(rate(${DURATION}_count[5m]))` },
  ...ERROR_RATIO_WINDOWS.map((w) => ({ record: `ws:api_error_ratio:rate${w}`, expr: errorRatio(w) })),
  { record: "ws:api_read_latency_seconds:p95_5m", expr: p95(slo("api-read-latency")) },
  { record: "ws:api_write_latency_seconds:p95_5m", expr: p95(slo("api-write-latency")) },
  { record: "ws:api_read_requests:increase5m", expr: requests(slo("api-read-latency")) },
  { record: "ws:api_write_requests:increase5m", expr: requests(slo("api-write-latency")) },
  {
    record: "ws:api_module_unavailable:rate5m",
    expr: `sum(rate(${DURATION}_count{ws_unavailable_reason="kill_switch"}[5m]))`,
  },
  {
    record: "ws:bank_sync_failure_ratio:1h",
    expr: `sum(increase(${BANK_SYNC}{ws_outcome="failure"}[1h])) / sum(increase(${BANK_SYNC}[1h]))`,
  },
]);

const burn = (factor, long, short) =>
  `ws:api_error_ratio:rate${long} > (${factor} * ${round(BUDGET)}) and ws:api_error_ratio:rate${short} > (${factor} * ${round(BUDGET)})`;

function round(n) {
  return Number(n.toPrecision(6));
}

/**
 * The alerts. `severity: page` goes to the on-call person and must arrive within TIMING.maxAlertDelayS;
 * `ticket` is a slow budget erosion reviewed in working hours (it is not an outage). `requirement` names
 * the clause each alert satisfies; the check requires every clause of REQUIRED_ALERTS.
 */
export const ALERTS = Object.freeze([
  {
    alert: "ApiErrorBudgetBurnFast",
    expr: burn(14.4, "1h", "5m"),
    for: "2m",
    severity: "page",
    slo: "api-availability",
    requirement: "ARC-09 FR 4: error budget violation",
    summary: "API is burning the 30-day error budget 14.4× too fast (2 % of the budget in 1 hour)",
  },
  {
    alert: "ApiErrorBudgetBurnMedium",
    expr: burn(6, "6h", "30m"),
    for: "2m",
    severity: "page",
    slo: "api-availability",
    requirement: "ARC-09 FR 4: error budget violation",
    summary: "API is burning the 30-day error budget 6× too fast (5 % of the budget in 6 hours)",
  },
  {
    alert: "ApiErrorBudgetBurnSlow",
    expr: burn(1, "3d", "6h"),
    for: "15m",
    severity: "ticket",
    slo: "api-availability",
    requirement: "ARC-09 FR 4: error budget violation",
    summary: "API has used the error budget at the SLO rate for 3 days (10 % of the budget)",
  },
  {
    alert: "Api5xxRatioHigh",
    expr: `ws:api_error_ratio:rate5m > ${slo("api-5xx-ratio").maxRatio} and ws:api_requests:rate5m > 0`,
    for: "2m",
    severity: "page",
    slo: "api-5xx-ratio",
    requirement: "NFR-10 FR 6: 5xx ratio above 1 %",
    summary: "More than 1 % of API requests answered with a 5xx over 5 minutes",
  },
  {
    alert: "ApiReadLatencyP95High",
    // At PoC traffic one slow request would be the p95 of its window: page only with ≥ 20 reads in 5 minutes.
    expr: `ws:api_read_latency_seconds:p95_5m > ${slo("api-read-latency").thresholdS} and ws:api_read_requests:increase5m >= ${slo("api-read-latency").minRequests5m}`,
    for: "2m",
    severity: "page",
    slo: "api-read-latency",
    requirement: "NFR-10 FR 6: SLO violation (read p95 ≤ 300 ms)",
    summary: "API read p95 above 300 ms over 5 minutes",
  },
  {
    alert: "ApiWriteLatencyP95High",
    expr: `ws:api_write_latency_seconds:p95_5m > ${slo("api-write-latency").thresholdS} and ws:api_write_requests:increase5m >= ${slo("api-write-latency").minRequests5m}`,
    for: "2m",
    severity: "page",
    slo: "api-write-latency",
    requirement: "NFR-10 FR 6: SLO violation (write p95 ≤ 500 ms)",
    summary: "API write p95 above 500 ms over 5 minutes",
  },
  {
    alert: "ApiModuleSwitchedOff",
    // Seen through the requests it turns away; a module nobody calls is not reported.
    expr: "ws:api_module_unavailable:rate5m > 0",
    for: "30m",
    severity: "ticket",
    slo: "api-availability",
    requirement: "CICD-06: a module kill switch left on (not an outage, not paged)",
    summary: "A module's kill switch has turned requests away for more than 30 minutes",
  },
  {
    alert: "BankSyncFailureRatioHigh",
    expr: `ws:bank_sync_failure_ratio:1h > ${slo("bank-sync-failure-ratio").maxRatio}`,
    for: "1m",
    severity: "page",
    slo: "bank-sync-failure-ratio",
    requirement: "NFR-10 FR 6: bank sync failures above 5 % in an hour",
    summary: "More than 5 % of bank synchronisation runs failed in the last hour",
  },
]);

/** Every alert clause of NFR-10 FR 6 and ARC-09 FR 4; the check fails if one has no alert. */
export const REQUIRED_ALERTS = Object.freeze([
  "NFR-10 FR 6: bank sync failures above 5 % in an hour",
  "NFR-10 FR 6: 5xx ratio above 1 %",
  "NFR-10 FR 6: SLO violation (read p95 ≤ 300 ms)",
  "NFR-10 FR 6: SLO violation (write p95 ≤ 500 ms)",
  "ARC-09 FR 4: error budget violation",
]);

/** Dashboard panels (NFR-10 FR 5: SLO dashboards for availability and performance). */
export const DASHBOARD_PANELS = Object.freeze([
  {
    title: "Availability, 30 days (SLO 99.9 %)",
    type: "stat",
    unit: "percentunit",
    expr: `1 - (${errorRatio("30d")})`,
  },
  {
    title: "Error budget left, 30 days",
    type: "stat",
    unit: "percentunit",
    expr: `1 - ((${errorRatio("30d")}) / ${round(BUDGET)})`,
  },
  { title: "5xx ratio (alert above 1 %)", type: "timeseries", unit: "percentunit", expr: "ws:api_error_ratio:rate5m" },
  {
    title: "Read p95 (SLO ≤ 300 ms)",
    type: "timeseries",
    unit: "s",
    expr: "ws:api_read_latency_seconds:p95_5m",
  },
  {
    title: "Write p95 (SLO ≤ 500 ms)",
    type: "timeseries",
    unit: "s",
    expr: "ws:api_write_latency_seconds:p95_5m",
  },
  { title: "Requests per second", type: "timeseries", unit: "reqps", expr: "ws:api_requests:rate5m" },
  {
    title: "Turned away by a kill switch (not counted as errors)",
    type: "timeseries",
    unit: "reqps",
    expr: "ws:api_module_unavailable:rate5m",
  },
  {
    title: "Bank sync failure ratio, 1 hour (alert above 5 %)",
    type: "timeseries",
    unit: "percentunit",
    expr: "ws:bank_sync_failure_ratio:1h",
  },
]);
