/**
 * Mock admin provider — wraps mockApi.js admin functions + analytics/finance
 */
import {
  getAnalytics as _getAnalytics,
  getAdminKpis as _getAdminKpis,
  getSettings as _getSettings,
  updateSettings as _updateSettings,
  logAudit as _logAudit,
  listAudit as _listAudit,
  clearAudit as _clearAudit,
} from '../../../lib/mockApi.js';

import {
  trafficSeries as _trafficSeries,
  funnel as _funnel,
  dealStatus as _dealStatus,
  localities as _localities,
} from '../../../lib/data/analytics-extra.js';

import {
  buildTransactions as _buildTransactions,
  buildRevenueSeries as _buildRevenueSeries,
} from '../../../lib/data/finance-admin.js';

// Already async
export const getAnalytics = _getAnalytics;
export const getAdminKpis = _getAdminKpis;
export const getSettings = _getSettings;
export const updateSettings = _updateSettings;

// Sync → async
export const logAudit = (action, detail) => Promise.resolve(_logAudit(action, detail));
export const listAudit = () => Promise.resolve(_listAudit());
export const clearAudit = () => Promise.resolve(_clearAudit());
export const trafficSeries = (days) => Promise.resolve(_trafficSeries(days));
export const funnel = () => Promise.resolve(_funnel());
export const dealStatusBreakdown = () => Promise.resolve(_dealStatus());
export const analyticsLocalities = () => Promise.resolve(_localities());
export const buildTransactions = () => Promise.resolve(_buildTransactions());
export const buildRevenueSeries = (months) => Promise.resolve(_buildRevenueSeries(months));
