# Flow: Admin Analytics

> The insight console: 8 analytics tabs (Traffic, Engagement, Anonymous surfers, Geography,
> Supply Gap, Pricing, SLA, Seasonal) plus the Dashboard KPI tiles - each chart/KPI derived
> deterministically from the mock DB or a seeded RNG, with a traffic time-window selector.
> **Status:** documented from React source - **Primary role(s):** admin (with the Analytics module)

---

## 1. Purpose & user problem
- **Persona:** a growth / operations lead who needs to see demand, supply, pricing, funnel and SLA health at a glance.
- **Job-to-be-done:** "Show me traffic and conversion, where demand outruns supply, whether listings are
  mispriced, how the ops team is doing against SLA, and how Pune's seasons will move the market."
- **Why it matters:** this is the decision layer above every operational flow - it tells ops where to source
  supply, which localities to prioritise, and whether SLAs (feeding [`services-moderation.md`](./services-moderation.md)
  and property verification) are being met. The funnel here complements [`enquiries-funnel.md`](./enquiries-funnel.md).

## 2. Entry points
- **Routes:** `/admin/analytics?tab=<key>` (default `traffic`). Tab keys: `traffic`, `engagement`, `surfers`,
  `geography`, `supply-gap`, `pricing`, `sla`, `seasonal`. The Dashboard (`/admin`) surfaces KPI tiles + Smart
  Alerts / SLA / Ops Scorecard panels that link into these tabs (e.g. `?tab=supply-gap`).
- **Tiles / triggers:** a traffic-window `Select` (30/90/180 days), per-tab KPI cards, charts, and drill tables;
  CSV export on the Traffic tab.
- **Source components:**
  - `src/pages/admin/AdminAnalytics.jsx` - tab shell, window state, per-tab flag gating.
  - `src/pages/admin/analytics/*.jsx` - the 8 tab views + `constants.jsx` (palette, axes, `Card`).
  - `src/lib/data/analytics-extra.js` (barrel) -> `analytics/*.js` slices (all real aggregation logic).
  - Dashboard: `src/pages/admin/AdminDashboard.jsx` + `dashboard/*Panel.jsx`.

## 3. Actors & roles
- **Operator = admin** with the `analytics` module (atom `dashboard:read`, `flagKey: 'analytics'`). Each tab is gated by an
  `analytics.<key>` admin option flag (`analytics.traffic|engagement|anonymous|geography|supplyGap|pricing|sla|seasonal`,
  all seed `true`); a disabled tab is removed and its data generator is skipped.
- Dashboard panels are gated by `dash.smartAlerts|sla|scorecard|glanceRevenue|glanceTraffic`.
- Guards are UX-only mock RBAC ([`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 1).

## 4. Entities touched
- **Read only** (no writes; analytics is pure aggregation): [`listings`](../../system/data-model.md),
  [`enquiries`](../../system/data-model.md), [`visits`](../../system/data-model.md),
  [`deals`](../../system/data-model.md), [`tickets`](../../system/data-model.md),
  [`users`](../../system/data-model.md), [`localities`](../../system/data-model.md),
  `analytics.sources`, and runtime signals (`searchIntents`, `propertyViews`, `demandAlerts`, `demandPosts`,
  `staffActivity`) plus localStorage (dismissed alerts).
- [`city_waitlist`](../../system/data-model.md) — read **aggregated only**, through
  `GET /admin/cities/waitlist`. The rows carry contact details; the endpoint groups them away in SQL
  and returns counts, so this tab never holds a mobile or an email.
- `analytics.traffic` / `analytics.revenue` seed rows feed Dashboard tiles.

## 5. Business rules & logic  *(the meat)*
All generators live in `src/lib/data/analytics/*.js` and are deterministic: a linear-congruential
`rng(seed)` (`s = (s*1664525 + 1013904223) >>> 0; s/2^32`) and date helpers (`iso`, `daysAgo`) from `internals.js`.
Fixed seeds keep every chart stable across renders.

### 5.1 Traffic tab (`trafficSeries(days)`, seed 424242)
Per day for the last `days` (30/90/180): `base = 1400 + (days - i) * 14`; weekend factor `wknd = 0.8` on Sat/Sun else 1.
- `visits    = round((base + rng()*600) * wknd)`
- `pageviews = round((base*3.4 + rng()*1800) * wknd)`
- `signups   = round((18 + rng()*26) * wknd)`
Charts: Visits & page views line; Traffic sources doughnut (from `analytics.sources`); Device split
(sample 64/30/6) and New vs returning (sample) marked "Sample". CSV export = `[Date, Visits, Page views, Signups]`.

### 5.2 Engagement tab (all "Sample")
Static illustrative series over `WK12`: avg session minutes `3.2..4.5`, bounce `48..37%`, top-pages index bar
(Home 100 down to Post property 22). No DB derivation - labelled Sample.

### 5.3 Anonymous surfers tab (`anonymousSurfers(days, traffic)`, seed 987654)
- `totalVisits = sum(visits)`, `totalSignups = sum(signups)` over the (shared) traffic series.
- `signedInSessions = min(totalSignups * 12, totalVisits)` (assume each signup visits ~12x); `anonSessions = totalVisits - signedInSessions`.
- **KPIs:** `anonPct = round(anonSessions/totalVisits*100)`; `conversionRate = (totalSignups/totalVisits*100).toFixed(1)`;
  Anonymous visits = `anonSessions`; Signups in period = `totalSignups`.
- `anonPages`: 8 pages, `views = round(anonSessions * factor)` (Home 0.92 ... Flatmates 0.09) with per-page `signupRate`.
- Weekly split (8 buckets): `signedIn = min(wSignups * (11 + rng()*3), wVisits)`, `anon = wVisits - signedIn`.
- `dropOff`: fixed exit-point percentages (contact wall 34%, etc.).

### 5.4 Geography tab (`localities()` = `db.localities`)
Three bars straight off locality records: Listings by locality (`l.listings`), Demand index (`l.demand`),
Avg rate `l.ratePerSqft`. No transformation beyond mapping.

### 5.5 Supply Gap tab (`supplyDemandGap()`)
Per-locality supply vs weighted demand, sorted by `gap` desc:
- `supply` = approved, non-archived listings per locality (`supplyMap`), fallback `loc.listings`.
- Weighted **demand** accumulation into `demandMap`:
  - each enquiry (+1, locality parsed from listing title `split(' in ')` last segment),
  - each search intent in last 30 days (+1, also counted in `searchMap`),
  - each property view in last 30 days (+0.5, also `viewMap`),
  - each demand alert (+2, also `alertMap`), each demand post (+3).
  - `demand = round(demandMap[name] || loc.demand * 0.4)`.
- **Hot demand:** users who searched the same locality `>= 3` times in the last 7 days (`userLocCount` keyed `userId|locality`), counted per locality.
- `gap = demand - supply`. Row also carries `searches`, `views`, `alerts`, `hot`, `ratePerSqft`, `avgRent`.
- **Tab KPIs:** Under-served (`gap>0`), Well-served (`gap<=0`), Total demand (sum), Total supply (sum),
  Property views 30d (sum `views`), Hot demand users (sum `hot`). Priority chip: High if `gap>=5 || hot>=2`, Medium if `gap>0`, else OK.
- **Demand Alerts by locality** (`alertsByLocality()`): groups `demandAlerts` by locality -> `{count, lastAt, rent, buy, topType}`, sorted by count.
- **City Expansion Requests** (`GET /admin/cities/waitlist` via `cityService.listCityWaitlist()`):
  where people want PuneNest to launch **next** — a different question from the rest of this tab,
  which compares supply and demand *inside* a city already served. Rows are
  `{ city, requests, lastRequestedAt }`, grouped in SQL by `lower(city)` and ordered by `requests`
  desc then recency; displayed spelling is `min(city)`, a real one somebody typed. The panel is
  **counts-only by design** — `city_waitlist` holds unverified public mobiles and emails, and the
  aggregation happens in the database so no contact detail reaches the JVM, let alone this screen.
  There is no `?days=` window: wanting a city does not decay.
  It previously aggregated a `pnCityRequests` array in localStorage, so it showed the reading
  operator only the asks made from *their own* browser — always none on a fresh profile, while
  `POST /cities/waitlist` had been recording the real ones all along.
  The waitlist is held as `null`-until-loaded rather than `[]`: a failed read renders
  "Couldn't load city requests", never "No city requests yet", because the second sentence would
  close the expansion queue on the strength of an outage. `cityProvider.listCityWaitlist` **throws**
  on a non-array 200 for the same reason — coercing to `[]` there would resolve the promise and
  defeat the distinction from below. The failed state carries a **Try again** button wired to an
  attempt counter in the effect's deps: nothing else on this tab re-runs the read, so without it
  the panel would warn against misreading the outage and then offer no way to resolve it.

### 5.6 Pricing tab (`pricingInsight()`)
- **Per-locality (`locStats`):** `avgActualRate` = mean of `round(price/area)` over approved **buy** listings
  (fallback `loc.ratePerSqft`); **rental yield** = mean of `((rent*12)/(area*ratePerSqft))*100` over rent listings
  (fallback `((avgRent*12)/(ratePerSqft*1000))*100`), 1-dp; plus `marketRate`, `avgRent`, buy/rent counts, `demand`.
- **Per-listing (`pricePositions`):** `marketPrice` = buy: `area*ratePerSqft`; rent: `avgRent*(bhkNum||2)*0.5`.
  `deviation = round((price - marketPrice)/marketPrice*100)`; label = `overpriced` (>15), `underpriced` (<-15), else `fair`. Null marketPrice guarded out.
- **priceTrends:** top-8 localities, 6-month deterministic (seed 777777): `rate = round(base * (1 + i*0.008 + (rng()*0.02 - 0.005)))`.
- **Summary KPIs:** totalAnalysed, overpriced/underpriced/fair counts, `avgYield` (mean of locStats yields), highest/lowest `marketRate`.
- Tables: listing price position (sorted by |deviation|, top 20) and locality breakdown (opportunity chip:
  High if `demand>=85 && totalListings<=2`, Moderate if `demand>=75`, else Stable).

### 5.7 SLA tab (`slaMetrics()`, seed 314159)
Targets (hours): `listingApproval 24`, `servicePickup 4`, `serviceDelivery 72`, `conciergeToLive 168`.
Four categories, each simulating a time and a per-item `breached = time > target`:
- **Listing approval:** reviewed listings get `hoursToApprove = round((2 + rng()*30)*10)/10`; pending listings get real
  `hoursWaiting = round((now-createdAt)/3600000)`, `breaching` if `> 24`. `avgApprovalTime` = mean; `approvalSlaRate =
  round((n - breaches)/n*100)` (100 when none); `currentlyBreaching` = pending over 24h.
- **Service pickup:** assigned tickets get `hoursToPickup = round((0.5 + rng()*6)*10)/10`; `avgPickupTime`, `pickupSlaRate`,
  `unassignedCount` = tickets without `assignedTo`.
- **Service delivery:** done tickets get `hoursToDeliver = round((12 + rng()*80)*10)/10`; `avgDeliveryTime`, `deliverySlaRate`,
  `inProgressCount`.
- **Concierge pipeline:** `postedByAdmin` listings that are live/approved get `hoursToLive = round((48 + rng()*150)*10)/10`;
  `avgConciergeTime`, `conciergeSlaRate`, `pendingConcierge`.
- **Aggregate:** `totalBreaches` = sum of category breaches; `overallSlaRate` = mean of the 4 SLA rates. Plus a 4-week
  simulated `weeklyTrend`. Tab KPIs surface overall + per-category avg/rate + total breaches with colour thresholds (>=90 green, >=75 amber).

### 5.8 Seasonal tab (`seasonalAnalytics()`, seed 112233)
Pune-specific monthly multipliers (12 each): `rentMultiplier` (peak Jun-Aug), `buyMultiplier` (peak Oct-Nov),
`visitMultiplier` (monsoon dip Jul-Sep).
- `monthlyDemand[m]`: `rental = round(100*rentMult)`, `buying = round(100*buyMult)`, `visits = round(100*visitMult)`,
  `combined = round(100*(rentMult*0.55 + buyMult*0.45))`.
- **Per-locality curve** by `loc.focus` (Rent/Buy/Both): `demand = round(base * mult * (0.95 + rng()*0.1))`;
  `peakDemand`/`lowDemand` = max/min of the curve; peak/slow months derived from focus.
- `yoyGrowth`: 3-year simulated series; `events`: 6 fixed market events; `recommendations`: rule-based on the
  **current** month's multipliers (e.g. rent `>=1.2` -> "prioritize rental sourcing"; visits `<=0.8` -> "push virtual tours").

### 5.9 Dashboard KPIs (adjacent, `AdminDashboard.jsx`)
- **Needs-attention tiles** (live counts): Pending Verification (`status==='pending'`), Needs Follow-up
  (stale >48h pending + concierge owners missing photos or the Verified badge, deduped), Flagged (`status==='flagged'`),
  New Enquiries (`status==='new'`), Scheduled Visits (`status==='scheduled'`), New Service Requests (`status==='new'`),
  Deals in Progress (`status==='in_progress'`), Owner KYC Pending (`role==='owner' && !verified` — owners
  without the **opt-in** Verified badge; a growth nudge, not a posting/contact gate, per ADR-019).
- **At-a-glance:** Total Users (buyer+owner), Active Listings (`approved`) / total, Revenue this month
  (`subscriptions+services+featured` of last `analytics.revenue` row, MoM via `pct`), Total Deals, Signups today
  (last traffic row), Visits today + `visits30` (sum).
- **Smart Alerts** (`computeSmartAlerts()`): severity-ranked rules - stale listings (>48h: warning, >=3 critical),
  unassigned tickets (>24h critical), stalled concierge owners (>72h), supply-demand hotspots (`demand>=85 && supply<=1`),
  KYC backlog (>=10 warning / >=5 info), long-running high-priority tickets (>5d), flagged listings. Dismissals persist in localStorage.
- **Ops Scorecard** (`dailyOpsScorecard()`, seed 202607): today-vs-yesterday simulated ops metrics with targets
  (listingsApproved 5, ticketsCompleted 4, enquiriesResponded 8, remindersSent 3, totalActions 25) and a top-5 staff breakdown.
- **Platform health** dots read live from `settings.flags` (maintenanceMode, signupsEnabled, staffLoginEnabled, services on, onlineRentPayment, whatsappEnabled).

### 5.10 Time ranges & filters
- **Traffic window** `days` (30/90/180) is the only interactive filter; it re-seeds `trafficSeries`/`anonymousSurfers`
  and the traffic CSV. Analytics has no date-range picker beyond this - other slices use fixed windows (30d/7d in Supply Gap).
- Tab visibility is driven by `analytics.<key>` flags; the whole page needs the `analytics` module flag.

### 5.11 What MUST move server-side
- **Everything.** Traffic, surfers, SLA, seasonal, ops-scorecard and price/6-month trends are seeded-RNG **simulations**,
  not measurements. Real telemetry (visits, pageviews, signups, session/bounce) and real timestamps (created/assigned/
  resolved/approved) must come from the server.
- The fragile locality parse (`split(' in ')`) and the demand-weighting constants (+1/+0.5/+2/+3, 0.4 fallback) must be
  replaced by real joins on `localitySlug` and a governed demand model.
- Deviation/yield/opportunity thresholds and SLA targets should be server-config, and the funnel/KPIs authoritative.

## 6. Maker-checker / approval
- **Not applicable.** Analytics is read-only reporting - no proposals, approvals, or mutations. (Dashboard tiles link
  into flows that do have maker-checker, e.g. property verification and visits.)

## 7. State machine
- No entity lifecycle is owned here. The only "states" are categorical labels the views compute for display:
  pricing `overpriced|underpriced|fair`, supply-gap priority `High|Medium|OK`, SLA `breached/breaching`, and
  seasonal recommendation `opportunity|caution|strategy`. These are derived each render, not transitions.

## 8. Edge cases, validation & error states
- **Loading:** `<Loading />` until `getAnalytics()` resolves (only `sources` is actually consumed from it).
- **Flag gating:** disabled tabs are filtered out (`.filter(Boolean)`); their generators are skipped via memo guards.
- **Divide-by-zero guards:** SLA rates default to 100 when no items; pricing skips null `marketPrice`; `maxDemand/maxSupply`
  use `Math.max(..., 1)`; anonymous rates guard on `totalVisits`.
- **Empty signals:** Supply Gap shows friendly empty states when there are no demand alerts / city requests.
- **Sample labelling:** non-derived charts carry a "Sample" chip so illustrative data is not mistaken for real.
- **Determinism:** fixed RNG seeds mean values are stable per session but change with the mock DB contents / current date.
