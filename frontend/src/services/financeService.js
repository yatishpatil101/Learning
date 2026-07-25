/**
 * Finance Service — owner property finance tracking.
 */
import { createProvider } from './config.js';

const provider = createProvider('finance');

export const getBasis = (mobile, propId) => provider().getBasis(mobile, propId);
export const setBasis = (mobile, propId, data) => provider().setBasis(mobile, propId, data);
export const getTransactions = (mobile, propId) => provider().getTransactions(mobile, propId);
export const addTransaction = (mobile, propId, data) => provider().addTransaction(mobile, propId, data);
export const updateTransaction = (mobile, propId, txnId, patch) => provider().updateTransaction(mobile, propId, txnId, patch);
export const deleteTransaction = (mobile, propId, txnId) => provider().deleteTransaction(mobile, propId, txnId);
export const getLoan = (mobile, propId) => provider().getLoan(mobile, propId);
export const setLoan = (mobile, propId, data) => provider().setLoan(mobile, propId, data);
export const getTenant = (mobile, propId) => provider().getTenant(mobile, propId);
export const setTenant = (mobile, propId, data) => provider().setTenant(mobile, propId, data);
export const getBudgets = (mobile, propId) => provider().getBudgets(mobile, propId);
export const setBudgets = (mobile, propId, budgets) => provider().setBudgets(mobile, propId, budgets);
export const setBudget = (mobile, propId, category, amount) => provider().setBudget(mobile, propId, category, amount);
export const financeSummary = (mobile, propId, period) => provider().financeSummary(mobile, propId, period);
export const expenseBreakdown = (mobile, propId, period) => provider().expenseBreakdown(mobile, propId, period);
export const cashflowByMonth = (mobile, propId, months) => provider().cashflowByMonth(mobile, propId, months);
export const getDues = (mobile, propId) => provider().getDues(mobile, propId);
export const exportTransactionsCSV = (mobile, propId) => provider().exportTransactionsCSV(mobile, propId);
export const exportStatementPDF = (mobile, propId, title) => provider().exportStatementPDF(mobile, propId, title);
