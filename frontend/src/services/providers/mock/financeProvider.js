/**
 * Mock finance provider — wraps data/finances.js
 */
import {
  getBasis as _getBasis,
  setBasis as _setBasis,
  getTransactions as _getTransactions,
  addTransaction as _addTransaction,
  updateTransaction as _updateTransaction,
  deleteTransaction as _deleteTransaction,
  getLoan as _getLoan,
  setLoan as _setLoan,
  getTenant as _getTenant,
  setTenant as _setTenant,
  getBudgets as _getBudgets,
  setBudgets as _setBudgets,
  setBudget as _setBudget,
  financeSummary as _financeSummary,
  expenseBreakdown as _expenseBreakdown,
  cashflowByMonth as _cashflowByMonth,
  getDues as _getDues,
  exportTransactionsCSV as _exportTransactionsCSV,
  exportStatementPDF as _exportStatementPDF,
} from '../../../lib/data/finances.js';

export const getBasis = (mobile, propId) => Promise.resolve(_getBasis(mobile, propId));
export const setBasis = (mobile, propId, data) => Promise.resolve(_setBasis(mobile, propId, data));
export const getTransactions = (mobile, propId) => Promise.resolve(_getTransactions(mobile, propId));
export const addTransaction = (mobile, propId, data) => Promise.resolve(_addTransaction(mobile, propId, data));
export const updateTransaction = (mobile, propId, txnId, patch) => Promise.resolve(_updateTransaction(mobile, propId, txnId, patch));
export const deleteTransaction = (mobile, propId, txnId) => Promise.resolve(_deleteTransaction(mobile, propId, txnId));
export const getLoan = (mobile, propId) => Promise.resolve(_getLoan(mobile, propId));
export const setLoan = (mobile, propId, data) => Promise.resolve(_setLoan(mobile, propId, data));
export const getTenant = (mobile, propId) => Promise.resolve(_getTenant(mobile, propId));
export const setTenant = (mobile, propId, data) => Promise.resolve(_setTenant(mobile, propId, data));
export const getBudgets = (mobile, propId) => Promise.resolve(_getBudgets(mobile, propId));
export const setBudgets = (mobile, propId, budgets) => Promise.resolve(_setBudgets(mobile, propId, budgets));
export const setBudget = (mobile, propId, category, amount) => Promise.resolve(_setBudget(mobile, propId, category, amount));
export const financeSummary = (mobile, propId, period) => Promise.resolve(_financeSummary(mobile, propId, period));
export const expenseBreakdown = (mobile, propId, period) => Promise.resolve(_expenseBreakdown(mobile, propId, period));
export const cashflowByMonth = (mobile, propId, months) => Promise.resolve(_cashflowByMonth(mobile, propId, months));
export const getDues = (mobile, propId) => Promise.resolve(_getDues(mobile, propId));
export const exportTransactionsCSV = (mobile, propId) => Promise.resolve(_exportTransactionsCSV(mobile, propId));
export const exportStatementPDF = (mobile, propId, title) => Promise.resolve(_exportStatementPDF(mobile, propId, title));
