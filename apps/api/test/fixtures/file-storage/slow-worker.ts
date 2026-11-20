// A parse worker that answers an empty value after 300 ms (#624: the limit of parse workers at a time). Used only by
// sec624-parse-concurrency.test.ts.
import { parentPort } from "node:worker_threads";

setTimeout(() => parentPort!.postMessage({ value: {} }), 300);
