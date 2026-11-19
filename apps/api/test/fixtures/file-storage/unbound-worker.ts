// A parse worker that answers without the binding's outcome (the security review of #630): the caller must refuse it.
import { parentPort } from "node:worker_threads";

parentPort!.postMessage({ value: { reading: {}, analysis: {}, events: { events: [] }, account: null } });
