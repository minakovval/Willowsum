// A worker for the runner's tests: what it does is chosen by `workerData.mode`.
import { parentPort, workerData } from "node:worker_threads";

const { mode } = workerData as { mode: "env" | "print" | "heap" };
if (mode === "env") parentPort!.postMessage({ value: Object.keys(process.env) });
if (mode === "print") {
  console.log("sec619-marker-out");
  console.error("sec619-marker-err");
  setTimeout(() => parentPort!.postMessage({ value: "printed" }), 200);
}
if (mode === "heap") {
  // About 200 MiB of heap, kept alive: over a 64 MiB limit, far under the default one.
  const kept: number[][] = [];
  for (let i = 0; i < 250; i++) kept.push(Array.from({ length: 100_000 }, (_, j) => i + j + 0.5));
  parentPort!.postMessage({ value: kept.length });
}
