import { attributesRoutes } from "./attributes.ts";
import { transactionsRoutes as recordRoutes } from "./routes.ts";

export const transactionsRoutes = [...recordRoutes, ...attributesRoutes];
export { createTransactionsServices, transactionAudit, type TransactionsServices } from "./services.ts";
