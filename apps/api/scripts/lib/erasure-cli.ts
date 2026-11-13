/** A command of scripts/erasure.ts (NFR-12@PoC FR 3, NFR-16@PoC FR 9; ADR-0013). */
export type ErasureCommand =
  | {
      readonly kind: "request";
      /** `--email` takes no value on the command line: the address is read from stdin (not in `ps` or shell history). */
      readonly subject: { readonly emailFromStdin: true } | { readonly accountId: string };
    }
  | { readonly kind: "run"; readonly requestId: string }
  | { readonly kind: "status" }
  | { readonly kind: "reapply" };

export const ERASURE_USAGE = `Usage: node scripts/erasure.ts <command>
  request --email | --account <uuid>   record a person's request (30-day deadline);
                                       with --email the address is read from stdin
  run <request uuid>                   erase the account and all its data (key last)
  status                               every request, its deadline and days left
  reapply                              after a restore: apply every completed erasure again
Needs the processes' configuration (WS_DB_*, module passwords), DATABASE_URL (the migration role: it lets the
erasure roles log in for this run only) and the erasure log (WS_ERASURE_LOG_DIR locally).`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function parseErasureCommand(argv: readonly string[]): ErasureCommand {
  const [command, ...rest] = argv;
  switch (command) {
    case "request":
      if (rest.length === 1 && rest[0] === "--email")
        return { kind: "request", subject: { emailFromStdin: true } };
      if (rest.length === 2 && rest[0] === "--account") {
        if (!UUID_RE.test(rest[1]!)) throw new Error("request: --account takes a uuid");
        return { kind: "request", subject: { accountId: rest[1]! } };
      }
      throw new Error("request: --email (the address on stdin) | --account <uuid>");
    case "run":
      if (rest.length !== 1 || !UUID_RE.test(rest[0]!)) throw new Error("run: <request uuid>");
      return { kind: "run", requestId: rest[0]! };
    case "status":
    case "reapply":
      if (rest.length !== 0) throw new Error(`${command}: no arguments`);
      return { kind: command };
    default:
      throw new Error("Unknown command");
  }
}
