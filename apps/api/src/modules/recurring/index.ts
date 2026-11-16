// Public interface of the recurring module (ARC-01 FR 2). Other modules import only this file.
import { defineModule } from "../../platform/modules/define.ts";
import { recurringRoutes } from "./adapters/index.ts";

export const recurringModule = defineModule({
  name: "recurring",
  publishes: [],
  consumes: [],
  routes: recurringRoutes,
});

export { createRecurringServices, type RecurringServices } from "./adapters/index.ts";
export { HISTORY_DAYS } from "./application/index.ts";
export { detectSeries, FREQUENCIES, nextDate, scheduleDate } from "./domain/index.ts";
export type { Charge, Frequency, Series } from "./domain/index.ts";
