// Completion includes optional fields to encourage fuller listings, independently of submission
// validation. Booleans are excluded because they have no empty state; populated defaults count.

import {
  isLandType, isCommercialType, isResidentialType, isHouseType,
  badgeDocumentProgress, docsFor, amenitiesFor,
} from './constants.js';

export const MILESTONES = [20, 40, 60, 80, 100];

const filled= (v) => v != null && String(v).trim() !== '';
const nonEmptyArr = (v) => Array.isArray(v) && v.length > 0;
const validPin = (v) => /^[1-9]\d{5}$/.test(String(v || ''));

// Grouped fields earn partial credit so one supporting document need not complete the group.
const fracOf = (it) => (it.frac != null ? Math.max(0, Math.min(1, it.frac)) : (it.done ? 1 : 0));

const wholePlaceItems = (form, photos, documents) => {
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

  const allDocs = docsFor(form.deal, pt, form.commercialType);
  const optionalDocs = allDocs.filter((d) => !d.verifies);
  const optionalDone = optionalDocs.filter((d) => !!documents[d.key]).length;
  const amenityOptions = amenitiesFor(pt, form.commercialType);

  const items = [
    { done: filled(pt) },
    commercial && { done: filled(form.commercialType) },
    residential && { done: filled(form.bhk) },               // BHK
    residential && { done: filled(form.bathrooms) },         // Bathrooms
    residential && { done: filled(form.balconies) },         // Balconies
    { done: filled(form.carpetArea) },                       // Carpet / Plot / Land area *
    land && { done: filled(form.areaUnit) },                 // Area unit
    !land && { done: filled(form.builtUp) },                 // Built-up area
    house && { done: filled(form.plotArea) },
    house && { done: filled(form.floorsInHouse) },
    towered && { done: filled(form.floor) },
    towered && { done: filled(form.totalFloors) },           // Total floors
    !land && { done: filled(form.facing) },
    !land && { done: filled(form.age) },
    residential && { done: filled(form.furnishing) },
    residential && furnished && { done: nonEmptyArr(form.furniture) },

    commercial && { done: filled(form.shellType) },
    commercial && { done: filled(form.washrooms) },
    commercial && { done: filled(form.parkingSpaces) },
    commercial && { done: filled(form.camCharges) },
    commercial && { done: nonEmptyArr(form.suitableFor) },

    land && { done: filled(form.plotLength) },
    land && { done: filled(form.plotWidth) },
    land && { done: filled(form.roadWidth) },
    land && !isFarm && { done: filled(form.openSides) },
    land && !isFarm && { done: filled(form.plotZone) },
    land && isFarm && { done: filled(form.waterSource) },

    { done: filled(form.locality) },
    !land && { done: filled(form.flatNumber) },              // Unit / Flat no. *
    !land && { done: filled(form.tower) },                   // Block / tower
    { done: filled(form.society) },
    { done: filled(form.street) },
    { done: filled(form.landmark) },
    { done: validPin(form.pincode) },

    isBuy && { done: filled(form.price) },
    isBuy && !land && { done: filled(form.monthlyMaintenance) },
    isBuy && { done: filled(form.ownership) },
    isBuy && !land && { done: filled(form.possession) },
    isBuy && !land && form.possession === 'available' && { done: filled(form.availableFrom) },
    isBuy && !isFarm && { done: filled(form.reraId) },

    isRent && { done: filled(form.monthlyRent) },
    isRent && { done: filled(form.deposit) },
    isRent && !land && { done: filled(form.rentMaintMode) },
    isRent && !land && form.rentMaintMode === 'extra' && { done: filled(form.rentMaintenance) },
    isRent && { done: filled(form.availableFrom) },
    isRent && residentialPricing && { done: nonEmptyArr(form.preferredTenants) }, // Preferred tenants
    isRent && { done: filled(form.agreementDuration) },
    isRent && { done: filled(form.lockIn) },
    isRent && { done: filled(form.noticePeriod) },
    isRent && residentialPricing && { done: filled(form.petsPolicy) }, // Pets policy
    isRent && residentialPricing && { done: filled(form.foodPref) },   // Food preference

    { done: photos.length > 0 },
    { frac: badgeDocumentProgress(form.deal, documents) },
    optionalDocs.length > 0 && { frac: optionalDone / optionalDocs.length },
    { done: filled(form.description) },
    amenityOptions.length > 0 && { done: nonEmptyArr(form.amenities) },
  ];
  return items.filter(Boolean);
};

const flatmateItems = (form, photos) => [
  { done: filled(form.bhk) },
  { done: filled(form.roomType) },
  { done: filled(form.furnishing) },
  { done: filled(form.locality) },
  { done: filled(form.society) },
  { done: filled(form.rentShare) },
  { done: filled(form.deposit) },
  { done: filled(form.availableFrom) },
  { done: filled(form.lookingFor) },
  { done: filled(form.foodPref) },
  { done: nonEmptyArr(form.lifestyle) },
  { done: photos.length > 0 },
  { done: filled(form.note) },
];

const TIERS = [
  { threshold: 100, key: 'ready', label: 'Ready to publish' },
  { threshold: 80, key: 'almost', label: 'Almost there' },
  { threshold: 60, key: 'half', label: 'Over halfway!' },
  { threshold: 40, key: 'momentum', label: 'Building momentum' },
  { threshold: 0, key: 'warmup', label: 'Great start' },
];

const tierFor = (pct) => {
  const tier = TIERS.find((t) => pct >= t.threshold);
  return { key: tier.key, label: tier.label };
};

export const computeProgress = ({ form, photos = [], documents = {}, isFlatmateMode = false }) => {
  const items = isFlatmateMode
    ? flatmateItems(form, photos)
    : wholePlaceItems(form, photos, documents);
  const total = items.reduce((s, it) => s + (it.weight ?? 1), 0);
  const earned = items.reduce((s, it) => s + (it.weight ?? 1) * fracOf(it), 0);
  const fieldFrac = total ? earned / total : 0;
  const pct = Math.round(100 * fieldFrac);
  const done = items.filter((item) => fracOf(item) === 1).length;
  return { pct: Math.min(100, pct), done, total: items.length, ...tierFor(pct) };
};
