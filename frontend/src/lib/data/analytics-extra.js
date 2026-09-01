/* Analytics generators mirrored from the HTML app's admin-data.js so the
   React Analytics page reaches exact parity. These reproduce the deterministic
   traffic window series and the DB-derived funnel / deal-status / geography
   series that src/data/analytics.json does not precompute.

   This file is a barrel: the implementations live in ./analytics/*.js domain
   slices. Importers keep using the same named exports from this path. */
export { trafficSeries, funnel, statusLabel, dealStatus } from './analytics/traffic.js';
export { localities, supplyDemandGap } from './analytics/geography.js';
export { slaMetrics } from './analytics/sla.js';
export { computeSmartAlerts } from './analytics/smartAlerts.js';
export { dailyOpsScorecard } from './analytics/opsScorecard.js';
export { seasonalAnalytics } from './analytics/seasonal.js';
export { pricingInsight } from './analytics/pricing.js';