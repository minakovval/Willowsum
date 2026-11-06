import { z } from "zod";
import { alphaLoop } from "../adapters/loop.ts";
export const helper = z.string();
export const unused = alphaLoop;
