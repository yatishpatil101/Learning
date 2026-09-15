/* Edit policy — single source of truth for how owner edits are treated once a listing is live.
   TIER A (material/trust: identity fields, existing photos) stays live but is flagged for a fast
   admin re-check, anti bait-and-switch; TIER B (price, description, amenities …) publishes
   instantly. The identity subset also interacts with the freemium quota. Pure module. */

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
  // Match facing's client-side classification; server re-review is decided separately.
  { key: 'overlooking', label: 'Overlooking' },
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

/* The server's own rule, narrower than Tier A/B above: OFF SEARCH fields change what the listing
   fundamentally *is*, so leaving it indexed answers wrongly, while STAYS LIVE fields raise a work
   item and stay in search. It disagrees with Tier A/B in both directions on purpose — collapsing
   them would make one lie. `scripts/check-listing-foundation.mjs` fails the build on drift. */

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

  /* The server's outcome, derived rather than read off the tiers, because it cuts across both: a
     price edit must not be reported as "publishes instantly" when it does the opposite. tierA/tierB
     are returned unchanged for the throttle and paywall. `remoderation` covers only the half the
     server takes offline — the stays-live half is a re-check, but the owner is not told it goes dark. */
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
