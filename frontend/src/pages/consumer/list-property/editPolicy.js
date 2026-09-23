/* Single source of truth for how owner edits are treated once a listing is live: TIER A (identity fields,
   existing photos) stays live but is flagged for an anti bait-and-switch re-check; TIER B publishes instantly. */

/* Kept local so this file stays dependency-free. */
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
  // The zone is what `landUseFor` derives `landUse` from, and the server takes a listing off search for it.
  { key: 'plotZone', label: 'Plot zone' },
  { key: 'floor', label: 'Floor' },
  { key: 'totalFloors', label: 'Total floors' },
  { key: 'facing', label: 'Facing' },
  // Match facing's client-side classification; server re-review is decided separately.
  { key: 'overlooking', label: 'Overlooking' },
  { key: 'age', label: 'Property age' },
  { key: 'construction', label: 'Possession status' },
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

/* Identity = the fields that define which property this is; changing one is a new property for the quota.
   Society is excluded on purpose — a name correction stays a re-check, not a paywall trigger. */
export const IDENTITY_FIELDS = ['propertyType', 'commercialType', 'locality'];

/* Tier B — soft fields reported in the "goes live instantly" summary. Anything in neither list
   (map lat/lng, transient UI flags) is ignored for reporting. */
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
  { key: 'gstOnRent', label: 'GST on rent' },
  { key: 'fitOutMonths', label: 'Rent-free / fit-out period' },
  { key: 'escalationPct', label: 'Annual escalation' },
  { key: 'tenancyStatus', label: 'Tenancy status' },
  { key: 'inPlaceRent', label: 'In-place rent' },
  { key: 'leaseExpiry', label: 'Lease expiry' },
  { key: 'seatCount', label: 'Seating capacity' },
  { key: 'frontage', label: 'Frontage' },
  { key: 'floorLoad', label: 'Floor load' },
  { key: 'clearHeight', label: 'Clear height' },
  { key: 'sanctionedPower', label: 'Sanctioned power' },
  { key: 'dockCount', label: 'Loading docks' },
  { key: 'waterSource', label: 'Water source' },
];

/* The server's own rule, narrower than Tier A/B and disagreeing with it in both directions on purpose:
   collapsing them would make one lie. `scripts/check-listing-foundation.mjs` fails the build on drift. */

/** Foundation fields whose edit takes the listing off search (server: revertToPending). */
export const FOUNDATION_OFF_SEARCH_KEYS = {
  bhk: ['bhk'],
  propertyType: ['propertyType'],
  locality: ['locality'],
  deal: ['deal'],
  /* Nobody types `landUse`; it is derived by `landUseFor(propertyType, plotZone)`. Only the zone is named
     here because `propertyType` is already its own entry above and both flatten into the same Set. */
  landUse: ['plotZone'],
};

/** Foundation fields whose edit is re-checked but stays in search (server: requestRecheck). */
export const FOUNDATION_STAYS_LIVE_KEYS = {
  price: ['price', 'monthlyRent'],
  furnishing: ['furnishing'],
  possession: ['construction'],
  address: ['street'],
  /* The evidence the approval was given against. `photos` is reported by classifyChanges from the
     photo-url arguments rather than from a form field, which is why it is PHOTO_FIELD's key. */
  images: ['photos'],
  description: ['description'],
  amenities: ['amenities'],
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
  /* Any gallery change, not only a removal: the photographs are what the approval was given against. Compared
     in order, unlike `norm` — the server uses `List.equals` and the first photo is the site-wide cover. */
  const gallery = (urls) => (urls || []).map(String).join('|');
  if (removedPhotos || gallery(oldPhotoUrls) !== gallery(newPhotoUrls)) {
    tierA.push({ key: PHOTO_FIELD.key, label: PHOTO_FIELD.label, from: 'Original photos', to: 'Edited' });
  }
  const tierB = changed(TIER_B_FIELDS);

  /* Derived rather than read off the tiers, because the server's outcome cuts across both: a price edit
     must not be reported as "publishes instantly" when it does the opposite. */
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
