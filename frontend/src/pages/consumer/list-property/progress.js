/* Listing strength, not completion: "100% complete" on a one-photo listing reads as "nothing left to gain".
   Never a submission gate — validation governs publishing. Booleans are excluded, having no empty state. */

import {
  isLandType, isCommercialType, isResidentialType, isHouseType, commercialSpecsFor,
  badgeDocumentProgress, docsFor, amenitiesFor, STRONG_PHOTO_COUNT,
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
  // The profile-scoped commercial questions do not exist until a subtype is chosen.
  const profiled = commercial && filled(form.commercialType);

  const items = [
    { done: filled(pt) },
    commercial && { done: filled(form.commercialType) },
    residential && { done: filled(form.bhk) },               // BHK
    residential && { done: filled(form.bathrooms) },         // Bathrooms
    residential && { done: filled(form.balconies) },         // Balconies
    { done: filled(form.carpetArea) },                       // Carpet / Plot / Land area *
    !land && !commercial && { done: filled(form.builtUp) },  // Built-up area
    !land && !commercial && { done: filled(form.superBuiltUp) }, // Super built-up area
    house && { done: filled(form.plotArea) },
    house && { done: filled(form.floorsInHouse) },
    towered && { done: filled(form.floor) },
    towered && { done: filled(form.totalFloors) },           // Total floors
    { done: filled(form.facing) },
    // Commercial is not asked its age: `shellType` is the fit-out date that matters to a tenant.
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
    !land && { done: filled(form.flatNumber) },              // Unit / Flat no. *
    !land && { done: filled(form.tower) },                   // Block / tower
    !land && { done: filled(form.society) },                 // Building / project *
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
       but the meter must not dock a seller who has no number to give. */
    isBuy && !land && { done: filled(form.reraId) },

    isRent && { done: filled(form.monthlyRent) },
    isRent && { done: filled(form.deposit) },
    isRent && !land && !commercial && { done: filled(form.rentMaintMode) },
    isRent && !land && !commercial && form.rentMaintMode === 'extra' && { done: filled(form.rentMaintenance) },
    isRent && commercial && { done: filled(form.gstOnRent) },
    isRent && commercial && { done: filled(form.fitOutMonths) },
    isRent && commercial && { done: filled(form.escalationPct) },
    isRent && { done: filled(form.availableFrom) },
    isRent && residentialPricing && { done: nonEmptyArr(form.preferredTenants) }, // Preferred tenants
    isRent && { done: filled(form.agreementDuration) },
    isRent && { done: filled(form.lockIn) },
    isRent && { done: filled(form.noticePeriod) },
    isRent && residentialPricing && { done: filled(form.petsPolicy) }, // Pets policy
    isRent && residentialPricing && { done: filled(form.foodPref) },   // Food preference

    { frac: Math.min(photos.length, STRONG_PHOTO_COUNT) / STRONG_PHOTO_COUNT, nudge: 'photos' },
    { frac: badgeDocumentProgress(form.deal, documents), nudge: 'evidence' },
    optionalDocs.length > 0 && { frac: optionalDone / optionalDocs.length, nudge: 'documents' },
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
  { done: filled(form.society) },
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

/* One nudge, in the order the answers change whether a buyer enquires. More than one reads as a
   checklist the owner is failing, and the meter is not a gate. */
const NUDGE_ORDER = ['photos', 'evidence', 'description', 'amenities', 'documents'];

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
  const nudge = NUDGE_ORDER.find((key) =>
    items.some((item) => item.nudge === key && fracOf(item) < 1)) ?? null;
  return { pct: Math.min(100, pct), done, total: items.length, nudge, ...tierFor(pct) };
};
