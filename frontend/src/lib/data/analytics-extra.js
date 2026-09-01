/* Analytics generators mirrored from the HTML app's admin-data.js so the
   React Analytics page reaches exact parity. These reproduce the deterministic
   traffic window series and the DB-derived funnel / deal-status / geography
   series that src/data/analytics.json does not precompute.

   This file is a barrel: the implementations live in ./analytics/*.js domain
   slices. Importers keep using the same named exports from this path.

   Three slices are gone — `analytics/sla.js`, `analytics/pricing.js` and
   `analytics/seasonal.js`. The Analytics page's SLA and Pricing tabs are served
   entirely by the API now, and the Seasonal tab is deleted rather than kept as
   a generated stand-in for history nothing has collected yet. Nothing here
   feeds `pages/admin/AdminAnalytics.jsx` any longer; what remains backs the
   dashboard and the mock demand provider. */
export { trafficSeries, funnel, statusLabel, dealStatus } from './analytics/traffic.js';
export { localities, supplyDemandGap } from './analytics/geography.js';
export { computeSmartAlerts } from './analytics/smartAlerts.js';
export { dailyOpsScorecard } from './analytics/opsScorecard.js';