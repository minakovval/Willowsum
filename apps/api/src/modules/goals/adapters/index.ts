// Adapters of goals: database (ModuleDatabase, schema «goals»), HTTP, the job queue.
export { eraseHouseholdGoals } from "./db/erasure.ts";
export { goalsTx } from "./db/store.ts";
export { goalsRoutes } from "./http/routes.ts";
export { createGoalsServices, goalsAudit, type GoalsServices } from "./http/services.ts";
export { goalsWorkerQueue, requeueDeadHandOffs } from "./queue/hand-off.ts";
export { ENTRY_RECORDED_JOB, HAND_OFF_JOB, SPEND_CHECK_JOB } from "./queue/job.ts";
