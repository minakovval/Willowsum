import { attributesRoutes } from "./attributes.ts";
import { reviewRoutes } from "./review.ts";
import { transactionsRoutes as recordRoutes } from "./routes.ts";

export const transactionsRoutes = [...recordRoutes, ...attributesRoutes, ...reviewRoutes];
export { createTransactionsServices, transactionAudit, type TransactionsServices } from "./services.ts";
