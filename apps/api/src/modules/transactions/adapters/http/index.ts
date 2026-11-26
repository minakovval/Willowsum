import { attributesRoutes } from "./attributes.ts";
import { historyRoutes } from "./history.ts";
import { reviewRoutes } from "./review.ts";
import { transactionsRoutes as recordRoutes } from "./routes.ts";

export const transactionsRoutes = [...recordRoutes, ...attributesRoutes, ...reviewRoutes, ...historyRoutes];
export {
  createTransactionsServices,
  transactionAudit,
  type CategoryTransactions,
  type TransactionsServices,
} from "./services.ts";
