// A parsing worker that never finishes (ARC-06@PoC row «Розбір в окремому процесі»): only the time limit ends it.
// Used only by run.test.ts.
let n = 0;
for (;;) n = (n + 1) % 1_000_003;
