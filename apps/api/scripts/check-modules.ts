/** CI gate for module boundaries (ARC-01): pnpm --filter @willowsum/api check:modules */
import { fileURLToPath } from "node:url";
import { checkModules } from "./lib/check.ts";

const apiDir = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const problems = await checkModules(apiDir, repoRoot);
if (problems.length > 0) {
  console.error(`Module rules violated (ARC-01):\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("Module rules: ok");
