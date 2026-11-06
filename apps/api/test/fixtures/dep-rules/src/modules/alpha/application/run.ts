import { save } from "../adapters/store.ts";
import { helper } from "../../beta/domain/helper.ts";
import { betaApi } from "../../beta/index.ts";
import { gammaApi } from "../../gamma/index.ts";
export const run = (): unknown => [save, helper, betaApi, gammaApi];
