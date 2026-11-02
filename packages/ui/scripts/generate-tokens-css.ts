/** Writes src/styles/tokens.css from the TypeScript tokens. Run: `node scripts/generate-tokens-css.ts`. */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildTokensCss } from "../src/tokens/css.ts";

const target = fileURLToPath(new URL("../src/styles/tokens.css", import.meta.url));
writeFileSync(target, buildTokensCss());
console.log(`tokens.css written (${target})`);
