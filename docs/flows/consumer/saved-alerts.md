# Flow: Saved Properties & Search Alerts

> Two related retention primitives: shortlisting a property (the heart/bookmark) and saving a search
> as a standing alert that promises "we notify you when new matches are listed".
> **Status:** documented from React source - **Primary role(s):** buyer/tenant/seeker (also flatmate seekers)

---

## 1. Purpose & user problem
- **Persona:** a seeker comparing homes over days/weeks; a flatmate seeker doing the same on
  Flatmates; a signed-out lead who leaves their number to be alerted.
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
  - Flatmates toolbar + empty-state `FlatmateAlertCard.jsx`.
  - Locality page "get alerted" (`Locality.jsx`).
  - The Saved page's per-card "bell-plus" button (`Saved.createAlert`) - turns a saved home into an
    alert for similar homes.
- **Routes:** `/saved` (`ProtectedRoute`, and feature-flag gated via `AppFlagsContext`),
  `/listings`, `/flatmates`, `/notifications`, and the Dashboard "Saved & Activity" tab
  (`#activity`, sub `saved` / `alerts`).
- **Source components:** `src/pages/consumer/Saved.jsx`,
  `src/pages/consumer/dashboard/SavedPanel.jsx`, `src/pages/consumer/dashboard/AlertsPanel.jsx`,
  `src/pages/consumer/Notifications.jsx`,
  `src/pages/consumer/listings/{alertCriteria.js,NotifyMeCard.jsx,ResultsArea.jsx}`,
  `src/pages/consumer/flatmates/{alertCriteria.js,FlatmateAlertCard.jsx}`.

## 3. Actors & roles
- Any signed-in user can save properties and searches (stored under their mobile). A **signed-out
  lead** can create an alert via `NotifyMeCard` / `FlatmateAlertCard` by supplying a mobile - the record
  is keyed by THAT mobile so it "lands under that user and surfaces in their dashboard after they sign
  in - instead of being orphaned under `anon`".
- No approval/checker involved; this is a private, per-user store.

## 4. Entities touched
Links go to [`../../system/data-model.md`](../../system/data-model.md).
> **Runtime note.** The `src/lib/store/*` modules cited below (`notifications.js`, `search.js`) were
> deleted with the mock provider lane. Saving is now `SavedContext` over the server; searches and
> alerts go through `services/savedSearchService.js`; notifications through
> `services/notificationService.js`. The keys and rules are kept because they document the shape and
> the edge cases the server behaviour still has to satisfy.

- `saved_properties` (was `src/lib/store/notifications.js`, key `dzSavedProps:<mobile|anon>`) -
  created/removed by heart toggle. Just an array of property ids.
- `saved_searches` (was `src/lib/store/search.js`, key `dzSavedSearches:<mobile|anon>`) -
  created, removed, alert-toggled. Also holds Flatmates alerts (`kind: 'flatmates'`).
- `notifications` (was `src/lib/store/notifications.js`, key `dzNotifications:<mobile>`) - read +
  merged: live match/price notifications are derived from the two stores above.
- Notification/comm preferences (`dzNotifPrefs:<mobile>`) - read to gate live alerts.
- Flatmate saved items also use a separate `draazyFlatmateSaved` localStorage map (kind/title/loc).

## 5. Business rules & logic  *(the meat)*

### Saving a property (was `store/notifications.js`, deleted)
- `savedPropsKey() = 'dzSavedProps:' + (myMobile() || 'anon')`.
- `getSavedProps()` -> array of ids; `isSavedProp(id)` -> membership; `toggleSavedProp(id)` pushes or
  splices and **returns `true` if now saved**. Idempotent per id (no duplicates).
- The Saved page resolves ids against the live catalog (`listProperties`) and classifies each into
  `buy` vs `rent` by `p.deal === 'rent'`; flatmate saves come from `draazyFlatmateSaved` and are
  category `flatmates` ("Flatmates & Rooms"). Counts per category drive the tab badges; sort options:
  `newest` (by `createdAt`), `price-desc`, `price-asc` (by `priceNum`).
- **Swipe to remove (mobile only):** a saved card can be swiped left to remove (`useSwipeDismiss`,
  `axis: 'x'`, never armed above 640px; `touchAction: 'pan-y'` keeps vertical scrolling with the
  browser). A swipe is easy to fire by accident on a hand-curated list, so the removal is staged: the
  card renders as an undo row for `UNDO_WINDOW_MS = 5000` before it commits.

### Saving a search / alert (was `store/search.js`, deleted)
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

### Flatmates alerts (`flatmates/alertCriteria.js`)
- `buildFlatmateAlertRecord(filters, tab)` produces `{ kind: 'flatmates', tab, q, locality, budget,
  moveIn, gender, sharing, attachedBath, verifiedOnly, habits[], label }`, tab-gated so a stale value
  for an inactive tab never rides along: `sharing` is captured only on `team-up`, `attachedBath` only
  on `move-in`. `BUDGET_MAX = 40000` is "any" and is omitted rather than stored.
- **Tabs: `move-in` ("Move in now") and `team-up` ("Team up")** - the two live share intents. The
  legacy `rooms` / `flatmates` / `groups` values survive as read-only aliases (`normalizeTab`), so an
  alert saved before the redesign still resolves to a real tab instead of silently falling back;
  `tabMeta` normalizes before labelling, so it is never mislabelled either.
- `flatmateCriteriaChips` renders these - on the alert card, in the dashboard Alerts panel, and as
  the "why is this empty" chips in the Flatmates empty state. The Alerts panel routes "View matches"
  to `` /flatmates?view=${normalizeTab(a.tab)} ``.
- **Where the card appears (`FlatmateAlertCard`):** whenever the active list is empty **or** the
  seeker has narrowed with 2+ filters (`activeFilterCount >= 2`) - enough intent to want a ping.
  Its invitation copy swaps on the active tab and uses a plural noun for the subject ("the moment
  *homes* match" / "*flatmates* match") rather than the tab label, so the sentence stays grammatical
  after the two-tab rename. Channels offered are WhatsApp and SMS.

### Alerts panel (dashboard, `AlertsPanel.jsx`)
- Lists all saved searches (property + flatmates). Header sub = `${activeCount} active` where
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
- **The server now has the same preferences, and honours them (D94/D15, 2026-08-12).**
  `GET/PUT /me/notification-preferences` stores this exact document, field for field, in
  `notification_preferences`. `NotificationPublisher` — the single `Notifier` port every server-side
  writer goes through — applies two of them: `matchAlerts:false` drops proactive `match.*`/`price.*`
  notifications, and quiet hours **defer** rather than suppress (the row is written with its real
  timestamp and `notifications.deliver_after` holds it out of the inbox read until the window
  closes). So a server-written notification no longer arrives at 3am. **The client is not wired to
  the endpoint yet** — `ProfileTab.jsx` and this page still read and write localStorage, so the two
  copies can diverge until that lands. An absent server row resolves to the defaults above, never to
  silence.
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
Alert delivery (derived):  alerts on AND matchAlerts pref on AND not in quiet hours AND matchCount>0
                             -> match notification merged (deduped by id)
```
- `newCount` and `matchCount` are two different questions on the same record and are answered by the
  same query with one parameter flipped, so they cannot drift. `newCount` is "what arrived since the
  alert sweep's last baseline" — it falls back to zero once the alert has been sent, and a search
  saved a moment ago has none. `matchCount` is "how many live listings fit these facets right now",
  regardless of age.
- **`matchCount` is the server's number (D227).** It used to be the browser's: `Notifications.jsx`
  and the dashboard retention strip each fetched listings and ran `countMatches` over the result.
  That result was one page — `PAGE_SIZE = 100` — so the count was accidentally correct while the
  catalogue was smaller than a page and would have become a silent ceiling the day it was not. Now
  `SavedSearchService` fills the field on every read of the resource (list, create and update alike,
  so a freshly saved alert never renders a stale zero), and both surfaces read `s.matchCount`.
  `countMatches` survives as the **mock provider's** implementation of the same three facets, which
  is honest there because the whole demo catalogue is in memory and there is no page to truncate.

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
- **The match count is conservative on both sides:** a facet the record does not carry does not
  narrow, but a record with no `deal` at all counts **zero** rather than counting everything — an
  alert that has not said what it wants has not asked for anything. A `flatmates` alert is likewise
  zero; this count does not read the rooms catalogue. So an alert can legitimately show no matches,
  and never invents them.
- **Quiet hours / alerts-off:** live match/price notifications are fully suppressed; the record stays
  but no notification is generated.
