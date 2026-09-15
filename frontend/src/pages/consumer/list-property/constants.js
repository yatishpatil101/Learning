import {
  ShieldCheck,
  Tv, Refrigerator, Sofa, Shirt, BedDouble, CookingPot, WashingMachine, AirVent,
  Microwave, Utensils, ShowerHead, Fan, Blinds, Droplets, Lamp, Flame,
  Waves, Dumbbell, Zap, ArrowUpDown, Landmark, Trees, Footprints,
  Briefcase, Goal, Blocks, Armchair,
  Bike, Car
} from 'lucide-react';
import { localityNames, localityCoordMap } from '../../../data/localities.js';

/* ---------- static option data ---------- */
/* Locality identity is owned by the canonical registry (data/localities.js).
   Both the shortlist and the offline centre-coords derive from it so "Search an
   area" works instantly/offline; free-text queries still fall back to live
   geocoding, and a live Google pick refines the exact pin. */
export const localities = localityNames();
export const localityCoords = localityCoordMap();
/* Separate choices let owners state both compass direction and view. */
export const facingOptions = ['East', 'West', 'North', 'South'];
export const overlookingOptions = ['Garden', 'Amenity', 'Parking', 'Main Road'];
export const ageOptions = [
  { value: 'under-construction', label: 'Under Construction' },
  { value: 'new', label: 'New (less than 1 year)' },
  { value: '1-5', label: '1 - 5 years' },
  { value: '5-10', label: '5 - 10 years' },
  { value: '10-15', label: '10 - 15 years' },
  { value: '15+', label: '15+ years' },
];
export const ownershipOptions = ['Freehold', 'Leasehold', 'Co-operative Society', 'Power of Attorney'];
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

/* Commercial leases run far longer than residential — years, not months — with
   longer lock-ins and notice periods. Values stored in months so downstream
   parsing stays consistent with the residential lists. */
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

export const furnitureItems = [
  { label: 'TV', Icon: Tv }, { label: 'Refrigerator', Icon: Refrigerator }, { label: 'Sofa', Icon: Sofa },
  { label: 'Wardrobe', Icon: Shirt }, { label: 'Bed', Icon: BedDouble }, { label: 'Kitchen Trolley', Icon: CookingPot },
  { label: 'Washing Machine', Icon: WashingMachine }, { label: 'AC', Icon: AirVent }, { label: 'Microwave', Icon: Microwave },
  { label: 'Dining Table', Icon: Utensils }, { label: 'Geyser', Icon: ShowerHead }, { label: 'Fans', Icon: Fan },
  { label: 'Curtains', Icon: Blinds }, { label: 'Water Purifier', Icon: Droplets }, { label: 'Light Fittings', Icon: Lamp },
  { label: 'Chimney', Icon: Flame },
];
export const amenitiesList = [
  { label: 'Swimming Pool', Icon: Waves }, { label: 'Gym', Icon: Dumbbell },
  { label: '2-Wheeler Parking', Icon: Bike }, { label: '4-Wheeler Parking', Icon: Car },
  { label: 'Smart Security', Icon: ShieldCheck }, { label: 'Power Backup', Icon: Zap }, { label: 'Lift', Icon: ArrowUpDown },
  { label: 'Club House', Icon: Landmark }, { label: 'Garden', Icon: Trees }, { label: 'Jogging Track', Icon: Footprints },
  { label: 'Co-Working Spaces', Icon: Briefcase }, { label: 'Sports Court', Icon: Goal }, { label: 'Kids Play Zone', Icon: Blocks },
  { label: 'Senior Seating', Icon: Armchair },
];
export const lifestyleTags = ['Non-smoker', 'Early riser', 'Night owl', 'Pet-friendly', 'Working professional', 'Student', 'Fitness', 'Vegetarian'];

// Badge evidence is optional for publishing; only staff can grant the badge after review.
const badgeDocsFor = (deal) => [
  { key: 'Electricity Bill', label: 'Electricity Bill', cta: 'Upload original MSEDCL PDF', hint: 'Download the original bill from MSEDCL. No photos, scans or print-to-PDF copies. Keep it under 1 MB; we preserve the original bytes.', verifies: true, originalPdf: true },
  { key: 'Property Tax Receipt', label: 'Property Tax Receipt', cta: 'Upload Tax Receipt', hint: 'Use a current property-tax receipt instead of the electricity bill.', verifies: true },
  ...(deal === 'rent' ? [] : [{ key: 'Index II', label: 'Index II', cta: 'Upload Index II', hint: 'For a sale, include Index II as well as a current bill or tax receipt. A sale deed is supporting evidence only.', verifies: true }]),
];

export const badgeDocumentProgress = (deal, documents = {}) => {
  const address = Number(!!(documents['Electricity Bill'] || documents['Property Tax Receipt']));
  return deal === 'rent' ? address : (address + Number(!!documents['Index II'])) / 2;
};

export const saleDocs = [
  ...badgeDocsFor('buy'),
  { key: 'Agreement to Sale', label: 'Registered Agreement for Sale', cta: 'Upload Agreement for Sale' },
  { key: 'Sale Deed', label: 'Registered Sale Deed', cta: 'Upload Sale Deed' },
  { key: 'Occupancy Certificate', label: 'Occupancy Certificate', cta: 'Upload Occupancy Certificate' },
  { key: 'Share Certificate', label: 'Share Certificate', cta: 'Upload Share Certificate' },
  { key: 'Society Registration Certificate', label: 'Society Registration Certificate', cta: 'Upload Society Certificate' },
  { key: 'Sanctioned Building Plan', label: 'Approved Plan Copy', cta: 'Upload Approved Plan' },
  { key: 'Conveyance Deed', label: 'Conveyance Deed', cta: 'Upload Conveyance Deed' },
  { key: 'Maintenance Bill', label: 'Maintenance Bill', cta: 'Upload Maintenance Bill' },
  { key: 'Builder Payment Receipts', label: 'Payment Receipts from Builder', cta: 'Upload Payment Receipts' },
];
export const rentDocs = [
  ...badgeDocsFor('rent'),
  { key: 'Society NOC', label: 'Society NOC', cta: 'Upload Society NOC', hint: 'Keep your society’s no-objection certificate with the property records.' },
];

/* ---------- property-type model ----------
   Single source of truth for the "Post a property" flow. The dropdown order,
   the Step-1 field groups, validation, progress and admin all read from here,
   so a type only has to be described once. */
export const PROPERTY_TYPES = [
  { value: 'flat', label: 'Flat / Apartment' },
  { value: 'independent', label: 'Independent House' },
  { value: 'villa', label: 'Villa' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'openplot', label: 'Open Plot' },
  { value: 'farmland', label: 'Farm Land' },
];

export const COMMERCIAL_SUBTYPES = [
  { value: 'office', label: 'Office Space' },
  { value: 'shop', label: 'Shop / Showroom' },
  { value: 'retail', label: 'Retail / Mall Unit' },
  { value: 'warehouse', label: 'Warehouse / Godown' },
  { value: 'industrial', label: 'Industrial / Factory' },
  { value: 'coworking', label: 'Co-working Space' },
];

export const TYPE_CONFIG = {
  flat: { group: 'residential', house: false, areaLabel: 'Carpet Area' },
  independent: { group: 'residential', house: true, areaLabel: 'Carpet Area' },
  villa: { group: 'residential', house: true, premium: true, areaLabel: 'Carpet Area' },
  commercial: { group: 'commercial', areaLabel: 'Carpet Area', subtypes: COMMERCIAL_SUBTYPES },
  openplot: { group: 'land', land: 'plot', areaLabel: 'Plot Area' },
  farmland: { group: 'land', land: 'farm', areaLabel: 'Land Area' },
};

export const groupOf = (t) => TYPE_CONFIG[t]?.group || 'residential';
export const isResidentialType = (t) => groupOf(t) === 'residential';
export const isCommercialType = (t) => groupOf(t) === 'commercial';
export const isLandType = (t) => groupOf(t) === 'land';
export const isHouseType = (t) => !!TYPE_CONFIG[t]?.house;

/* Non-residential type keys. Legacy 'plot' is kept so listings saved before the
   Open Plot / Farm Land split still classify correctly. */
export const NONRES = ['commercial', 'openplot', 'farmland', 'plot'];

/* ---------- commercial + land option data ---------- */
export const shellOptions = [['bareShell', 'Bare Shell'], ['warmShell', 'Warm Shell'], ['furnished', 'Furnished']];
export const washroomOptions = ['1', '2', '3', '4+'];
export const suitableForTags = ['Office', 'Retail', 'Restaurant', 'Clinic', 'Showroom', 'Warehouse', 'Bank / ATM', 'Gym / Studio'];
export const plotZoneOptions = ['Residential', 'Commercial', 'Industrial', 'Agricultural', 'Mixed-Use'];
export const openSidesOptions = ['1', '2', '3', '4'];
export const plotUnitOptions = [['sqft', 'sq.ft.'], ['sqyd', 'sq.yd.'], ['guntha', 'Guntha']];
export const farmUnitOptions = [['acre', 'Acre'], ['guntha', 'Guntha'], ['hectare', 'Hectare']];
export const waterSourceOptions = ['Borewell', 'Open Well', 'Canal', 'Municipal', 'River / Stream', 'None'];

/* ---------- commercial use-profiles ----------
   The six commercial subtypes collapse into three profiles that actually differ
   in what buyers/tenants need to see: workspace (office, co-working),
   retail (shop, showroom, mall unit) and industrial (warehouse, factory). */
export const commercialProfileOf = (subtype) => {
  if (subtype === 'shop' || subtype === 'retail') return 'retail';
  if (subtype === 'warehouse' || subtype === 'industrial') return 'industrial';
  return 'workspace'; // office, coworking, or not-yet-picked
};

/* ---------- commercial fixtures (per use-profile) ----------
   Owner-declared, sub-type-specific fit-out a business seeker actually evaluates — a
   warehouse's loading bay vs an office's server room vs a shop's frontage. Scoped by the
   same three profiles as commercialProfileOf so a warehouse never offers "Reception". */
export const COMMERCIAL_FIXTURES = {
  workspace: ['Server / UPS Room', 'Meeting Cabins', 'Reception Area', 'Conference Room', 'False Ceiling', 'Central AC'],
  retail: ['Main-Road Frontage', 'Display Windows', 'Rolling Shutter', 'Signage Space', 'Mezzanine Floor', 'Customer Washroom'],
  industrial: ['Loading Bay / Dock', 'High Ceiling', '3-Phase Power', 'Wide Truck Access', 'Crane / Gantry Support', 'Covered Yard'],
};

/* Options for the fixtures multi-select, given the chosen commercial subtype value. */
export const fixturesFor = (subtype) => COMMERCIAL_FIXTURES[commercialProfileOf(subtype)];

/* Resolve a stored subtype value OR its display label (seed listings persist only the label
   in `type`) to a use-profile — with a keyword fallback for legacy strings. */
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

// Supporting records vary by property type; the badge requirements do not.
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
/* Extra, profile-specific compliance documents appended to the commercial base set. */
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
// Agricultural records remain useful supporting evidence, not substitutes for the badge set.
export const plotSaleDocs = [
  ...badgeDocsFor('buy'),
  { key: '7/12 Extract', label: '7/12 Extract (Satbara)', cta: 'Upload 7/12 Extract' },
  { key: 'Mutation Entry', label: 'Mutation Entry (Ferfar)', cta: 'Upload Mutation Extract' },
  { key: 'NA Order', label: 'NA Order / Zone Certificate', cta: 'Upload NA Order', hint: 'Confirms the plot is sanctioned for non-agricultural use.' },
];
export const plotRentDocs = [
  ...badgeDocsFor('rent'),
  { key: '7/12 Extract', label: '7/12 Extract (Satbara)', cta: 'Upload 7/12 Extract' },
];
export const farmSaleDocs = [
  ...badgeDocsFor('buy'),
  { key: '7/12 Extract', label: '7/12 Extract (Satbara)', cta: 'Upload 7/12 Extract' },
  { key: '8A Extract', label: '8A Extract (Holding Record)', cta: 'Upload 8A Extract', hint: 'Village holding record confirming the cultivator’s account.' },
  { key: 'Mutation Entry', label: 'Mutation Entry (Ferfar)', cta: 'Upload Mutation Extract' },
  { key: 'Land Revenue Receipt', label: 'Land Revenue / Tax Receipt', cta: 'Upload Revenue Receipt' },
];
export const farmRentDocs = [
  ...badgeDocsFor('rent'),
  { key: '7/12 Extract', label: '7/12 Extract (Satbara)', cta: 'Upload 7/12 Extract' },
  { key: 'Land Revenue Receipt', label: 'Land Revenue / Tax Receipt (optional)', cta: 'Upload Revenue Receipt' },
];

export const docsFor = (deal, propertyType, commercialType) => {
  if (deal === 'buy') {
    if (isLandType(propertyType)) return propertyType === 'farmland' ? farmSaleDocs : plotSaleDocs;
    if (isCommercialType(propertyType)) return [...commercialSaleDocs, ...commercialProfileDocs[commercialProfileOf(commercialType)].buy];
    return saleDocs;
  }
  if (isLandType(propertyType)) return propertyType === 'farmland' ? farmRentDocs : plotRentDocs;
  if (isCommercialType(propertyType)) return [...commercialRentDocs, ...commercialProfileDocs[commercialProfileOf(commercialType)].rent];
  return rentDocs;
};

/* ---------- type-aware photo categories ---------- */
const RESIDENTIAL_PHOTO_CATS = ['Living Room', 'Kitchen', 'Bedroom', 'Bathroom', 'Balcony', 'Exterior / Building', 'Floor Plan', 'Other'];
const COMMERCIAL_PHOTO_CATS = {
  workspace: ['Frontage / Entrance', 'Reception', 'Workstation Area', 'Cabins / Meeting Rooms', 'Pantry', 'Washroom', 'Parking', 'Floor Plan', 'Other'],
  retail: ['Frontage / Display', 'Signage', 'Interior', 'Storage / Back Office', 'Washroom', 'Parking', 'Floor Plan', 'Other'],
  industrial: ['Frontage / Gate', 'Loading Bay', 'Interior / Shop Floor', 'Office Cabin', 'Power / Utility', 'Yard / Access', 'Washroom', 'Floor Plan', 'Other'],
};
const COMMERCIAL_KEY_CATS = {
  workspace: ['Frontage / Entrance', 'Workstation Area', 'Parking'],
  retail: ['Frontage / Display', 'Interior', 'Parking'],
  industrial: ['Frontage / Gate', 'Loading Bay', 'Yard / Access'],
};
const PLOT_PHOTO_CATS = ['Front / Entrance', 'Road / Access', 'Corner / Boundary', 'Surroundings', 'Layout Plan', 'Other'];
const FARM_PHOTO_CATS = ['Front / Entrance', 'Road / Access', 'Water Source', 'Boundary', 'Surroundings', 'Layout Plan', 'Other'];

export const photoCategoriesFor = (propertyType, commercialType) => {
  if (isLandType(propertyType)) return propertyType === 'farmland' ? FARM_PHOTO_CATS : PLOT_PHOTO_CATS;
  if (isCommercialType(propertyType)) return COMMERCIAL_PHOTO_CATS[commercialProfileOf(commercialType)];
  return RESIDENTIAL_PHOTO_CATS;
};
export const keyPhotoCategoriesFor = (propertyType, commercialType) => {
  if (isLandType(propertyType)) return ['Front / Entrance', 'Road / Access', 'Surroundings'];
  if (isCommercialType(propertyType)) return COMMERCIAL_KEY_CATS[commercialProfileOf(commercialType)];
  return ['Living Room', 'Kitchen', 'Bedroom', 'Bathroom'];
};

/* ---------- type-aware amenities ----------
   Raw land has no amenities (section hidden); each commercial profile gets a
   relevant subset (a godown shouldn't advertise a club house or co-working). */
const COMMERCIAL_AMENITY_LABELS = {
  workspace: ['2-Wheeler Parking', '4-Wheeler Parking', 'Power Backup', 'Lift', 'Smart Security', 'Co-Working Spaces', 'Club House'],
  retail: ['2-Wheeler Parking', '4-Wheeler Parking', 'Power Backup', 'Lift', 'Smart Security'],
  industrial: ['2-Wheeler Parking', '4-Wheeler Parking', 'Power Backup', 'Smart Security'],
};
export const amenitiesFor = (propertyType, commercialType) => {
  if (isLandType(propertyType)) return [];
  if (isCommercialType(propertyType)) {
    const labels = COMMERCIAL_AMENITY_LABELS[commercialProfileOf(commercialType)];
    return amenitiesList.filter((a) => labels.includes(a.label));
  }
  return amenitiesList;
};
