// A parsing worker that misbehaves on purpose (ARC-06@PoC row «Розбір в окремому процесі»): it keeps allocating on
// its heap until the worker's memory limit ends it. Used only by run.test.ts.
const hoard: string[][] = [];
for (;;) hoard.push(Array.from({ length: 100_000 }, (_, i) => `row ${i} ${hoard.length}`));
