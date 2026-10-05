/** Service-order amounts are quotes, not receipts, but still feed the console services band. */
import { createProvider } from './config.js';

const provider = createProvider('finance');

/* Overview and series come from the same provider so month boundaries agree across charts. */
export const getFinanceOverview = async () => (await provider()).getFinanceOverview();

export const getFinanceSeries = async (months) => (await provider()).getFinanceSeries(months);

/** This is the single most likely misreading of the table, which is why the column is labelled as the platform's take
 * on screen as well. */
export const listFinanceTransactions = async (opts) =>
  (await provider()).listFinanceTransactions(opts);
