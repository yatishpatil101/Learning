import { ADDRESS_PARTS, pickListingFormDetails } from '../../../lib/listingFormDetails.js';

const FIELD_INPUTS = {
  title: ['bhk', 'propertyType', 'commercialType', 'locality'],
  type: ['propertyType', 'commercialType'], deal: ['deal'], bhkNum: ['bhk', 'propertyType'],
  price: ['price', 'monthlyRent', 'deal'], deposit: ['deposit', 'deal'],
  maintenance: ['monthlyMaintenance', 'rentMaintenance', 'rentMaintMode', 'deal'], tenants: ['preferredTenants'],
  negotiable: ['priceNegotiable'], locality: ['locality'],
  lat: ['propLat'], lng: ['propLng'], address: ADDRESS_PARTS, societyId: ['societyId'],
  areaUnit: ['areaUnit'],
  landUse: ['propertyType', 'plotZone'],
  carpetArea: ['carpetArea'], builtUp: ['builtUp'], superBuiltUp: ['superBuiltUp'],
  available: ['availableFrom'], furnishing: ['furnishing'], pets: ['petsPolicy'],
  floor: ['floor'], totalFloors: ['totalFloors'], age: ['age'], construction: ['construction'],
  bathrooms: ['bathrooms', 'propertyType'], balconies: ['balconies', 'propertyType'],
  parkingSpaces: ['parkingSpaces'], facing: ['facing'], overlooking: ['overlooking'],
  pincode: ['pincode'], reraId: ['reraId'], electricityConsumerNo: ['electricityConsumerNo'],
  amenities: ['amenities'], desc: ['description'],
};

/* Order-insensitive for arrays: `amenities` is a set the user toggles, and a chip re-selected in a different
   order is not an edit — calling it one widens a deliberately sparse PATCH into a full rewrite. */
const same = (a, b) => (Array.isArray(a) && Array.isArray(b)
  ? a.length === b.length && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
  : JSON.stringify(a) === JSON.stringify(b));

// Patch only edited answers: age bands and legacy headline areas cannot roundtrip losslessly.
export function editPayload(payload, form, original) {
  const before = original.form;
  if (before.builtUp && !form.builtUp) {
    throw new Error('Enter a built-up area. A previously saved measurement cannot be cleared here.');
  }
  const fields = Object.fromEntries(Object.entries(FIELD_INPUTS)
    .filter(([, inputs]) => inputs.some((key) => !same(form[key], before[key])))
    .map(([key]) => [key, payload[key]]));
  const clearsMaintenance = 'maintenance' in fields
    && fields.maintenance === undefined && original.maintenance != null;
  /* A plot re-typed to a flat has no zoning to send, and an omitted key means "leave it alone" —
     so without this word the old zoning survives and goes on answering the Land-use filter. */
  const clearsLandUse = 'landUse' in fields
    && fields.landUse === undefined && original.landUse != null;
  const currentDetails = payload.formDetails ?? pickListingFormDetails(form);
  const propertyTypeChanged = !same(form.propertyType, before.propertyType);
  const changedDetails = Object.fromEntries(Object.entries(currentDetails)
    .filter(([key, value]) => !same(value, before[key])));
  /* A rewritten line must stay fully decomposed, or the next edit recomposes the address out of the
     one box that happened to change and drops the rest. */
  const details = 'address' in fields
    ? { ...changedDetails, ...Object.fromEntries(ADDRESS_PARTS.map((key) => [key, form[key] ?? ''])) }
    : changedDetails;
  const gallery = original.gallery ?? original.images ?? [];
  const galleryChanged = !same(payload.gallery, gallery);
  /* The plan is a tag on a photo, so it lives in `photos` and cannot be a `FIELD_INPUTS` entry. Blank means
     withdrawn, except on a listing whose stored plan is not one of its photos and so had no control. */
  const storedPlan = original.floorPlan ?? '';
  const newPlan = payload.floorPlan ?? '';
  const planWasTaggable = gallery.includes(storedPlan);
  const floorPlanChanged = newPlan !== storedPlan && (newPlan !== '' || planWasTaggable);
  // Keep an independently stated headline; only update it when it actually mirrored this input.
  const headlineChanged = !same(form.carpetArea, before.carpetArea)
    && Number(original.area) === Number(before.carpetArea);
  return {
    ...fields,
    ...(clearsMaintenance && { clearMaintenance: true }),
    ...(clearsLandUse && { clearLandUse: true }),
    ...(headlineChanged && { area: payload.area }),
    ...(propertyTypeChanged
      ? { formDetails: currentDetails }
      : Object.keys(details).length && { formDetails: { ...pickListingFormDetails(original.formDetails), ...details } }),
    ...(galleryChanged && { gallery: payload.gallery, photoHashes: payload.photoHashes }),
    ...(floorPlanChanged && { floorPlan: newPlan }),
  };
}