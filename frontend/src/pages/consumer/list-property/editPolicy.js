/* =========================================================================
   Edit policy — single source of truth for how owner edits are treated after a
   listing is live. Splits every editable field into two tiers:

   • TIER A (material / trust)  → editing reverts nothing, but the listing is
     flagged for a fast admin re-check (anti bait-and-switch). It STAYS LIVE.
     Includes identity fields (locality / property type / society) and any
     already-uploaded photos — removing/replacing a verified photo needs a
     re-check, but ADDING new photos never does.

   • TIER B (soft / marketing)  → goes live instantly, no re-verification
     (price, description, amenities, availability, furnishing, etc.).

   A subset of Tier A is the property's IDENTITY. Changing identity is not a
   correction — it is effectively a different property, so it interacts with the
   freemium quota (see lib/data/listingQuota.js / paywall).

   Pure module: no side effects, safe to import from owner + admin screens. */

/* ---------- amount parser (kept local so this stays dependency-free) ---------- */
const amount = (s) => parseInt(String(s == null ? '' : s).replace(/[^\d]/g, ''), 10) || 0;

/* Tier A — material fields. Editing any of these on a live listing schedules a
   re-check. Labels are owner-facing (shown in the edit summary + admin diff). */
export const TIER_A_FIELDS = [
  { key: 'deal', label: 'Listing type (Sale / Rent)' },
  { key: 'propertyType', label: 'Property type' },
  { key: 'commercialType', label: 'Commercial type' },
  { key: 'bhk', label: 'Bedrooms (BHK)' },
  { key: 'carpetArea', label: 'Carpet area' },
  { key: 'builtUp', label: 'Built-up area' },
  { key: 'plotArea', label: 'Plot area' },
  { key: 'floor', label: 'Floor' },
  { key: 'totalFloors', label: 'Total floors' },
  { key: 'facing', label: 'Facing' },
  { key: 'age', label: 'Property age' },
  { key: 'possession', label: 'Possession status' },
  { key: 'ownership', label: 'Ownership type' },
  { key: 'locality', label: 'Locality' },
  { key: 'society', label: 'Society / project' },
  { key: 'flatNumber', label: 'Flat / unit no.' },
  { key: 'tower', label: 'Tower / wing' },
  { key: 'street', label: 'Street' },
  { key: 'pincode', label: 'PIN code' },
];

/* The synthetic "photos" change (an existing photo was removed/replaced). */
export const PHOTO_FIELD = { key: 'photos', label: 'Listing photos' };

/* Identity = the fields that define which property this actually is. Changing
   any of them is treated as a new property for the freemium quota. Society is
   deliberately excluded — a society/name correction stays a re-check (Tier A),
   not a paywall trigger. */
export const IDENTITY_FIELDS = ['propertyType', 'commercialType', 'locality'];

/* Tier B — soft fields reported in the "goes live instantly" summary. Anything
   not listed in Tier A or here (e.g. map lat/lng, transient UI flags) is ignored
   for reporting. */
export const TIER_B_FIELDS = [
  { key: 'price', label: 'Sale price' },
  { key: 'monthlyRent', label: 'Monthly rent' },
  { key: 'deposit', label: 'Deposit' },
  { key: 'priceNegotiable', label: 'Price negotiable' },
  { key: 'transactionType', label: 'Transaction type' },
  { key: 'loanAvailable', label: 'Loan availability' },
  { key: 'monthlyMaintenance', label: 'Maintenance' },
  { key: 'camCharges', label: 'Maintenance / CAM' },
  { key: 'rentMaintMode', label: 'Maintenance terms' },
  { key: 'rentMaintenance', label: 'Maintenance amount' },
  { key: 'description', label: 'Description' },
  { key: 'amenities', label: 'Amenities' },
  { key: 'furniture', label: 'Furniture' },
  { key: 'furnishing', label: 'Furnishing' },
  { key: 'availableFrom', label: 'Available from' },
  { key: 'preferredTenants', label: 'Preferred tenants' },
  { key: 'vegOnly', label: 'Food preference' },
  { key: 'petsPolicy', label: 'Pets policy' },
  { key: 'foodPref', label: 'Food preference' },
  { key: 'agreementDuration', label: 'Agreement duration' },
  { key: 'lockIn', label: 'Lock-in period' },
  { key: 'noticePeriod', label: 'Notice period' },
  { key: 'reraId', label: 'MahaRERA ID' },
  { key: 'suitableFor', label: 'Suitable for' },
  { key: 'fixtures', label: 'Fixtures & fittings' },
  { key: 'washrooms', label: 'Washrooms' },
  { key: 'shellType', label: 'Fit-out (shell)' },
  { key: 'parkingSpaces', label: 'Parking spaces' },
  { key: 'powerBackup', label: 'Power backup' },
  { key: 'pantry', label: 'Pantry' },
  { key: 'waterSource', label: 'Water source' },
];

/* ---------- what the SERVER does, as opposed to what we model above ----------
   Tier A/B is a client-side UX model: "the edit stays live, we flag it for a quick
   re-check". The server has its own, narrower rule, and since Q14 it has two prices
   rather than one. `ListingEditRules.apply`
   (backend/…/catalog/listing/ListingEditRules.java) classifies exactly the eight wire
   fields below — the facets a buyer can filter on, plus the one field a duplicate is
   detected from — into two blocks:

     • OFF SEARCH  — bhk, propertyType, locality, deal. `update` calls
       `Property.revertToPending()`: the listing leaves search until a moderator
       re-approves it. These change what the listing fundamentally *is*, so leaving
       it indexed returns a wrong answer (a 2BHK under 3BHK, a rental under sale).

     • STAYS LIVE  — price, furnishing, possession, address. `update` calls
       `Property.requestRecheck()`: a moderator still gets the work item, but the
       listing keeps `status: approved` and stays in search. The first three change an
       attribute of a listing that is still the same property, so the worst case is a
       briefly out-of-date value on a listing that is genuinely what it claims to be.
       `address` (D219) is there for a different reason and is not a search facet at
       all: it is what the server derives the duplicate key from, so editing it is how
       a listing moves onto a flat another owner already has listed. Its wizard key is
       `street`.

   `ListingFoundationTest` pins both sets behaviourally through the real endpoint.

   Tier A/B and the server's rule still disagree in both directions — `price` and
   `furnishing` are Tier B here ("publishes instantly") and cost a re-check there;
   `floor`/`facing`/`age`/`carpetArea` are Tier A here and are ordinary edits there,
   several not even in the update contract. That is deliberate and stays: Tier A/B
   drives the 3-edits-per-30-days throttle and the paywall, the server's rule drives
   what happens to the listing, and collapsing them would make one of the two lie.
   So `classifyChanges` reports the server's outcome in its own orthogonal buckets and
   the banner reads those.

   Keyed by the server's wire field name; the value is every wizard form key feeding
   it. `price` has two because the wizard splits sale price from monthly rent while
   the entity has a single `price` column.

   `scripts/check-listing-foundation.mjs` fails the build if either map drifts from
   `ListingEditRules.apply`, from `ListingFoundationTest`, or from the
   `LISTING_FOUNDATION_FIELDS` mirror in `lib/store/listings.js` — including a field
   that has quietly moved from one set to the other. Three lists in three vocabularies
   is what produced D76; the gate is what stops it recurring. */

/** Foundation fields whose edit takes the listing off search (server: revertToPending). */
export const FOUNDATION_OFF_SEARCH_KEYS = {
  bhk: ['bhk'],
  propertyType: ['propertyType'],
  locality: ['locality'],
  deal: ['deal'],
};

/** Foundation fields whose edit is re-checked but stays in search (server: requestRecheck). */
export const FOUNDATION_STAYS_LIVE_KEYS = {
  price: ['price', 'monthlyRent'],
  furnishing: ['furnishing'],
  possession: ['possession'],
  address: ['street'],
};

/** Both halves, for callers that only care that a field is a foundation field at all. */
export const FOUNDATION_FORM_KEYS = {
  ...FOUNDATION_OFF_SEARCH_KEYS,
  ...FOUNDATION_STAYS_LIVE_KEYS,
};

const OFF_SEARCH_KEYS = new Set(Object.values(FOUNDATION_OFF_SEARCH_KEYS).flat());
const STAYS_LIVE_KEYS = new Set(Object.values(FOUNDATION_STAYS_LIVE_KEYS).flat());

/* Thresholds. */
export const PRICE_REDUCED_PCT = 0.15;   // buyer-facing "Price reduced" badge
export const PRICE_JUMP_FLAG_PCT = 0.20; // admin flag on a sharp price increase
export const MATERIAL_EDIT_WINDOW_DAYS = 30;
export const MATERIAL_EDIT_CAP = 3;      // material edits / listing / 30 days before we flag

/* Normalise a value so arrays/booleans/strings compare cleanly. */
const norm = (v) => {
  if (Array.isArray(v)) return v.map((x) => String(x)).sort().join('|');
  if (v == null) return '';
  return String(v).trim();
};

/* Did the owner drop any already-uploaded photo? Adding new ones never counts. */
export const photosRemoved = (oldUrls = [], newUrls = []) => {
  if (!oldUrls.length) return false;
  const kept = new Set(newUrls);
  return oldUrls.some((u) => !kept.has(u));
};

/* Price delta between the old and new form (rent uses monthlyRent, sale price). */
export const priceSwing = (oldForm = {}, newForm = {}) => {
  const rent = (newForm.deal || oldForm.deal) === 'rent';
  const oldP = amount(rent ? oldForm.monthlyRent : oldForm.price);
  const newP = amount(rent ? newForm.monthlyRent : newForm.price);
  if (!oldP || !newP || oldP === newP) return null;
  const pct = (newP - oldP) / oldP;
  return { from: oldP, to: newP, pct, abs: Math.abs(pct), dir: pct < 0 ? 'down' : 'up' };
};

/* Classify every change between two form snapshots into the two tiers. */
export const classifyChanges = (oldForm = {}, newForm = {}, oldPhotoUrls = [], newPhotoUrls = []) => {
  const changed = (list) =>
    list
      .filter((f) => norm(oldForm[f.key]) !== norm(newForm[f.key]))
      .map((f) => ({ key: f.key, label: f.label, from: oldForm[f.key], to: newForm[f.key] }));

  const tierA = changed(TIER_A_FIELDS);
  const removedPhotos = photosRemoved(oldPhotoUrls, newPhotoUrls);
  if (removedPhotos) tierA.push({ key: PHOTO_FIELD.key, label: PHOTO_FIELD.label, from: 'Original photos', to: 'Edited' });
  const tierB = changed(TIER_B_FIELDS);

  /* The server's outcome, in its own buckets. It cuts across both tiers, so these are
     derived rather than taken straight from tierA/tierB: a price edit must not be
     counted as "publishes instantly" when it does the opposite. tierA/tierB are still
     returned unchanged — the edit-throttle and the paywall read them, and this is a
     reporting concern, not a change to either.

     `remoderation` is now only the half the server takes offline. The stays-live half
     is still a re-check, and still must not be described as instant, but the owner
     must not be told their listing goes dark for it — which is the entire point of
     the split. */
  const remoderation = [...tierA, ...tierB].filter((c) => OFF_SEARCH_KEYS.has(c.key));
  const remoderationKeys = new Set(remoderation.map((c) => c.key));
  const staysLive = [...tierA, ...tierB].filter(
    (c) => STAYS_LIVE_KEYS.has(c.key) && !remoderationKeys.has(c.key),
  );
  const staysLiveKeys = new Set(staysLive.map((c) => c.key));

  return {
    tierA,
    tierB,
    remoderation,
    staysLive,
    recheck: [
      ...remoderation,
      ...staysLive,
      ...tierA.filter((c) => !remoderationKeys.has(c.key) && !staysLiveKeys.has(c.key)),
    ],
    instant: tierB.filter((c) => !remoderationKeys.has(c.key) && !staysLiveKeys.has(c.key)),
    identityChanged: IDENTITY_FIELDS.some((k) => norm(oldForm[k]) !== norm(newForm[k])),
    photosRemoved: removedPhotos,
    priceSwing: priceSwing(oldForm, newForm),
  };
};

/* Count material (Tier A) edits inside the throttle window from an edit log. */
export const recentMaterialEdits = (editLog = [], now = Date.now()) => {
  const cutoff = now - MATERIAL_EDIT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return editLog.filter((e) => e && e.at >= cutoff && (e.tierA || 0) > 0).length;
};

/* Human-friendly rendering of a raw form value for the edit summary / admin diff. */
export const displayValue = (v) => {
  if (Array.isArray(v)) return v.length ? v.join(', ') : '\u2014';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  const s = String(v == null ? '' : v).trim();
  return s === '' ? '\u2014' : s;
};
