// Створено: 2026-11-07 · Оновлено: 2026-11-07
// ARC-09 FR 4, NFR-10 FR 5–6 and acceptance 2: SLOs and alert rules as code. Run: node --test tools/observability
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import * as defs from "../definitions.mjs";
import { alertDelaySeconds, durationSeconds, generate, seriesIn, toYaml, validate } from "../lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "../../../infra/observability");
const alert = (name) => defs.ALERTS.find((a) => a.alert === name);
const slo = (id) => defs.SLOS.find((s) => s.id === id);

describe("ARC-09 FR 4: the SLOs are the requirement's numbers", () => {
  it("availability 99.9 % per month, read p95 ≤ 300 ms, write p95 ≤ 500 ms, 5xx ≤ 1 %, bank sync failures ≤ 5 % per hour", () => {
    assert.equal(slo("api-availability").objective, 0.999);
    assert.equal(slo("api-availability").window, "30d");
    assert.equal(slo("api-read-latency").thresholdS, 0.3);
    assert.equal(slo("api-read-latency").quantile, 0.95);
    assert.equal(slo("api-write-latency").thresholdS, 0.5);
    assert.equal(slo("api-5xx-ratio").maxRatio, 0.01);
    assert.equal(slo("bank-sync-failure-ratio").maxRatio, 0.05);
    assert.equal(slo("bank-sync-failure-ratio").window, "1h");
  });
});

describe("NFR-10 FR 6: every required alert exists, pages, and uses the thresholds", () => {
  it("bank sync > 5 % in an hour, 5xx > 1 %, read and write p95, error-budget burn", () => {
    assert.deepEqual(validate(defs), []);
    assert.match(alert("BankSyncFailureRatioHigh").expr, /ws:bank_sync_failure_ratio:1h > 0\.05$/);
    assert.match(alert("Api5xxRatioHigh").expr, /ws:api_error_ratio:rate5m > 0\.01 /);
    assert.match(alert("ApiReadLatencyP95High").expr, /> 0\.3 and /);
    assert.match(alert("ApiWriteLatencyP95High").expr, /> 0\.5 and /);
    assert.match(alert("ApiErrorBudgetBurnFast").expr, /rate1h > \(14\.4 \* 0\.001\) and .*rate5m > \(14\.4 \* 0\.001\)/);
    const bank = defs.RECORDING_RULES.find((r) => r.record === "ws:bank_sync_failure_ratio:1h");
    assert.match(bank.expr, /ws_bank_sync_runs_total\{ws_outcome="failure"\}\[1h\]/);
  });

  it("every burn-rate alert has its factor and both windows; the 5xx selector counts 5.. without deliberate 503s", () => {
    const burn = (name) => alert(name).expr;
    assert.equal(burn("ApiErrorBudgetBurnFast"), "ws:api_error_ratio:rate1h > (14.4 * 0.001) and ws:api_error_ratio:rate5m > (14.4 * 0.001)");
    assert.equal(burn("ApiErrorBudgetBurnMedium"), "ws:api_error_ratio:rate6h > (6 * 0.001) and ws:api_error_ratio:rate30m > (6 * 0.001)");
    assert.equal(burn("ApiErrorBudgetBurnSlow"), "ws:api_error_ratio:rate3d > (1 * 0.001) and ws:api_error_ratio:rate6h > (1 * 0.001)");
    assert.deepEqual(
      ["ApiErrorBudgetBurnFast", "ApiErrorBudgetBurnMedium", "ApiErrorBudgetBurnSlow"].map((a) => alert(a).severity),
      ["page", "page", "ticket"],
    );
    // Only a deliberate kill switch is left out: an unknown flag state (a failing database) and a 503 during a
    // stop still count (review of PR #85).
    assert.equal(defs.SERVER_ERROR_SELECTOR, 'http_response_status_code=~"5..", ws_unavailable_reason!="kill_switch"');
    assert.doesNotMatch(defs.SERVER_ERROR_SELECTOR, /flags_unknown|ws_problem_code|SERVICE_UNAVAILABLE/);
    for (const w of defs.ERROR_RATIO_WINDOWS) {
      const rule = defs.RECORDING_RULES.find((r) => r.record === `ws:api_error_ratio:rate${w}`);
      assert.equal(
        rule.expr,
        `sum(rate(http_server_request_duration_seconds_count{${defs.SERVER_ERROR_SELECTOR}}[${w}])) / sum(rate(http_server_request_duration_seconds_count[${w}]))`,
      );
    }
    assert.deepEqual([...defs.ERROR_RATIO_WINDOWS], ["5m", "30m", "1h", "2h", "6h", "1d", "3d"]);
  });

  it("lead's decision: a kill switch is not an error; a module left switched off for 30 minutes is a ticket", () => {
    const off = alert("ApiModuleSwitchedOff");
    assert.equal(off.severity, "ticket");
    assert.equal(off.for, "30m");
    assert.equal(off.expr, "ws:api_module_unavailable:rate5m > 0");
    const rule = defs.RECORDING_RULES.find((r) => r.record === "ws:api_module_unavailable:rate5m");
    assert.equal(rule.expr, 'sum(rate(http_server_request_duration_seconds_count{ws_unavailable_reason="kill_switch"}[5m]))');
  });

  it("latency pages need at least 20 requests of their kind in 5 minutes (one slow request at PoC traffic does not page)", () => {
    assert.match(alert("ApiReadLatencyP95High").expr, /> 0\.3 and ws:api_read_requests:increase5m >= 20$/);
    assert.match(alert("ApiWriteLatencyP95High").expr, /> 0\.5 and ws:api_write_requests:increase5m >= 20$/);
    const reads = defs.RECORDING_RULES.find((r) => r.record === "ws:api_read_requests:increase5m");
    assert.match(reads.expr, /http_request_method=~"GET\|HEAD"/);
    const writes = defs.RECORDING_RULES.find((r) => r.record === "ws:api_write_requests:increase5m");
    assert.match(writes.expr, /http_request_method=~"POST\|PUT\|PATCH\|DELETE"/);
  });

  it("a missing required alert, an unknown series, a bad duration or a slow page is refused", () => {
    const without = { ...defs, ALERTS: defs.ALERTS.filter((a) => a.alert !== "Api5xxRatioHigh") };
    assert.ok(validate(without).some((p) => p.includes("NFR-10 FR 6: 5xx ratio above 1 %")));
    const unknown = { ...defs, ALERTS: [...defs.ALERTS, { ...alert("Api5xxRatioHigh"), alert: "X1", expr: "nope_total > 1" }] };
    assert.ok(validate(unknown).some((p) => p.includes("unknown series nope_total")));
    const badFor = { ...defs, ALERTS: [{ ...alert("Api5xxRatioHigh"), for: "two minutes" }] };
    assert.ok(validate(badFor).some((p) => p.includes("not a duration")));
    const slow = { ...defs, ALERTS: [{ ...alert("Api5xxRatioHigh"), for: "5m" }] };
    assert.ok(validate(slow).some((p) => p.includes("exceeds 300 s")));
    const unbalanced = { ...defs, ALERTS: [{ ...alert("Api5xxRatioHigh"), expr: "sum(rate(x[5m])" }] };
    assert.ok(validate(unbalanced).some((p) => p.includes("unbalanced")));
  });
});

describe("NFR-10 acceptance 2: a 5xx ratio above 1 % reaches the on-call person within 5 minutes", () => {
  it("export interval + rate lag + evaluation + for + group_wait ≤ 300 s for every paging alert", () => {
    assert.equal(defs.TIMING.maxAlertDelayS, 300);
    for (const a of defs.ALERTS.filter((x) => x.severity === "page")) {
      const delay = alertDelaySeconds(defs.TIMING, durationSeconds(a.for));
      assert.ok(delay <= 300, `${a.alert}: ${delay} s`);
    }
    assert.equal(alertDelaySeconds(defs.TIMING, durationSeconds(alert("Api5xxRatioHigh").for)), 270);
  });

  it("the routing sends pages to on-call with group_wait 30 s; tickets go elsewhere", () => {
    const text = generate(defs)["alertmanager.yaml"];
    assert.match(text, /receiver: "on-call"/);
    assert.match(text, /group_wait: "30s"/);
    assert.match(text, /- "severity=\\"ticket\\""/);
  });
});

describe("infra/observability is generated from the definitions", () => {
  it("the committed files equal the generated ones (run index.mjs --write after a change)", () => {
    for (const [name, text] of Object.entries(generate(defs)))
      assert.equal(fs.readFileSync(path.join(out, name), "utf8"), text, `${name} is out of date`);
  });

  it("NFR-10 FR 5: the dashboard shows availability, error budget, 5xx, read and write p95 and bank sync", () => {
    const board = JSON.parse(generate(defs)["dashboard-slo.json"]);
    const titles = board.panels.map((p) => p.title).join(" | ");
    for (const w of ["Availability", "Error budget", "5xx", "Read p95", "Write p95", "Bank sync", "kill switch"]) assert.ok(titles.includes(w), w);
  });

  it("the YAML writer quotes every string and nests lists of maps", () => {
    assert.equal(toYaml({ a: ["x", { b: 1, c: 'q"' }], d: [] }), 'a:\n  - "x"\n  - b: 1\n    c: "q\\""\nd: []\n');
    assert.throws(() => toYaml({ "a b": 1 }), /plain identifier/);
    assert.deepEqual([...seriesIn('sum by (le) (rate(x_bucket{a="b"}[5m])) > 0.3 and y:z:w')], ["x_bucket", "y:z:w"]);
    assert.equal(durationSeconds("3d"), 259200);
  });
});
