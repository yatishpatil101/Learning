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
   freemium quota (see store.canPostListing / paywall).

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

  return {
    tierA,
    tierB: changed(TIER_B_FIELDS),
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
