/**
 * Loaded with `node --import` into every process `pnpm local:dev` starts (scripts/local-dev.ts). Each child runs in
 * its own process group, so a signal to the terminal does not reach it; when the script that started it is gone
 * (killed, or its Terminal window closed before it could stop the children), the parent pid changes and the child
 * stops its own group (itself and, for Vite, esbuild) instead of running on without an owner (#363).
 *
 * The script passes its pid in WS_LOCAL_DEV_PARENT_PID: a parent that died while this process was still loading is
 * noticed too (its pid read here would already be the one of the process that adopted it).
 */
const given = Number(process.env["WS_LOCAL_DEV_PARENT_PID"]);
const parent = Number.isSafeInteger(given) && given > 1 ? given : process.ppid;

function stopOwnGroup(): void {
  try {
    process.kill(-process.pid, "SIGTERM");
  } catch {
    process.kill(process.pid, "SIGTERM");
  }
  // A process that ignores SIGTERM still ends.
  setTimeout(() => process.exit(1), 15_000).unref();
}

const timer = setInterval(() => {
  if (process.ppid === parent) return;
  clearInterval(timer);
  stopOwnGroup();
}, 500);
timer.unref();
