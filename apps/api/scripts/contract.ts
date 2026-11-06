/**
 * The OpenAPI contract (ARC-07 FR 2–3):
 *
 *   node scripts/contract.ts --write                 write packages/api-contract/openapi.json from the routes
 *   node scripts/contract.ts --check                 fail when the committed contract differs from the routes
 *   node scripts/contract.ts --compat <base.json>    fail on an incompatible change against the base contract
 *                                                    (WS_CONTRACT_TODAY=YYYY-MM-DD overrides the date)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { apiRoutes } from "../src/api.ts";
import { buildOpenApi, serializeOpenApi } from "../src/platform/http/openapi.ts";
import { contractProblems } from "./lib/contract-compat.ts";

export const CONTRACT_PATH = fileURLToPath(
  new URL("../../../packages/api-contract/openapi.json", import.meta.url),
);

const args = process.argv.slice(2);
const generated = serializeOpenApi(buildOpenApi(apiRoutes));

if (args[0] === "--write") {
  writeFileSync(CONTRACT_PATH, generated);
  console.log("Wrote packages/api-contract/openapi.json");
} else if (args[0] === "--check") {
  const committed = existsSync(CONTRACT_PATH) ? readFileSync(CONTRACT_PATH, "utf8") : "";
  if (committed !== generated) {
    console.error(
      "packages/api-contract/openapi.json differs from the routes (ARC-07 criterion «розбіжність між контрактом і реалізацією — 0»). Run `pnpm contract:write` and commit the result.",
    );
    process.exit(1);
  }
  console.log("Contract: openapi.json matches the routes");
} else if (args[0] === "--compat" && args[1]) {
  if (!existsSync(args[1])) {
    console.log(`No base contract at ${args[1]} (first version of the contract); nothing to compare.`);
    process.exit(0);
  }
  const today = process.env["WS_CONTRACT_TODAY"] ?? new Date().toISOString().slice(0, 10);
  const problems = contractProblems(
    JSON.parse(readFileSync(args[1], "utf8")) as Record<string, unknown>,
    JSON.parse(generated) as Record<string, unknown>,
    { today },
  );
  if (problems.length > 0) {
    console.error(`Incompatible contract changes within /v1 (ARC-07 FR 3):\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log("Contract: compatible with the base branch");
} else {
  console.error("Usage: node scripts/contract.ts --write | --check | --compat <base openapi.json>");
  process.exit(2);
}
