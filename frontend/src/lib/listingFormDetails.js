export const ADDRESS_PARTS = ['flatNumber', 'tower', 'society', 'street'];

// Matches ListingFormDetails on the server; canonical fields, trust flags and uploads stay outside. Pinned
// against the Java set by `check-enum-vocabulary.mjs`: a one-sided key is dropped silently, no 422, no log.
export const DETAIL_KEYS = new Set([
  ...ADDRESS_PARTS, 'landmark', 'commercialType', 'ownership', 'agreementDuration',
  'lockIn', 'noticePeriod', 'foodPref', 'petsPolicy', 'availableFrom', 'possession',
  'transactionType', 'rentMaintMode', 'plotArea', 'floorsInHouse', 'washrooms', 'shellType', 'camCharges',
  'plotLength', 'plotWidth', 'openSides', 'roadWidth', 'plotZone', 'waterSource',
  'loanAvailable', 'powerBackup', 'pantry', 'cornerPlot', 'boundaryWall',
  'naStatus', 'otherRights', 'buyerEligibility',
  // Retired in favour of `naStatus` / `otherRights`; kept so published listings still read back.
  'naSanctioned', 'electricity', 'roadAccess', 'satbara',
  'furniture', 'fixtures', 'suitableFor', 'preferredTenants',
  'gstOnRent', 'fitOutMonths', 'escalationPct', 'tenancyStatus', 'inPlaceRent', 'leaseExpiry',
  'seatCount', 'frontage', 'floorLoad', 'clearHeight', 'sanctionedPower', 'dockCount',
]);

export function pickListingFormDetails(form = {}) {
  return Object.fromEntries(Object.entries(form ?? {})
    .filter(([key, value]) => DETAIL_KEYS.has(key) && value != null));
}

export function hasStoredAddress(form = {}) {
  return Boolean(String(form.existingAddress ?? '').trim())
    && !ADDRESS_PARTS.some((key) => String(form[key] ?? '').trim());
}

/* The wire carries the address as one composed line, the wizard as four boxes. Splitting in the ORDER
   `submit.js` joined them is what makes this safe; a line this wizard could not have composed is left alone. */
const PART_LIMITS = { flatNumber: 20, tower: 30, society: 60, street: 60 };
// Indexed by segment count. Land has no unit or wing, so its line is only ever project and street.
const SHAPES = {
  property: [null, ['society'], ['flatNumber', 'society'],
    ['flatNumber', 'society', 'street'], ['flatNumber', 'tower', 'society', 'street']],
  land: [null, ['society'], ['society', 'street']],
};

export function splitStoredAddress(address, { land = false } = {}) {
  const line = String(address ?? '');
  if (/[\r\n]/.test(line)) return null;
  const segments = line.split(',').map((part) => part.trim()).filter(Boolean);
  const shape = (land ? SHAPES.land : SHAPES.property)[segments.length];
  if (!shape || shape.some((key, i) => segments[i].length > PART_LIMITS[key])) return null;
  return Object.fromEntries(shape.map((key, i) => [key, segments[i]]));
}