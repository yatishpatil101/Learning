
/* Never a submission gate — validation governs publishing. */
import {
  isLandType, isCommercialType, isResidentialType, isHouseType, commercialSpecsFor,
  amenitiesFor, STRONG_PHOTO_COUNT,
} from './constants.js';

export const MILESTONES = [20, 40, 60, 80, 100];

const filled= (v) => v != null && String(v).trim() !== '';
const nonEmptyArr = (v) => Array.isArray(v) && v.length > 0;
const validPin = (v) => /^[1-9]\d{5}$/.test(String(v || ''));

// Grouped fields earn partial credit so one supporting document need not complete the group.
const fracOf = (it) => (it.frac != null ? Math.max(0, Math.min(1, it.frac)) : (it.done ? 1 : 0));

const wholePlaceItems = (form, photos) => {
  const pt = form.propertyType;
  const isBuy = form.deal === 'buy';
  const isRent = form.deal === 'rent';
  const land = isLandType(pt);
  const commercial = isCommercialType(pt);
  const residential = isResidentialType(pt);
  const house = isHouseType(pt);
  const isFarm = pt === 'farmland';
  const towered = pt === 'flat' || commercial;
  const residentialPricing = !land && !commercial;
  const furnished = form.furnishing === 'furnished' || form.furnishing === 'semi';

  const amenityOptions = amenitiesFor(pt, form.commercialType);
  const profiled = commercial && filled(form.commercialType);

  const items = [
    { done: filled(pt) },
    commercial && { done: filled(form.commercialType) },
    residential && { done: filled(form.bhk) },
    residential && { done: filled(form.bathrooms) },
    residential && { done: filled(form.balconies) },
    { done: filled(form.carpetArea) },
    !land && !commercial && { done: filled(form.builtUp) },
    !land && !commercial && { done: filled(form.superBuiltUp) },
    house && { done: filled(form.plotArea) },
    house && { done: filled(form.floorsInHouse) },
    towered && { done: filled(form.floor) },
    towered && { done: filled(form.totalFloors) },
    { done: filled(form.facing) },
    !land && !commercial && { done: filled(form.age) },
    residential && { done: filled(form.furnishing) },
    residential && furnished && { done: nonEmptyArr(form.furniture) },

    commercial && { done: filled(form.shellType) },
    commercial && { done: filled(form.washrooms) },
    commercial && { done: filled(form.parkingSpaces) },
    profiled && { done: nonEmptyArr(form.suitableFor) },
    profiled && { done: nonEmptyArr(form.fixtures) },
    ...(commercial ? commercialSpecsFor(form.commercialType).map((s) => ({ done: filled(form[s.key]) })) : []),

    // The farm form never renders the pair, so scoring it would dock a blank nobody can fill.
    land && !isFarm && { done: filled(form.plotLength) },
    land && !isFarm && { done: filled(form.plotWidth) },
    land && { done: filled(form.roadWidth) },
    land && !isFarm && { done: filled(form.openSides) },
    land && !isFarm && { done: filled(form.plotZone) },
    land && isFarm && { done: filled(form.waterSource) },
    land && { done: filled(form.naStatus) },
    land && { done: filled(form.otherRights) },
    land && isFarm && isBuy && { done: filled(form.buyerEligibility) },

    { done: filled(form.locality) },
    !land && { done: filled(form.flatNumber) },
    !land && { done: filled(form.tower) },
    !land && { done: !!form.societyId || !!form.societyNotOnMaps },
    { done: filled(form.street) },
    { done: filled(form.landmark) },
    { done: validPin(form.pincode) },

    commercial && { done: filled(form.camCharges) },
    isBuy && { done: filled(form.price) },
    isBuy && !land && !commercial && { done: filled(form.monthlyMaintenance) },
    isBuy && { done: filled(form.ownership) },
    isBuy && commercial && { done: filled(form.tenancyStatus) },
    isBuy && commercial && form.tenancyStatus === 'leased' && { done: filled(form.inPlaceRent) },
    isBuy && commercial && form.tenancyStatus === 'leased' && { done: filled(form.leaseExpiry) },
    isBuy && !land && { done: filled(form.construction) },
    isBuy && !land && (form.construction === 'new' || form.construction === 'under') && { done: filled(form.availableFrom) },
    /* MahaRERA registers the layout, not the NA plot being resold, so the plot keeps the input
     * but the meter must not dock a seller who has no number to give. */
    isBuy && !land && { done: filled(form.reraId) },

    isRent && { done: filled(form.monthlyRent) },
    isRent && { done: filled(form.deposit) },
    isRent && !land && !commercial && { done: filled(form.rentMaintMode) },
    isRent && !land && !commercial && form.rentMaintMode === 'extra' && { done: filled(form.rentMaintenance) },
    isRent && commercial && { done: filled(form.gstOnRent) },
    isRent && commercial && { done: filled(form.fitOutMonths) },
    isRent && commercial && { done: filled(form.escalationPct) },
    isRent && { done: filled(form.availableFrom) },
    isRent && residentialPricing && { done: nonEmptyArr(form.preferredTenants) },
    isRent && { done: filled(form.agreementDuration) },
    isRent && { done: filled(form.lockIn) },
    isRent && { done: filled(form.noticePeriod) },
    isRent && residentialPricing && { done: filled(form.petsPolicy) },
    isRent && residentialPricing && { done: filled(form.foodPref) },

    { frac: Math.min(photos.length, STRONG_PHOTO_COUNT) / STRONG_PHOTO_COUNT, nudge: 'photos' },
    { done: filled(form.description), nudge: 'description' },
    amenityOptions.length > 0 && { done: nonEmptyArr(form.amenities), nudge: 'amenities' },
  ];
  return items.filter(Boolean);
};

const flatmateItems = (form, photos) => [
  { done: filled(form.bhk) },
  { done: filled(form.roomType) },
  { done: filled(form.furnishing) },
  { done: filled(form.locality) },
  { done: !!form.societyId || !!form.societyNotOnMaps },
  { done: filled(form.rentShare) },
  { done: filled(form.deposit) },
  { done: filled(form.availableFrom) },
  { done: filled(form.lookingFor) },
  { done: filled(form.foodPref) },
  { done: nonEmptyArr(form.lifestyle) },
  { frac: Math.min(photos.length, STRONG_PHOTO_COUNT) / STRONG_PHOTO_COUNT, nudge: 'photos' },
  { done: filled(form.note), nudge: 'description' },
];

const TIERS = [
  { threshold: 100, key: 'ready', label: 'Strongest possible listing' },
  { threshold: 80, key: 'almost', label: 'Strong listing' },
  { threshold: 60, key: 'half', label: 'Over halfway!' },
  { threshold: 40, key: 'momentum', label: 'Building momentum' },
  { threshold: 0, key: 'warmup', label: 'Great start' },
];

const NUDGE_ORDER = ['photos', 'description', 'amenities'];
const EMPTY_DEFAULTS = {
  balconies: '1',
  furnishing: 'unfurnished',
  areaUnit: 'sqft',
  propLat: 18.5590,
  propLng: 73.7760,
  pinPlaced: false,
  priceNegotiable: false,
  pantry: false,
  cornerPlot: false,
  boundaryWall: false,
  electricity: false,
  roadAccess: false,
  vegOnly: false,
  petsAllowed: false,
  agreementDuration: '11',
  lockIn: '0',
  noticePeriod: '1',
  bestTimeToCall: 'anytime',
  foodPref: 'any',
  lookingFor: 'any',
  hostRole: 'owner',
  agreementDeclared: false,
  ownerConsent: false,
};

const sameDefault = (value, def) => Array.isArray(def)
  ? Array.isArray(value) && value.length === def.length && value.every((v, i) => v === def[i])
  : value === def;

const hasMeaningfulInput = (form, photos) => {
  if (photos.length) return true;
  return Object.entries(form || {}).some(([key, value]) => {
    if (Object.prototype.hasOwnProperty.call(EMPTY_DEFAULTS, key) && sameDefault(value, EMPTY_DEFAULTS[key])) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'boolean') return value;
    return filled(value);
  });
};

const tierFor = (pct) => {
  const tier = TIERS.find((t) => pct >= t.threshold);
  return { key: tier.key, label: tier.label };
};

export const computeProgress = ({ form, photos = [], isFlatmateMode = false }) => {
  const items = isFlatmateMode
    ? flatmateItems(form, photos)
    : wholePlaceItems(form, photos);
  const total = items.reduce((s, it) => s + (it.weight ?? 1), 0);
  const earned = items.reduce((s, it) => s + (it.weight ?? 1) * fracOf(it), 0);
  const fieldFrac = total ? earned / total : 0;
  const pct = Math.round(100 * fieldFrac);
  const done = items.filter((item) => fracOf(item) === 1).length;
  const tier = tierFor(pct);
  const nudge = !hasMeaningfulInput(form, photos) ? null : NUDGE_ORDER.find((key) =>
    items.some((item) => item.nudge === key && fracOf(item) < 1)) ?? null;
  return { pct: Math.min(100, pct), done, total: items.length, nudge, ...tier };
};
