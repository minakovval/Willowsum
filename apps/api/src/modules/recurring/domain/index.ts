// Domain layer of recurring: pure rules, no I/O (ARC-01 FR 5). Allowed imports: this folder,
// @willowsum/domain-kernel, zod, decimal.js.
export {
  detectSeries,
  FIXED_TOLERANCE,
  VARIABLE_AVERAGE_OF,
  VARIABLE_RATIO,
  withinTolerance,
  withinVariableRatio,
  type Charge,
  type Series,
} from "./detect.ts";
export {
  addDays,
  daysBetween,
  FREQUENCIES,
  FREQUENCY_RULES,
  intervalFits,
  nextDate,
  scheduleDate,
  type Frequency,
} from "./schedule.ts";
