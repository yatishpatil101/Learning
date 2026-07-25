/* ---------------------------------------------------------------------------
   Listing completion model.
   Aadhaar verification is the required first step and is worth a fixed 20% of
   the meter — it's the first fifth of the journey, done the moment the owner
   clears the identity gate. The remaining 80% is shared field-by-field across
   every field that applies to the chosen flow (property type + deal), mandatory
   and optional alike. The bar reads 100% only when identity is verified AND
   every applicable field is filled in. Leaving optional fields blank keeps it
   shy of 100% — but it never blocks submission (validation gates only the
   mandatory fields). Fields with sensible defaults (BHK, possession, lease
   terms…) start already "done". Pure booleans/toggles have no empty state, so
   they're excluded.
--------------------------------------------------------------------------- */

import {
  isLandType, isCommercialType, isResidentialType, isHouseType, isPgType,
  requiredDocKeyFor, docsFor, amenitiesFor,
} from './constants.js';

export const MILESTONES = [20, 40, 60, 80, 100];

// Aadhaar identity verification is worth this share of the whole meter; the
// listing fields split the rest. Keeping it explicit makes "20% once Aadhaar is
// done" a single source of truth shared by the meter and the gate.
export const AADHAAR_WEIGHT = 20;

const filled = (v) => v != null && String(v).trim() !== '';
const nonEmptyArr = (v) => Array.isArray(v) && v.length > 0;
const validPin = (v) => /^[1-9]\d{5}$/.test(String(v || ''));

// Each item is worth `weight` (default 1). `frac` (0..1) captures partial
// completion for grouped fields; plain fields collapse to 0/1 via `done`.
const fracOf = (it) => (it.frac != null ? Math.max(0, Math.min(1, it.frac)) : (it.done ? 1 : 0));

const wholePlaceItems = (form, photos, documents, video) => {
  const pt = form.propertyType;
  const isBuy = form.deal === 'buy';
  const isRent = form.deal === 'rent';
  const land = isLandType(pt);
  const commercial = isCommercialType(pt);
  const residential = isResidentialType(pt);
  const pg = isPgType(pt);
  const house = isHouseType(pt);
  const isFarm = pt === 'farmland';
  const towered = pt === 'flat' || commercial;
  const residentialPricing = !land && !commercial;
  const pgResidential = residentialPricing && !pg;
  const furnished = form.furnishing === 'furnished' || form.furnishing === 'semi';

  const allDocs = docsFor(form.deal, pt, form.commercialType);
  const optionalDocs = allDocs.filter((d) => !d.required);
  const optionalDone = optionalDocs.filter((d) => !!documents[d.key]).length;
  const amenityOptions = amenitiesFor(pt, form.commercialType);

  const items = [
    /* ----- Property details ----- */
    { done: filled(pt) },                                    // Property Type *
    commercial && { done: filled(form.commercialType) },     // Commercial Type *
    residential && !pg && { done: filled(form.bhk) },     // BHK
    residential && !pg && { done: filled(form.bathrooms) }, // Bathrooms
    residential && !pg && { done: filled(form.balconies) }, // Balconies
    pg && { done: nonEmptyArr(form.sharing) },            // PG sharing *
    { done: filled(form.carpetArea) },                       // Carpet / Plot / Land / Room area *
    land && { done: filled(form.areaUnit) },                 // Area unit
    !land && !pg && { done: filled(form.builtUp) },          // Built-up area
    house && { done: filled(form.plotArea) },                // Plot area
    house && { done: filled(form.floorsInHouse) },           // Floors in the house
    towered && { done: filled(form.floor) },                 // Floor no.
    towered && { done: filled(form.totalFloors) },           // Total floors
    pg && { done: filled(form.totalFloors) },                // PG no. of floors
    !land && { done: filled(form.facing) },                  // Facing
    !land && { done: filled(form.age) },                     // Age of property
    residential && { done: filled(form.furnishing) },        // Furnishing status
    residential && furnished && { done: nonEmptyArr(form.furniture) }, // Furniture

    // Commercial specifics
    commercial && { done: filled(form.shellType) },          // Fit-out status
    commercial && { done: filled(form.washrooms) },          // Washrooms
    commercial && { done: filled(form.parkingSpaces) },      // Parking spaces
    commercial && { done: filled(form.camCharges) },         // Maintenance / CAM
    commercial && { done: nonEmptyArr(form.suitableFor) },   // Suitable for

    // Land specifics
    land && { done: filled(form.plotLength) },               // Plot length
    land && { done: filled(form.plotWidth) },                // Plot width
    land && { done: filled(form.roadWidth) },                // Approach road width
    land && !isFarm && { done: filled(form.openSides) },     // Open sides
    land && !isFarm && { done: filled(form.plotZone) },      // Zoning
    land && isFarm && { done: filled(form.waterSource) },    // Water source

    /* ----- Location & pricing ----- */
    { done: filled(form.locality) },                         // Locality *
    !land && !pg && { done: filled(form.flatNumber) },       // Unit / Flat no. * (optional for PG)
    !land && !pg && { done: filled(form.tower) },            // Block / tower
    { done: filled(form.society) },                          // Society / project
    { done: filled(form.street) },                           // Street / road
    { done: filled(form.landmark) },                         // Landmark
    { done: validPin(form.pincode) },                        // Pincode *

    // Sale pricing
    isBuy && { done: filled(form.price) },                   // Expected price *
    isBuy && !land && { done: filled(form.monthlyMaintenance) }, // Monthly maintenance
    isBuy && { done: filled(form.ownership) },               // Ownership type *
    isBuy && !land && { done: filled(form.transactionType) }, // Sale type
    isBuy && !land && { done: filled(form.possession) },     // Possession status
    isBuy && !land && form.possession === 'available' && { done: filled(form.availableFrom) },
    isBuy && !isFarm && { done: filled(form.reraId) },       // MahaRERA no. (optional)

    // Rent pricing
    isRent && { done: filled(form.monthlyRent) },            // Monthly rent *
    isRent && { done: filled(form.deposit) },                // Security deposit *
    isRent && !land && { done: filled(form.rentMaintMode) }, // Maintenance mode
    isRent && !land && form.rentMaintMode === 'extra' && { done: filled(form.rentMaintenance) },
    isRent && { done: filled(form.availableFrom) },          // Available from *
    isRent && pgResidential && { done: nonEmptyArr(form.preferredTenants) }, // Preferred tenants
    isRent && pg && { done: filled(form.pgGender) },         // PG is for *
    isRent && pg && { done: filled(form.pgMeals) },          // Meals
    isRent && { done: filled(form.agreementDuration) },      // Agreement duration
    isRent && { done: filled(form.lockIn) },                 // Lock-in period
    isRent && { done: filled(form.noticePeriod) },           // Notice period
    isRent && pgResidential && { done: filled(form.petsPolicy) }, // Pets policy
    isRent && pgResidential && { done: filled(form.foodPref) },   // Food preference

    /* ----- Photos & documents ----- */
    { done: photos.length > 0 },                             // Property photos *
    { done: !!video },                                       // Walkthrough video
    { done: !!documents[requiredDocKeyFor(form.deal, pt)] }, // Required ownership doc *
    optionalDocs.length > 0 && { frac: optionalDone / optionalDocs.length }, // Supporting documents
    { done: filled(form.description) },                      // Description
    amenityOptions.length > 0 && { done: nonEmptyArr(form.amenities) }, // Amenities
  ];
  return items.filter(Boolean);
};

const flatmateItems = (form, photos) => [
  { done: filled(form.bhk) },            // Flat type
  { done: filled(form.roomType) },       // Room offered *
  { done: filled(form.furnishing) },     // Furnishing
  { done: filled(form.locality) },       // Locality *
  { done: filled(form.society) },        // Society / building *
  { done: filled(form.rentShare) },      // Your share of rent *
  { done: filled(form.deposit) },        // Security deposit
  { done: filled(form.availableFrom) },  // Available from *
  { done: filled(form.lookingFor) },     // Looking for
  { done: filled(form.foodPref) },       // Food preference
  { done: nonEmptyArr(form.lifestyle) }, // Lifestyle
  { done: photos.length > 0 },           // Room photos *
  { done: filled(form.note) },           // Short note
];

const TIERS = [
  { threshold: 100, key: 'ready', label: 'Ready to publish', cheer: 'Every field is filled in — your listing is as complete as it gets.' },
  { threshold: 80, key: 'almost', label: 'Almost there', cheer: 'Just a few optional details left to reach 100%.' },
  { threshold: 60, key: 'half', label: 'Over halfway!', cheer: "You're cruising — keep the momentum going." },
  { threshold: 40, key: 'momentum', label: 'Building momentum', cheer: 'Nice progress — this is quicker than it looks.' },
  { threshold: 0, key: 'warmup', label: 'Great start', cheer: "The hard part's done — the rest is easy." },
];

const tierFor = (pct) => {
  const tier = TIERS.find((t) => pct >= t.threshold);
  return { key: tier.key, label: tier.label, cheer: tier.cheer };
};

export const computeProgress = ({ form, photos = [], documents = {}, video = null, aadhaarVerified = false, isFlatmateMode = false }) => {
  const items = isFlatmateMode
    ? flatmateItems(form, photos)
    : wholePlaceItems(form, photos, documents, video);
  const total = items.reduce((s, it) => s + (it.weight ?? 1), 0);
  const earned = items.reduce((s, it) => s + (it.weight ?? 1) * fracOf(it), 0);
  const fieldFrac = total ? earned / total : 0;
  // Aadhaar is the first 20%; the listing fields fill the remaining 80%.
  const pct = Math.round(AADHAAR_WEIGHT * (aadhaarVerified ? 1 : 0) + (100 - AADHAAR_WEIGHT) * fieldFrac);
  return { pct: Math.min(100, pct), ...tierFor(pct) };
};
