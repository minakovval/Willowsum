import { readFileSync } from "node:fs";
import { Money } from "@willowsum/domain-kernel";
import { save } from "../adapters/store.ts";
export const total = (): unknown => [Money, readFileSync, save];
