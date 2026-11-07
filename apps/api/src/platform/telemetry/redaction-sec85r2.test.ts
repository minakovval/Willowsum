import { describe, expect, it } from "vitest";
import { PROBLEM_CODES } from "../http/problem.ts";
import { redactAttributes, redactSeverityText, redactUnit, redactVersion } from "./redaction.ts";

/**
 * Security review of PR #85, round 2 (ARC-09 FR 2, ADR-0006): the closed set of `ws.problem.code` (it labels
 * the duration metric and the alert selector), and the grammars of the free-text fields filtered since round 1
 * (severity text, metric unit, scope version). Synthetic values are built at run time.
 */
const CARD = ["4111", "1111", "1111", "1111"].join("");

describe("sec85r2: ws.problem.code is exactly one of the API's own problem codes", () => {
  it("every problem code of the API is kept", () => {
    for (const code of PROBLEM_CODES)
      expect(redactAttributes({ "ws.problem.code": code })).toEqual({ "ws.problem.code": code });
  });

  it.each([
    "OLHA_KOVALENKO", // fits the old code grammar, is not a problem code
    "XNOT_FOUND", // a code with a prefix
    "NOT_FOUND_OLHA", // a code with a suffix
    "INTERNAL\nOLHA",
    "not_found", // case matters: the alert selector compares exactly
    "MODULE_UNAVAILABLE|INTERNAL",
  ])("%j is dropped", (value) => {
    expect(redactAttributes({ "ws.problem.code": value })).toEqual({ "ws.telemetry.redacted": 1 });
  });
});

describe("sec85r2: ws.unavailable.reason is exactly kill_switch or flags_unknown", () => {
  it("both reasons are kept", () => {
    for (const reason of ["kill_switch", "flags_unknown"])
      expect(redactAttributes({ "ws.unavailable.reason": reason })).toEqual({
        "ws.unavailable.reason": reason,
      });
  });

  it.each(["kill_switch_olha", "xkill_switch", "Kill_switch", "kill_switch\nx", "olha_kovalenko", ""])(
    "%j is dropped",
    (value) =>
      expect(redactAttributes({ "ws.unavailable.reason": value })).toEqual({ "ws.telemetry.redacted": 1 }),
  );
});

describe("sec85r2: grammars of the severity text, the metric unit and the scope version", () => {
  it.each(["ERROR", "WARN", "INFO2", "FATAL4"])("severity %s is kept", (value) =>
    expect(redactSeverityText(value)).toBe(value),
  );

  it.each([`ERROR ${CARD}`, "ERROR olha.kovalenko", "WARN: Олена", "INFO5", "error"])(
    "severity %j is dropped",
    (value) => expect(redactSeverityText(value)).toBeUndefined(),
  );

  it.each(["s", "ms", "By", "{call}", "1", "%"])("unit %j is kept", (value) =>
    expect(redactUnit(value)).toBe(value),
  );

  it.each(["{Олена}", "{olha kovalenko}", "{family:savings}", "{a,b}", `{x}${"s".repeat(40)}`])(
    "unit %j is emptied",
    (value) => expect(redactUnit(value)).toBe(""),
  );

  it.each(["1.0.0", "2.40.1", "1.0.0-rc.1", "0.1.0-alpha"])("version %s is kept", (value) =>
    expect(redactVersion(value)).toBe(value),
  );

  it.each([
    "latest",
    "olha kovalenko",
    "Олена",
    "v1",
    `1.0.0-${CARD}`,
    `1.0.0-build.${CARD}`,
    `1.0.0-${"rc.".repeat(22)}1`, // over 64 characters
  ])("version %j is dropped", (value) => expect(redactVersion(value)).toBeUndefined());
});
