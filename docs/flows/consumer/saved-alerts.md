# Flow: Saved Properties & Search Alerts

> Two related retention primitives: shortlisting a property (the heart/bookmark) and saving a search
> as a standing alert that promises "we notify you when new matches are listed".
> **Status:** documented from React source - **Primary role(s):** buyer/tenant/seeker (also flatmate seekers)

---

## 1. Purpose & user problem
- **Persona:** a seeker comparing homes over days/weeks; a flatmate seeker doing the same on
  Share-a-Flat; a signed-out lead who leaves their number to be alerted.
- **Job-to-be-done:** "Keep the homes I like in one place, and tell me when a new listing fits what
  I'm hunting for so I don't have to keep re-searching."
- **Why it matters:** Pune inventory moves fast; saved searches + alerts are the core re-engagement
  loop. Saved properties feed the Overview stat tile and the price/availability notifications.

## 2. Entry points
- **Save a property (heart):** the heart toggle on any listing card / property detail; the Saved page
  card; anywhere `toggleSavedProp(id)` is called.
- **Save a search / create an alert:**
  - Listings results toolbar "Save search" (`ResultsArea.jsx` -> `Listings.saveSearch`).
  - Listings empty/notify card `NotifyMeCard.jsx` (lets a signed-out lead enter a mobile + channel).
  - Share-a-Flat toolbar + empty-state `ShareAlertCard.jsx`.
  - Locality page "get alerted" (`Locality.jsx`).
  - The Saved page's per-card "bell-plus" button (`Saved.createAlert`) - turns a saved home into an
    alert for similar homes.
- **Routes:** `/saved` (`ProtectedRoute`, and feature-flag gated via `AppFlagsContext`),
  `/listings`, `/share-flat`, `/notifications`, and the Dashboard "Saved & Activity" tab
  (`#activity`, sub `saved` / `alerts`).
- **Source components:** `src/pages/consumer/Saved.jsx`,
  `src/pages/consumer/dashboard/SavedPanel.jsx`, `src/pages/consumer/dashboard/AlertsPanel.jsx`,
  `src/pages/consumer/Notifications.jsx`,
  `src/pages/consumer/listings/{alertCriteria.js,NotifyMeCard.jsx,ResultsArea.jsx}`,
  `src/pages/consumer/shareflat/{alertCriteria.js,ShareAlertCard.jsx}`.

## 3. Actors & roles
- Any signed-in user can save properties and searches (stored under their mobile). A **signed-out
  lead** can create an alert via `NotifyMeCard` / `ShareAlertCard` by supplying a mobile - the record
  is keyed by THAT mobile so it "lands under that user and surfaces in their dashboard after they sign
  in - instead of being orphaned under `anon`".
- No approval/checker involved; this is a private, per-user store.

## 4. Entities touched
Links go to [`../../system/data-model.md`](../../system/data-model.md).
- `saved_properties` (runtime `src/lib/store/notifications.js`, key `pnSavedProps:<mobile|anon>`) -
  created/removed by heart toggle. Just an array of property ids.
- `saved_searches` (runtime `src/lib/store/search.js`, key `pnSavedSearches:<mobile|anon>`) -
  created, removed, alert-toggled. Also holds Share-a-Flat alerts (`kind: 'shareflat'`).
- `notifications` (runtime `src/lib/store/notifications.js`, key `pnNotifications:<mobile>`) - read +
  merged: live match/price notifications are derived from the two stores above.
- Notification/comm preferences (`pnNotifPrefs:<mobile>`) - read to gate live alerts.
- Share-flat saved items also use a separate `puneNestShareSaved` localStorage map (kind/title/loc).

## 5. Business rules & logic  *(the meat)*

### Saving a property (`store/notifications.js`)
- `savedPropsKey() = 'pnSavedProps:' + (myMobile() || 'anon')`.
- `getSavedProps()` -> array of ids; `isSavedProp(id)` -> membership; `toggleSavedProp(id)` pushes or
  splices and **returns `true` if now saved**. Idempotent per id (no duplicates).
- The Saved page resolves ids against the live catalog (`listProperties`) and classifies each into
  `buy` vs `rent` by `p.deal === 'rent'`; flat-share saves come from `puneNestShareSaved` and are
  category `share`. Counts per category drive the tab badges; sort options: `newest` (by `createdAt`),
  `price-desc`, `price-asc` (by `priceNum`).

### Saving a search / alert (`store/search.js`)
- `addSavedSearch(o)` creates `{ id: 'ss'+Date.now(), alerts: true, channel: 'whatsapp', at:
  Date.now(), newCount: 0, ...o }`. Defaults: **alerts on**, **channel WhatsApp**, **newCount 0**.
- **Keying rule:** the record is stored under `savedSearchKey(rec.mobile)` - i.e. the record's OWN
  mobile when provided (signed-out lead), otherwise `myMobile()` or `anon`. New records are unshifted
  (newest first).
- `removeSavedSearch(id)` filters it out; `toggleSearchAlert(id)` flips `alerts` on/off.

### Building the alert criteria (`listings/alertCriteria.js`)
- `buildAlertRecord(f)` normalises live filter state (Sets) into a persistable payload:
  `deal, types, commercialTypes, bhk, sharing, furnishing, amenities, localities, budget, rent`,
  plus a human `label` from `alertLabel()`.
- **Price-band note:** a budget/rent range equal to the slider defaults (`BUY_MAX = 50000000`,
  `RENT_MAX = 100000`) is treated as "any" and not shown as a chip.
- `criteriaChips(rec)` renders the full filter set as chips (intent, type, BHK, sharing, price,
  localities, furnishing, amenities) - the same chips on the Listings alert card and the dashboard
  Alerts panel, so every surface shows the identical captured filters.

### Saved-home -> "similar homes" alert (`Saved.createAlert`)
Turning a saved property into an alert builds a filter around it with a **+/-15% price band**:
`lo = round(priceNum * 0.85)`, `hi = round(priceNum * 1.15)`, plus same intent (`deal`), same BHK
(`bhkNum`) and same locality (`localitySlug`). Applied to `budget` for buy or `rent` for rent, then
`addSavedSearch({ ...buildAlertRecord(f), query: '' })`.

### Matching engine (`countMatches`)
The only "does anything match right now" logic. `countMatches(rec, props)` counts live listings where:
- intent matches (`rec.deal === 'rent'` vs `p.deal === 'rent'`), AND
- if the alert has localities, the listing's `localitySlug` OR display `locality` (case-insensitive)
  is in the set, AND
- if the alert has BHK, `String(p.bhkNum)` is in the set.
It "fails safe to 0 on any mismatch - it never fabricates matches". Note this uses only deal +
locality + BHK (a subset of the captured criteria); price/furnishing/amenities are captured for
display but not applied to the count.

### Share-a-Flat alerts (`shareflat/alertCriteria.js`)
- `buildShareAlertRecord(filters, tab)` produces `{ kind: 'shareflat', tab, q, locality, budget,
  moveIn, gender, sharing, attachedBath, verifiedOnly, habits[], label }`, tab-gated so a stale value
  for an inactive tab never rides along. `BUDGET_MAX = 40000` is "any". Tabs: `flatmates`, `rooms`,
  `groups`. `shareCriteriaChips` renders these; the Alerts panel routes "View matches" to
  `/share-flat?view=<tab>`.

### Alerts panel (dashboard, `AlertsPanel.jsx`)
- Lists all saved searches (property + share-flat). Header sub = `${activeCount} active` where
  `activeCount = alerts.filter(a => a.alerts).length`.
- Per row: criteria chips, delivery channel chip (`whatsapp` -> WhatsApp/message-circle, `sms` ->
  SMS/smartphone), created date, a `newCount` "N new" badge when `> 0`, a "View matches" link, an
  on/off `Switch` (`toggleSearchAlert`), and delete (`removeSavedSearch`).

### Notifications / delivery (`Notifications.jsx` + `store/notifications.js`)
- Live match/price notifications are DERIVED, not pushed: on the Notifications page, for up to 4
  saved searches with `alerts !== false`, if `countMatches(s, props) > 0` a `match` notification is
  merged; if any saved property exists, one `price`/"still available" notification is merged. Deduped
  by stable id (`real-ss-<id>`, `real-savedprop-<id>`) so revisiting never duplicates.
- **Preference gates:** suppressed entirely unless `prefs.matchAlerts` is true and `!inQuietHours()`.
  `NOTIF_PREF_DEFAULTS = { email:true, sms:false, whatsapp:true, matchAlerts:true, quietHours:{
  enabled:false, start:'22:00', end:'07:00' }, language:'en' }`. `inQuietHours` handles windows that
  wrap past midnight.
- Notifications are per-user, seed-once (`seedNotifsIfEmpty`), with unread badge counts, mark-read,
  dismiss, and a safe-link guard (`SAFE_LINK_RE`) since merged items can be externally shaped.

## 6. Maker-checker / approval
- **Not applicable.** Saving/alerting is a private per-user action with no approver. (Contrast with
  the contact-gate flow, which is maker-checker.)

## 7. State machine
```
Saved property (per id):   unsaved --toggleSavedProp--> saved --toggleSavedProp--> unsaved
Saved search (per id):     created(alerts=true) --toggleSearchAlert--> alerts off <--> on
                                                 --removeSavedSearch--> deleted (terminal)
Alert delivery (derived):  alerts on AND matchAlerts pref on AND not in quiet hours AND countMatches>0
                             -> match notification merged (deduped by id)
```
- `newCount` exists on the record (seeded/settable) but no live code increments it; today it reflects
  seed data only. Real match counting happens live via `countMatches`.

## 8. Edge cases, validation & error states
- **Signed-out lead:** alert stored under the mobile they typed, not `anon`, so it re-appears after
  they sign in with that number.
- **Empty states:** Saved page has a full empty state and per-category empty states; SavedPanel and
  AlertsPanel each render a distinct "nothing yet" card with a CTA (never blank).
- **Removed listing:** saved ids that no longer resolve against the catalog are simply filtered out
  (`.filter(Boolean)`), so a stale id shows nothing rather than erroring.
- **"Any" ranges:** default-max budget/rent produce no price chip (noise suppression).
- **Duplicate saves:** heart toggle is idempotent per id; a saved search is not deduped by criteria
  (two identical saves create two records).
- **countMatches is conservative:** any field mismatch -> excluded; it never invents matches, so an
  alert can legitimately show zero live matches.
- **Quiet hours / alerts-off:** live match/price notifications are fully suppressed; the record stays
  but no notification is generated.

## 9. Current mock implementation
- **Service (provider):** `src/services/providers/mock/savedProvider.js` wraps the store: async
  `getSavedProps/isSavedProp/toggleSavedProp`, `getSavedSearches/addSavedSearch/removeSavedSearch/
  toggleSearchAlert`, plus plan/boost/service-order passthroughs. (Consumer pages mostly import the
  sync store functions directly from `src/lib/store.js`.)
- **Stores:** `src/lib/store/notifications.js` (saved properties + notifications + prefs),
  `src/lib/store/search.js` (saved searches, recent props/searches).
- **Criteria helpers:** `src/pages/consumer/listings/alertCriteria.js`,
  `src/pages/consumer/shareflat/alertCriteria.js`.
- **Data/seed:** no dedicated saved-seed JSON - saved data is purely runtime/localStorage. The
  Notifications page seeds a default notification set (`SEED` in `Notifications.jsx`).
- **Key components/handlers:** `Saved.jsx` (`createAlert` +/-15% band, `remove`),
  `AlertsPanel.jsx` (`onToggle`/`onDelete`), `Notifications.jsx` (derive + `mergeNotifs`),
  `NotifyMeCard.jsx`/`ShareAlertCard.jsx` (`addSavedSearch({ ...record, channel, mobile })`).

## 10. Target API endpoints
Map to the [OpenAPI spec](../../../backend/src/main/resources/static/openapi/punenest-api.yaml) (tag: Engagement):
- `GET /me/saved-properties`, `POST /me/saved-properties/:id/toggle`.
- `GET /me/saved-searches`, `POST /me/saved-searches`, `DELETE /me/saved-searches/:id`,
  `PATCH /me/saved-searches/:id/alert`.
- `GET /notifications` (+ mark-read / dismiss). **Deltas implied:** the create endpoint should accept
  the full criteria payload (`deal, types, bhk, localities, budget/rent, channel`, share-flat variant)
  and, for signed-out leads, an explicit `mobile`; the response should carry a real `newCount` and a
  server-computed live-match count.

## 11. Backend responsibilities
- **Own the matching engine.** New-listing matching against saved searches must run server-side on
  ingest (not recomputed in the browser on page open), apply the FULL captured criteria (price,
  furnishing, amenities - not just deal/locality/BHK), and maintain a real `newCount` since last seen.
- **Own alert delivery.** Fan-out to WhatsApp/SMS/email per the saved `channel` and the user's
  `matchAlerts` + quiet-hours preferences, with dedupe/idempotency so a match notifies once. See
  [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 7.
- **Attribute signed-out-lead alerts** to the user once they sign in with the captured mobile, and
  scope all saved data to the authenticated user (mobile-key -> `users.id` FK).
- The client must not be trusted to decide what matched or whether an alert was delivered.
