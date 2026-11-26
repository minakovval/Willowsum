// #363 (follow-up of PR #351): `pnpm local:dev` on a Mac beside other tools — free ports, a busy check that sees a
// program on 127.0.0.1 or ::1 only, every child stopped when the window closes or the script is killed, leftovers
// of an earlier run cleaned only when they are really ours, and a wait for the cluster lock that says who holds it.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:net";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PARENT_ENTRY,
  WEB_PORT,
  cleanLeftovers,
  isPortFree,
  lastLines,
  localDevSettings,
  lockHolderMessage,
  parsePidsFile,
  pickRolePorts,
  processIdentity,
  readinessTimeoutMessage,
  type PidEntry,
  type ProcessControl,
} from "./local-dev.ts";

const parentWatch = fileURLToPath(new URL("./parent-watch.ts", import.meta.url));

async function listenOn(host: string, port = 0): Promise<{ server: Server; port: number } | undefined> {
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen({ host, port, exclusive: true }, resolve);
    });
  } catch {
    return undefined; // e.g. no IPv6 on this machine
  }
  return { server, port: (server.address() as { port: number }).port };
}
const close = (server: Server) => new Promise((resolve) => server.close(resolve));

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function gone(pid: number, ms: number): Promise<boolean> {
  for (let waited = 0; waited < ms; waited += 100) {
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return !alive(pid);
}

describe("#363 item 2: the busy check sees a program on one loopback address only", () => {
  it("a program listening only on 127.0.0.1:<port> makes the port not free", async () => {
    const busy = await listenOn("127.0.0.1");
    expect(busy).toBeDefined();
    expect(await isPortFree(busy!.port)).toBe(false);
    await close(busy!.server);
    expect(await isPortFree(busy!.port)).toBe(true);
  });

  it("a program listening only on ::1 makes the port not free (where the machine has IPv6)", async () => {
    const busy = await listenOn("::1");
    if (!busy) return; // no IPv6 loopback here: nothing can listen there
    expect(await isPortFree(busy.port)).toBe(false);
    await close(busy.server);
  });

  it("a program listening on every address makes the port not free", async () => {
    const busy = await listenOn("0.0.0.0");
    expect(await isPortFree(busy!.port)).toBe(false);
    await close(busy!.server);
  });
});

describe("#363 item 1: the role ports are picked free on every start", () => {
  it("three distinct ports, never the web port or a busy one", async () => {
    const offered = [WEB_PORT, 8082, 41001, 41001, 41002, 41003];
    const ports = await pickRolePorts(
      WEB_PORT,
      async (port) => port !== 8082,
      async () => offered.shift()!,
    );
    expect(ports).toEqual({ api: 41001, worker: 41002, scheduler: 41003 });
  });

  it("really free on this machine, even with a foreign server on 127.0.0.1", async () => {
    const foreign = await listenOn("127.0.0.1");
    const ports = await pickRolePorts();
    expect(new Set(Object.values(ports)).size).toBe(3);
    for (const port of Object.values(ports)) {
      expect(port).not.toBe(foreign!.port);
      expect(await isPortFree(port)).toBe(true);
    }
    await close(foreign!.server);
  });

  it("gives up with a plain message when nothing is free", async () => {
    await expect(
      pickRolePorts(
        WEB_PORT,
        async () => false,
        async () => 41000,
      ),
    ).rejects.toThrow(/не вдалося знайти вільний порт/);
  });
});

describe("#363 item 3: a child stops when the script that started it is gone", () => {
  it("killing the parent (SIGKILL, no handler runs) leaves no child behind", async () => {
    // The parent starts one child the way local-dev.ts does (own process group, parent-watch loaded), prints its pid.
    const parentCode = `
      const { spawn } = require("node:child_process");
      const c = spawn(process.execPath, ["--import", ${JSON.stringify(parentWatch)}, "-e", "setInterval(() => {}, 1000)"],
        { stdio: "ignore", detached: true,
          env: { ...process.env, WS_LOCAL_DEV_PARENT_PID: String(process.pid) } });
      console.log(c.pid);
      setInterval(() => {}, 1000);`;
    const parent = spawn(process.execPath, ["-e", parentCode], { stdio: ["ignore", "pipe", "inherit"] });
    const [chunk] = (await once(parent.stdout!, "data")) as [Buffer];
    const child = Number(chunk.toString().trim());
    expect(alive(child)).toBe(true);
    parent.kill("SIGKILL");
    expect(await gone(child, 10_000)).toBe(true);
  }, 20_000);

  it("a child whose parent stays keeps running", async () => {
    const child = spawn(process.execPath, ["--import", parentWatch, "-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
      detached: true,
    });
    await new Promise((r) => setTimeout(r, 1_500));
    expect(alive(child.pid!)).toBe(true);
    process.kill(-child.pid!, "SIGTERM");
    expect(await gone(child.pid!, 5_000)).toBe(true);
  }, 10_000);
});

describe("#363 item 4: leftovers of an earlier run are stopped only when they are really ours", () => {
  it("reads only well-formed entries of pids.json", () => {
    expect(parsePidsFile("not json")).toEqual([]);
    expect(parsePidsFile('{"pid": 5}')).toEqual([]);
    expect(
      parsePidsFile(
        JSON.stringify([
          { name: "api", pid: 4242, identity: "Mon Nov 16 10:00:00 2026 node main.ts --role api" },
          { name: "worker", pid: 1, identity: "init" },
          { name: "web", pid: "7", identity: "x" },
          { name: "scheduler", pid: 4243, identity: "  " },
        ]),
      ),
    ).toEqual([{ name: "api", pid: 4242, identity: "Mon Nov 16 10:00:00 2026 node main.ts --role api" }]);
  });

  function fakeControl(identities: Map<number, string>) {
    const signals: string[] = [];
    const control: ProcessControl = {
      identityOf: (pid) => identities.get(pid),
      kill: (target, signal) => {
        signals.push(`${target} ${signal}`);
        identities.delete(Math.abs(target));
      },
      sleep: async () => {},
      log: () => {},
    };
    return { control, signals };
  }

  it("a pid now used by a foreign program (other start time or command line) is never signalled", async () => {
    const identities = new Map([
      [5001, "Mon Nov 16 11:00:00 2026 /usr/bin/ssh -fN colima"],
      [5002, "Mon Nov 16 10:00:01 2026 node /repo/apps/api/src/main.ts --role api"],
    ]);
    const { control, signals } = fakeControl(identities);
    const stopped = await cleanLeftovers(
      [
        {
          name: "scheduler",
          pid: 5001,
          identity: "Mon Nov 16 10:00:02 2026 node /repo/apps/api/src/main.ts --role scheduler",
        },
        {
          name: "api",
          pid: 5002,
          identity: "Mon Nov 16 10:00:00 2026 node /repo/apps/api/src/main.ts --role api",
        },
        {
          name: "worker",
          pid: 5003,
          identity: "Mon Nov 16 10:00:01 2026 node /repo/apps/api/src/main.ts --role worker",
        },
      ],
      control,
    );
    expect(stopped).toEqual([]);
    expect(signals).toEqual([]);
  });

  it("the earlier script first (it releases the cluster lock), then each child's process group", async () => {
    const entries: PidEntry[] = [
      { name: PARENT_ENTRY, pid: 6000, identity: "t0 node /repo/apps/api/scripts/local-dev.ts" },
      { name: "api", pid: 6001, identity: "t1 node /repo/apps/api/src/main.ts --role api" },
      { name: "web", pid: 6004, identity: "t4 node /repo/node_modules/vite/bin/vite.js --port 5173" },
    ];
    const identities = new Map(entries.map((e) => [e.pid, e.identity]));
    const { control, signals } = fakeControl(identities);
    expect((await cleanLeftovers(entries, control)).map((e) => e.pid)).toEqual([6000, 6001, 6004]);
    expect(signals).toEqual(["6000 SIGTERM", "-6001 SIGTERM", "-6004 SIGTERM"]);
  });

  it("a process that does not stop in time gets SIGKILL", async () => {
    const entry: PidEntry = { name: "api", pid: 6101, identity: "t node main.ts --role api" };
    const signals: string[] = [];
    const control: ProcessControl = {
      identityOf: () => entry.identity, // ignores SIGTERM
      kill: (target, signal) => void signals.push(`${target} ${signal}`),
      sleep: async () => {},
      log: () => {},
    };
    await cleanLeftovers([entry], control, 1_000);
    expect(signals).toEqual(["-6101 SIGTERM", "-6101 SIGKILL"]);
  });

  it("on this machine: stops a real leftover of ours and leaves a live foreign process alone", async () => {
    const start = () =>
      spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", detached: true });
    const ours = start();
    const foreign = start();
    const identity = processIdentity(ours.pid!);
    expect(identity).toContain(process.execPath);
    expect(processIdentity(foreign.pid!)).toBeDefined();
    const stopped = await cleanLeftovers(
      [
        { name: "api", pid: ours.pid!, identity: identity! },
        // The foreign process got a pid that pids.json still lists, with the command line of our old child.
        { name: "worker", pid: foreign.pid!, identity: identity!.replace(/^\S+ \S+ \d+/, "Sun Jan  1") },
      ],
      {
        ...{
          identityOf: processIdentity,
          sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
          log: () => {},
        },
        kill: (target, signal) => {
          try {
            process.kill(target, signal);
          } catch {
            // gone
          }
        },
      },
      5_000,
    );
    expect(stopped.map((e) => e.pid)).toEqual([ours.pid]);
    expect(await gone(ours.pid!, 5_000)).toBe(true);
    expect(alive(foreign.pid!)).toBe(true);
    process.kill(-foreign.pid!, "SIGKILL");
  }, 15_000);
});

describe("#363 item 5: waiting for the cluster lock says who holds it and what to do", () => {
  it("another pnpm local:dev in the next window: close it", () => {
    expect(lockHolderMessage({ pid: 812, applicationName: "ws-local-dev 4321" })).toMatch(
      /інший `pnpm local:dev` \(pid 4321\) у сусідньому вікні — закрийте його/,
    );
  });

  it("integration tests: they run, this run continues by itself", () => {
    for (const applicationName of ["ws-integration-lock", "psql"])
      expect(lockHolderMessage({ pid: 813, applicationName })).toMatch(
        /йдуть інтеграційні тести .*pid сервера 813/,
      );
  });

  it("any other session is named (only safe characters) with its pid", () => {
    const message = lockHolderMessage({ pid: 814, applicationName: "my\u001b[2Jtool" });
    expect(message).toMatch(/сеансом «my2Jtool» \(pid сервера 814\)/);
  });
});

describe("#363: a readiness timeout says why", () => {
  it("names the reason of /health/ready and the end of the role's log", () => {
    const message = readinessTimeoutMessage({
      name: "scheduler",
      seconds: 60,
      url: "http://127.0.0.1:41003/health/ready",
      answer: { status: 503, body: '{"status":"not-ready","reason":"database-unreachable"}' },
      log: "infra/local/.state/dev/scheduler.log",
      logTail: lastLines(`${Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n")}\n\n`),
    });
    expect(message).toMatch(
      /^scheduler не став готовим за 60 с\. .*HTTP 503, причина «database-unreachable»/,
    );
    expect(message).toContain("Останні рядки infra/local/.state/dev/scheduler.log:\nline 10\n");
    expect(message).not.toContain("line 9\n");
    expect(message.endsWith("line 29")).toBe(true);
  });

  it("an answer that is not ours (another program on the port) and no answer at all", () => {
    const base = { name: "api", seconds: 60, url: "http://127.0.0.1:1/health/ready", log: "api.log" };
    expect(
      readinessTimeoutMessage({ ...base, answer: { status: 404, body: "<html>" }, logTail: "x" }),
    ).toMatch(/HTTP 404\.\n/);
    expect(readinessTimeoutMessage({ ...base, answer: undefined, logTail: "" })).toMatch(
      /жодного разу не відповів\.\nЖурнал api\.log порожній\./,
    );
  });
});

describe("#363: settings a person never sets (only the integration test of the script)", () => {
  it("defaults: ws_dev, the repository's state directory, web port 5173", () => {
    expect(localDevSettings({}, "/repo/infra/local/.state/dev", "/home/o/.config/willowsum/k.json")).toEqual({
      database: "ws_dev",
      stateDir: "/repo/infra/local/.state/dev",
      webPort: 5173,
      kmsKeyFile: "/home/o/.config/willowsum/k.json",
    });
  });

  it("accepts only a test database name, an absolute directory and an unprivileged port", () => {
    expect(
      localDevSettings(
        {
          WS_LOCAL_DEV_DATABASE: "ws_t_ld_0a1b2c3d",
          WS_LOCAL_DEV_STATE_DIR: "/tmp/x",
          WS_LOCAL_DEV_WEB_PORT: "41005",
        },
        "/d",
      ),
    ).toMatchObject({ database: "ws_t_ld_0a1b2c3d", stateDir: "/tmp/x", webPort: 41005 });
    expect(() => localDevSettings({ WS_LOCAL_DEV_DATABASE: "willowsum" }, "/d")).toThrow(/ws_t_/);
    expect(() => localDevSettings({ WS_LOCAL_DEV_DATABASE: "ws_t_x; DROP" }, "/d")).toThrow();
    expect(() => localDevSettings({ WS_LOCAL_DEV_STATE_DIR: "rel" }, "/d")).toThrow(/absolute/);
    expect(() => localDevSettings({ WS_LOCAL_DEV_WEB_PORT: "80" }, "/d")).toThrow(/1024/);
  });
});
