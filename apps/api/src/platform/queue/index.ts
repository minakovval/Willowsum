// The job queue and outbox of the platform (ARC-04). Modules use publishEvent, enqueueJob, defineJob and their
// handlers; the worker role wires the stores, handlers and event subscriptions (src/wiring.ts).
export {
  DEFAULT_LEASE_MS,
  MAX_ATTEMPTS,
  RETRY_BASE_MS,
  RETRY_MAX_MS,
  defineJob,
  defineJobHandler,
  retryDelayMs,
  type JobContext,
  type JobDefinition,
  type JobHandler,
} from "./define.ts";
export { QUEUE_TABLES_SQL, enqueueJob, publishEvent } from "./outbox.ts";
export {
  LEASE_EXPIRED,
  LeaseLostError,
  postgresJobStore,
  type ClaimedJob,
  type JobStore,
  type PurgeCutoffs,
} from "./store.ts";
export { QUEUE_RETENTION_DAYS, purgeQueues, type QueueRetentionDeps } from "./retention.ts";
export {
  DEFAULT_CONCURRENCY,
  DEFAULT_HEAVY_LIMIT,
  DEFAULT_POLL_MS,
  createWorker,
  type EventSubscription,
  type Worker,
  type WorkerOptions,
  type WorkerQueue,
} from "./worker.ts";
