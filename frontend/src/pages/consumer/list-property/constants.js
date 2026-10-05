import {
  ShieldCheck,
  Tv, Refrigerator, Sofa, Shirt, BedDouble, CookingPot, WashingMachine, AirVent,
  Microwave, Utensils, ShowerHead, Fan, Blinds, Droplets, Lamp, Flame, ChefHat,
  Waves, Dumbbell, Zap, ArrowUpDown, Landmark, Trees, Footprints,
  Briefcase, Goal, Blocks, Armchair,
  Bike, Car
} from 'lucide-react';
import { localityNames, localityCoordMap } from '../../../data/localities.js';

export const localities = localityNames();
export const localityCoords = localityCoordMap();
export const facingOptions = ['East', 'West', 'North', 'South'];
export const overlookingOptions = ['Garden', 'Amenity', 'Parking', 'Main Road'];
export const ageOptions = [
  { value: 'new', label: 'New (less than 1 year)' },
  { value: '1-5', label: '1 - 5 years' },
  { value: '5-10', label: '5 - 10 years' },
  { value: '10-15', label: '10 - 15 years' },
  { value: '15+', label: '15+ years' },
];
export const ownershipOptions = ['Freehold', 'Leasehold', 'Co-operative Society', 'Power of Attorney'];
/* Commercial branch only — a flat is never held this way. */
export const commercialOwnershipOptions = [...ownershipOptions, 'MIDC / Industrial Lease'];
export const floorOptions = ['Ground', ...Array.from({ length: 50 }, (_, i) => String(i + 1))];
export const totalFloorsOptions = Array.from({ length: 50 }, (_, i) => String(i + 1));
export const agreementOptions = [
  { value: '11', label: '11 months' }, { value: '6', label: '6 months' },
  { value: '12', label: '12 months' }, { value: '24', label: '24 months' }, { value: 'long', label: 'Long term' },
];
export const lockinOptions = [
  { value: '0', label: 'None' }, { value: '1', label: '1 month' },
  { value: '2', label: '2 months' }, { value: '3', label: '3 months' }, { value: '6', label: '6 months' },
];
export const noticeOptions = [{ value: '1', label: '1 month' }, { value: '2', label: '2 months' }, { value: '3', label: '3 months' }];

export const commercialAgreementOptions = [
  { value: '36', label: '3 years' }, { value: '60', label: '5 years' },
  { value: '108', label: '9 years' }, { value: '120', label: '10+ years' },
  { value: '12', label: '1 year' }, { value: 'long', label: 'Long term' },
];
export const commercialLockinOptions = [
  { value: '0', label: 'None' }, { value: '12', label: '1 year' },
  { value: '24', label: '2 years' }, { value: '36', label: '3 years' }, { value: '60', label: '5 years' },
];
export const commercialNoticeOptions = [
  { value: '1', label: '1 month' }, { value: '2', label: '2 months' },
  { value: '3', label: '3 months' }, { value: '6', label: '6 months' },
];

/* A plot or farm is let by the year, never on the 11-month tenancy the Rent Act shapes a flat's
 * lease around. */
export const landAgreementOptions = [
  { value: '12', label: '1 year' }, { value: '36', label: '3 years' },
  { value: '60', label: '5 years' }, { value: '108', label: '9 years' },
  { value: '120', label: '10+ years' }, { value: 'long', label: 'Long term' },
];
export const landLockinOptions = [
  { value: '0', label: 'None' }, { value: '12', label: '1 year' },
  { value: '24', label: '2 years' }, { value: '36', label: '3 years' },
];
export const landNoticeOptions = [
  { value: '1', label: '1 month' }, { value: '3', label: '3 months' }, { value: '6', label: '6 months' },
];

export const LEASE_DEFAULTS = {
  residential: { agreementDuration: '11', lockIn: '0', noticePeriod: '1' },
  commercial: { agreementDuration: '12', lockIn: '0', noticePeriod: '1' },
  land: { agreementDuration: '12', lockIn: '0', noticePeriod: '1' },
};

/* Shared with the desk console so the same owner is never quoted different norms for the same
 * property. */
export const DEPOSIT_MONTHS = {
  residential: [2, 3], commercial: [3, 4], land: [6, 12],
};

export const furnitureItems = [
  { label: 'TV', Icon: Tv }, { label: 'Refrigerator', Icon: Refrigerator }, { label: 'Sofa', Icon: Sofa },
  { label: 'Wardrobe', Icon: Shirt }, { label: 'Bed', Icon: BedDouble }, { label: 'Kitchen Trolley', Icon: CookingPot },
  { label: 'Washing Machine', Icon: WashingMachine }, { label: 'AC', Icon: AirVent }, { label: 'Microwave', Icon: Microwave },
  { label: 'Dining Table', Icon: Utensils }, { label: 'Geyser', Icon: ShowerHead }, { label: 'Fans', Icon: Fan },
  { label: 'Curtains', Icon: Blinds }, { label: 'Water Purifier', Icon: Droplets }, { label: 'Light Fittings', Icon: Lamp },
  { label: 'Chimney', Icon: Flame }, { label: 'Modular Kitchen', Icon: ChefHat },
];
export const amenitiesList = [
  { label: 'Swimming Pool', Icon: Waves }, { label: 'Gym', Icon: Dumbbell },
  { label: '2-Wheeler Parking', Icon: Bike }, { label: '4-Wheeler Parking', Icon: Car },
  { label: 'Smart Security', Icon: ShieldCheck }, { label: 'Power Backup', Icon: Zap }, { label: 'Lift', Icon: ArrowUpDown },
  { label: 'Club House', Icon: Landmark }, { label: 'Garden', Icon: Trees }, { label: 'Jogging Track', Icon: Footprints },
  { label: 'Co-Working Spaces', Icon: Briefcase }, { label: 'Sports Court', Icon: Goal }, { label: 'Kids Play Zone', Icon: Blocks },
  { label: 'Senior Seating', Icon: Armchair }, { label: 'Piped Gas', Icon: Flame },
];
export const SOCIETY_AMENITY_LABELS = [
  'Swimming Pool', 'Gym', '2-Wheeler Parking', '4-Wheeler Parking', 'Smart Security', 'Power Backup',
  'Lift', 'Club House', 'Garden', 'Jogging Track', 'Sports Court', 'Kids Play Zone', 'Senior Seating', 'Piped Gas',
];
const LEGACY_IN_FLAT_AMENITIES = { 'Modular Kitchen': 'Modular Kitchen', AC: 'AC', Wardrobes: 'Wardrobe', 'Water Purifier': 'Water Purifier', Geyser: 'Geyser' };
export const withInFlatAsFurniture = (listing) => {
  const amenities = listing.amenities || [];
  const moved = amenities.filter((a) => Object.hasOwn(LEGACY_IN_FLAT_AMENITIES, a));
  if (!moved.length) return listing;
  return {
    ...listing,
    amenities: amenities.filter((a) => !moved.includes(a)),
    furniture: [...new Set([...(listing.furniture || []), ...moved.map((a) => LEGACY_IN_FLAT_AMENITIES[a])])],
  };
};
export const lifestyleTags = ['Non-smoker', 'Early riser', 'Night owl', 'Pet-friendly', 'Working professional', 'Student', 'Fitness', 'Vegetarian'];

const lightBillDoc = (deal) => ({
  key: 'Electricity Bill',
  i18n: 'lightBill',
  verifies: deal === 'rent',
  supporting: deal === 'buy',
  recommended: deal === 'rent',
});
const propertyTaxDoc = (deal) => ({
  key: 'Property Tax Receipt',
  i18n: 'propertyTax',
  verifies: deal === 'rent',
  supporting: deal === 'buy',
});
const titleProofDocsFor = (propertyType) => {
  if (propertyType === 'farmland') {
    return [
      { key: '7/12 Extract', i18n: 'satbara', verifies: true },
      { key: '8A Extract', i18n: 'eightA', verifies: true },
    ];
  }
  if (propertyType === 'openplot') {
    return [
      { key: '7/12 Extract', i18n: 'satbara', verifies: true },
      { key: '8A Extract', i18n: 'eightA', verifies: true },
      { key: 'Property Card', i18n: 'propertyCard', verifies: true },
    ];
  }
  return [
    { key: 'Index II', i18n: 'indexII', verifies: true },
    { key: 'Share Certificate', i18n: 'shareCertificate', verifies: true },
  ];
};

export const badgeDocsFor = (deal, propertyType) => {
  const titleDocs = titleProofDocsFor(propertyType);
  if (propertyType === 'openplot' || propertyType === 'farmland' || propertyType === 'plot') return titleDocs;
  return deal === 'rent'
    ? [lightBillDoc(deal), ...titleDocs, propertyTaxDoc(deal)]
    : [...titleDocs, propertyTaxDoc(deal), lightBillDoc(deal)];
};

export const badgeDocumentProgress = (deal, propertyType, documents = {}) => {
  const titleKeys = titleProofDocsFor(propertyType).map((doc) => doc.key);
  if (deal === 'rent') {
    const keys = badgeDocsFor(deal, propertyType).filter((doc) => doc.verifies).map((doc) => doc.key);
    return Number(keys.some((key) => documents[key]));
  }
  return Number(titleKeys.some((key) => documents[key]));
};

export const saleDocs = [
  ...badgeDocsFor('buy'),
];
export const rentDocs = [
  ...badgeDocsFor('rent'),
];

export const PROPERTY_TYPES = [
  { value: 'flat', label: 'Flat / Apartment' },
  { value: 'independent', label: 'Independent House' },
  { value: 'villa', label: 'Villa' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'openplot', label: 'Open Plot' },
  { value: 'farmland', label: 'Farm Land' },
];

/* Co-working is absent because it is transacted per seat per month and this wizard collects one
 * lump rent. */
export const COMMERCIAL_SUBTYPES = [
  { value: 'office', label: 'Office Space' },
  { value: 'shop', label: 'Shop / Showroom' },
  { value: 'retail', label: 'Retail / Mall Unit' },
  { value: 'warehouse', label: 'Warehouse / Godown' },
  { value: 'industrial', label: 'Industrial / Factory' },
];

const RETIRED_COMMERCIAL_SUBTYPES = [{ value: 'coworking', label: 'Co-working Space' }];
export const commercialSubtypeOptions = (current) => {
  const retired = RETIRED_COMMERCIAL_SUBTYPES.find((s) => s.value === current);
  return retired ? [...COMMERCIAL_SUBTYPES, retired] : COMMERCIAL_SUBTYPES;
};
export const commercialLabelOf = (value) => commercialSubtypeOptions(value).find((s) => s.value === value)?.label || '';

export const TYPE_CONFIG = {
  flat: { group: 'residential', house: false },
  independent: { group: 'residential', house: true },
  villa: { group: 'residential', house: true, premium: true },
  commercial: { group: 'commercial' },
  openplot: { group: 'land', land: 'plot' },
  farmland: { group: 'land', land: 'farm' },
};

export const groupOf = (t) => TYPE_CONFIG[t]?.group || 'residential';
export const isResidentialType = (t) => groupOf(t) === 'residential';
export const isCommercialType = (t) => groupOf(t) === 'commercial';
export const isLandType = (t) => groupOf(t) === 'land';
export const isHouseType = (t) => !!TYPE_CONFIG[t]?.house;

/* The flatmate wizard's home-type pills, as one `[propertyType, label]` list because the two are halves of a single
   answer and the server stores both. */
export const HOME_TYPE_PILLS = [
  ['flat', 'Flat'],
  ['independent', 'Independent House'],
  ['villa', 'Villa'],
  ['independent', 'Row House'],
];
export const homeTypeLabelFor = (t) => HOME_TYPE_PILLS.find(([pt]) => pt === t)?.[1] || '';

export const leaseKindOf = (t) => (isCommercialType(t) ? 'commercial' : isLandType(t) ? 'land' : 'residential');

export const NONRES = ['commercial', 'openplot', 'farmland', 'plot'];

export const shellOptions = [['bareShell', 'Bare Shell'], ['warmShell', 'Warm Shell'], ['furnished', 'Furnished']];
export const washroomOptions = ['1', '2', '3', '4+'];
/* The full set the server's `ListingFormDetails` accepts. */
export const suitableForTags = ['Office', 'Retail', 'Restaurant', 'Clinic', 'Showroom', 'Warehouse', 'Bank / ATM', 'Gym / Studio'];
/* "Residential" alone cannot distinguish an R1 plot from an R2 one — a difference of FSI and
 * permitted height, which is why a buyer asks. */
export const plotZoneOptions = [
  'Residential (R1)', 'Residential (R2)', 'Commercial (C-1)', 'Industrial (I-1)',
  'Public / Semi-public', 'Mixed-Use', 'Agriculture Zone', 'Green Zone / No-Development Zone',
];
export const openSidesOptions = ['1', '2', '3', '4'];

/* `plotZone` is the owner's label; `landUse` is the column the Land-use filter reads. */
const LAND_USE_BY_ZONE = {
  'Residential (R1)': 'residential', 'Residential (R2)': 'residential',
  'Commercial (C-1)': 'commercial', 'Industrial (I-1)': 'industrial',
  'Public / Semi-public': 'mixed', 'Mixed-Use': 'mixed',
  'Agriculture Zone': 'agricultural', 'Green Zone / No-Development Zone': 'agricultural',
  Residential: 'residential', Commercial: 'commercial', Industrial: 'industrial',
  Agricultural: 'agricultural',
};

export const landUseFor = (propertyType, plotZone) => {
  if (!isLandType(propertyType)) return undefined;
  return TYPE_CONFIG[propertyType]?.land === 'farm' ? 'agricultural' : LAND_USE_BY_ZONE[plotZone];
};

export const plotUnitOptions = [['sqft', 'sq.ft.'], ['sqyd', 'sq.yd.'], ['sqm', 'sq.m.'], ['guntha', 'Guntha']];
export const farmUnitOptions = [['acre', 'Acre'], ['guntha', 'Guntha'], ['hectare', 'Hectare']];
export const landUnitOptionsFor = (propertyType) => (
  TYPE_CONFIG[propertyType]?.land === 'farm' ? farmUnitOptions : plotUnitOptions
);
export const defaultAreaUnitFor = (propertyType) => (
  TYPE_CONFIG[propertyType]?.land === 'farm' ? 'guntha' : 'sqft'
);

/* Bounds per unit, because the number means nothing without one: a floor of 1 on Acre refuses
 * most farm inventory and a ceiling of 1,000,000 on Acre accepts a district. */
const NON_LAND_AREA_RANGE = [1, 1000000];
const AREA_RANGE_BY_UNIT = {
  sqft: [100, 1000000],
  sqyd: [10, 110000],
  sqm: [10, 93000],
  guntha: [1, 4000],
  acre: [0.1, 100],
  hectare: [0.04, 40],
};
export const areaRangeFor = (propertyType, areaUnit) => (
  isLandType(propertyType) ? (AREA_RANGE_BY_UNIT[areaUnit] ?? NON_LAND_AREA_RANGE) : NON_LAND_AREA_RANGE
);

export const waterSourceOptions = ['Borewell', 'Open Well', 'Canal', 'Municipal', 'River / Stream', 'None'];

export const naStatusOptions = [
  { value: 'agricultural', label: 'Still agricultural (no NA)' },
  { value: 'deemed', label: 'Deemed NA (s.42B / 42C)' },
  { value: 'sanctioned', label: 'NA order sanctioned' },
];

/* Every parcel has a 7/12; what decides whether a buyer needs a title search is the Other
 * Rights column. */
export const otherRightsOptions = [
  { value: 'clear', label: 'Clear — no entries in Other Rights' },
  { value: 'mortgage', label: 'Mortgage / bank charge entered' },
  { value: 'tenancy', label: 'Kul / protected tenant entered' },
  { value: 'minor', label: 'Minor or heir entry' },
  { value: 'dispute', label: 'Boundary or ownership dispute' },
  { value: 'unknown', label: 'Not checked yet' },
];

/* A buyer who discovers this at the sub-registrar has lost the deal and the deposit. */
export const buyerEligibilityOptions = [
  { value: 'agriculturist', label: 'Agriculturist buyer only' },
  { value: 'permission', label: 'Non-agriculturist buyer — needs s.63(1A) Collector permission' },
  { value: 'converted', label: 'NA-converted — no agriculturist restriction' },
  { value: 'unknown', label: 'Not sure' },
];

export const commercialProfileOf = (subtype) => {
  if (subtype === 'shop' || subtype === 'retail') return 'retail';
  if (subtype === 'warehouse' || subtype === 'industrial') return 'industrial';
  /* Not-yet-picked is its own answer: every lookup below is keyed on the profile, so defaulting to 'workspace' offers
     a warehouse owner office fixtures before they have chosen anything. */
  return subtype ? 'workspace' : null;
};

const NO_OPTIONS = [];

/* Scoped by the same three profiles as commercialProfileOf so a warehouse never offers
 * "Reception". */
export const COMMERCIAL_FIXTURES = {
  workspace: ['Server / UPS Room', 'Meeting Cabins', 'Reception Area', 'Conference Room', 'False Ceiling', 'Central AC'],
  retail: ['Main-Road Frontage', 'Display Windows', 'Rolling Shutter', 'Signage Space', 'Mezzanine Floor', 'Customer Washroom'],
  industrial: ['Loading Bay / Dock', 'High Ceiling', '3-Phase Power', 'Wide Truck Access', 'Crane / Gantry Support', 'Covered Yard'],
};

export const fixturesFor = (subtype) => COMMERCIAL_FIXTURES[commercialProfileOf(subtype)] ?? NO_OPTIONS;

/* The businesses each profile can actually house, drawn from `suitableForTags` so every offered
 * value stays inside the server's own set. */
const COMMERCIAL_SUITABLE_FOR = {
  workspace: ['Office', 'Clinic', 'Bank / ATM'],
  retail: ['Retail', 'Showroom', 'Restaurant', 'Clinic', 'Gym / Studio', 'Bank / ATM'],
  industrial: ['Warehouse', 'Showroom'],
};
export const suitableForFor = (subtype) => COMMERCIAL_SUITABLE_FOR[commercialProfileOf(subtype)] ?? NO_OPTIONS;

/* Physical specs scoped per use-profile so a shop is never asked its floor load. */
const COMMERCIAL_SPECS = {
  workspace: [{ key: 'seatCount', unit: '', ph: 'eg40', max: 4 }],
  retail: [{ key: 'frontage', unit: 'ft', ph: 'eg30', max: 4 }],
  industrial: [
    { key: 'floorLoad', unit: 'T/sq.m', ph: 'eg4', max: 4 },
    { key: 'clearHeight', unit: 'ft', ph: 'eg30', max: 4 },
    { key: 'sanctionedPower', unit: 'KVA', ph: 'eg60', max: 6 },
    { key: 'dockCount', unit: '', ph: 'eg4', max: 3 },
  ],
};
export const commercialSpecsFor = (subtype) => COMMERCIAL_SPECS[commercialProfileOf(subtype)] ?? NO_OPTIONS;
/* Every spec key across every profile: what a type switch has to clear, and what the write
 * spreads onto the wire. */
export const COMMERCIAL_SPEC_KEYS = Object.values(COMMERCIAL_SPECS).flat().map((s) => s.key);

export const fitOutOptions = [
  { value: '0', label: 'None' }, { value: '1', label: '1 month' }, { value: '2', label: '2 months' },
  { value: '3', label: '3 months' }, { value: '6', label: '6 months' },
];
/* A leased asset is bought for its yield, so the buyer needs the rent in place and the date the
 * lease runs to; a vacant one is bought for its use. */
export const tenancyStatusOptions = [['vacant', 'Vacant'], ['leased', 'Leased / Tenanted']];

/* Resolve a stored subtype value OR its display label (seed listings persist only the label in
 * `type`) to a use-profile — with a keyword fallback for legacy strings. */
export const commercialProfileFromType = (valueOrLabel) => {
  if (!valueOrLabel) return 'workspace';
  const byValue = COMMERCIAL_SUBTYPES.find((s) => s.value === valueOrLabel);
  if (byValue) return commercialProfileOf(byValue.value);
  const byLabel = COMMERCIAL_SUBTYPES.find((s) => s.label === valueOrLabel);
  if (byLabel) return commercialProfileOf(byLabel.value);
  const s = String(valueOrLabel).toLowerCase();
  if (/(shop|showroom|retail|mall)/.test(s)) return 'retail';
  if (/(warehouse|godown|industrial|factory)/.test(s)) return 'industrial';
  return 'workspace';
};

export const commercialSaleDocs = [
  ...badgeDocsFor('buy'),
  { key: 'Occupancy Certificate', label: 'Occupancy / Completion Certificate', cta: 'Upload OC' },
  { key: 'Sanctioned Building Plan', label: 'Sanctioned Building Plan', cta: 'Upload Approved Plan' },
  { key: 'Fire NOC', label: 'Fire / Trade NOC', cta: 'Upload NOC', hint: 'Required for most commercial usage — reassures serious tenants and buyers.' },
];
export const commercialRentDocs = [
  ...badgeDocsFor('rent'),
  { key: 'Fire NOC', label: 'Fire / Trade NOC', cta: 'Upload NOC', hint: 'Supporting compliance records for business tenants.' },
];
const commercialProfileDocs = {
  workspace: { buy: [], rent: [] },
  retail: {
    buy: [{ key: 'Shop Act License', label: 'Shop Act (Gumasta) License', cta: 'Upload Shop Act License', hint: 'Maharashtra trade licence for a retail establishment.' }],
    rent: [{ key: 'Shop Act License', label: 'Shop Act License (optional)', cta: 'Upload Shop Act License', hint: 'Speeds up a retail tenant’s own licensing.' }],
  },
  industrial: {
    buy: [
      { key: 'MPCB Consent', label: 'MPCB (Pollution) Consent', cta: 'Upload MPCB Consent', hint: 'Consent to Operate from the Maharashtra Pollution Control Board.' },
      { key: 'Factory License', label: 'Factory License', cta: 'Upload Factory License', hint: 'Required to run a manufacturing / industrial unit.' },
    ],
    rent: [{ key: 'MPCB Consent', label: 'MPCB Consent (optional)', cta: 'Upload MPCB Consent', hint: 'Reassures manufacturing tenants the site is compliant.' }],
  },
};
/* The NA Order slot is on all four land sets because the conversion question is asked of both
 * branches in both deals. */
const naOrderDoc = { key: 'NA Order', label: 'NA Order / Zone Certificate', cta: 'Upload NA Order', hint: 'Confirms the plot is sanctioned for non-agricultural use.' };
export const plotSaleDocs = [
  ...badgeDocsFor('buy', 'openplot'),
  { key: 'Mutation Entry', label: 'Mutation Entry (Ferfar)', cta: 'Upload Mutation Extract' },
  naOrderDoc,
];
export const plotRentDocs = [
  ...badgeDocsFor('rent', 'openplot'),
  naOrderDoc,
];
export const farmSaleDocs = [
  ...badgeDocsFor('buy', 'farmland'),
  { key: 'Mutation Entry', label: 'Mutation Entry (Ferfar)', cta: 'Upload Mutation Extract' },
  { key: 'Land Revenue Receipt', label: 'Land Revenue / Tax Receipt', cta: 'Upload Revenue Receipt' },
  naOrderDoc,
];
export const farmRentDocs = [
  ...badgeDocsFor('rent', 'farmland'),
  { key: 'Land Revenue Receipt', label: 'Land Revenue / Tax Receipt (optional)', cta: 'Upload Revenue Receipt' },
  naOrderDoc,
];

export const docsFor = (deal, propertyType, commercialType) => {
  if (deal === 'buy') {
    if (isLandType(propertyType)) return propertyType === 'farmland' ? farmSaleDocs : plotSaleDocs;
    if (isCommercialType(propertyType)) return [...commercialSaleDocs, ...(commercialProfileDocs[commercialProfileOf(commercialType)]?.buy ?? [])];
    return saleDocs;
  }
  if (isLandType(propertyType)) return propertyType === 'farmland' ? farmRentDocs : plotRentDocs;
  if (isCommercialType(propertyType)) return [...commercialRentDocs, ...(commercialProfileDocs[commercialProfileOf(commercialType)]?.rent ?? [])];
  return rentDocs;
};

/* Not merely a label: tagging a photo with it is how an owner states "this is my unit's plan",
 * and `submit.js` reads it into `floorPlan`. */
export const FLOOR_PLAN_CATEGORY = 'Floor Plan';
const RESIDENTIAL_PHOTO_CATS = ['Living Room', 'Kitchen', 'Bedroom', 'Bathroom', 'Balcony', 'Exterior / Building', FLOOR_PLAN_CATEGORY, 'Other'];
const COMMERCIAL_PHOTO_CATS = {
  workspace: ['Frontage / Entrance', 'Reception', 'Workstation Area', 'Cabins / Meeting Rooms', 'Pantry', 'Washroom', 'Parking', FLOOR_PLAN_CATEGORY, 'Other'],
  retail: ['Frontage / Display', 'Signage', 'Interior', 'Storage / Back Office', 'Washroom', 'Parking', FLOOR_PLAN_CATEGORY, 'Other'],
  industrial: ['Frontage / Gate', 'Loading Bay', 'Interior / Shop Floor', 'Office Cabin', 'Power / Utility', 'Yard / Access', 'Washroom', FLOOR_PLAN_CATEGORY, 'Other'],
};
const COMMERCIAL_KEY_CATS = {
  workspace: ['Frontage / Entrance', 'Workstation Area', 'Parking'],
  retail: ['Frontage / Display', 'Interior', 'Parking'],
  industrial: ['Frontage / Gate', 'Loading Bay', 'Yard / Access'],
};
const PLOT_PHOTO_CATS = ['Front / Entrance', 'Road / Access', 'Corner / Boundary', 'Surroundings', 'Layout Plan', 'Other'];
const FARM_PHOTO_CATS = ['Front / Entrance', 'Road / Access', 'Water Source', 'Boundary', 'Surroundings', 'Layout Plan', 'Other'];
/* "Surroundings" is excluded: it is the one land category that can be shot without standing on the land, and a parcel
   is bought on where its edges run, not on a photograph of the horizon. */
const PLOT_KEY_CATS = ['Corner / Boundary', 'Layout Plan', 'Road / Access'];
const FARM_KEY_CATS = ['Boundary', 'Layout Plan', 'Road / Access'];

export const photoCategoriesFor = (propertyType, commercialType) => {
  if (isLandType(propertyType)) return propertyType === 'farmland' ? FARM_PHOTO_CATS : PLOT_PHOTO_CATS;
  if (isCommercialType(propertyType)) return COMMERCIAL_PHOTO_CATS[commercialProfileOf(commercialType)] ?? NO_OPTIONS;
  return RESIDENTIAL_PHOTO_CATS;
};
export const keyPhotoCategoriesFor = (propertyType, commercialType) => {
  if (isLandType(propertyType)) return propertyType === 'farmland' ? FARM_KEY_CATS : PLOT_KEY_CATS;
  if (isCommercialType(propertyType)) return COMMERCIAL_KEY_CATS[commercialProfileOf(commercialType)] ?? NO_OPTIONS;
  return ['Living Room', 'Kitchen', 'Bedroom', 'Bathroom'];
};

export const MIN_PUBLISH_PHOTOS = 1;
export const MIN_PUBLISH_KEY_CATEGORIES = 2;
export const STRONG_PHOTO_COUNT = 5;

const RESIDENTIAL_AMENITIES = amenitiesList.filter((a) => SOCIETY_AMENITY_LABELS.includes(a.label));
const COMMERCIAL_AMENITY_LABELS = {
  workspace: ['2-Wheeler Parking', '4-Wheeler Parking', 'Power Backup', 'Lift', 'Smart Security', 'Co-Working Spaces', 'Club House'],
  retail: ['2-Wheeler Parking', '4-Wheeler Parking', 'Power Backup', 'Lift', 'Smart Security'],
  industrial: ['2-Wheeler Parking', '4-Wheeler Parking', 'Power Backup', 'Smart Security'],
};
export const amenitiesFor = (propertyType, commercialType) => {
  if (isLandType(propertyType)) return [];
  if (isCommercialType(propertyType)) {
    const labels = COMMERCIAL_AMENITY_LABELS[commercialProfileOf(commercialType)];
    return labels ? amenitiesList.filter((a) => labels.includes(a.label)) : NO_OPTIONS;
  }
  return RESIDENTIAL_AMENITIES;
};
