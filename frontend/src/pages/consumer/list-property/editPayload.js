import { ADDRESS_PARTS, canStateBuyerEligibility, pickListingFormDetails } from '../../../lib/listingFormDetails.js';

const FIELD_INPUTS = {
  title: ['title', 'bhk', 'propertyType', 'commercialType', 'locality'],
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
  amenities: ['amenities'], desc: ['description'], video: ['youtubeId'],
};

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
  /* A plot re-typed to a flat has no zoning to send, and an omitted key means "leave it alone",
   * so without this the old zoning survives and keeps answering zoning filters. */
  const clearsLandUse = 'landUse' in fields
    && fields.landUse === undefined && original.landUse != null;
  const currentDetails = pickListingFormDetails(payload.formDetails ?? form);
  const carriesBuyerEligibility = canStateBuyerEligibility(form);
  const removesLoanAvailable = Object.hasOwn(form, 'loanAvailable')
    && (form.loanAvailable === '' || form.loanAvailable == null)
    && 'loanAvailable' in pickListingFormDetails(original.formDetails);
  const storedDetails = Object.fromEntries(Object.entries(pickListingFormDetails(original.formDetails))
    .filter(([key]) => (carriesBuyerEligibility || key !== 'buyerEligibility')
      && !(removesLoanAvailable && key === 'loanAvailable')));
  const removesBuyerEligibility = !carriesBuyerEligibility && 'buyerEligibility' in pickListingFormDetails(original.formDetails);
  const propertyTypeChanged = !same(form.propertyType, before.propertyType);
  const changedDetails = Object.fromEntries(Object.entries(currentDetails)
    .filter(([key, value]) => !same(value, before[key]) || (key === 'furniture' && 'amenities' in fields)));
  /* A rewritten line must stay fully decomposed, or the next edit recomposes the address out of
   * the one box that happened to change and drops the rest. */
  const details = 'address' in fields
    ? { ...changedDetails, ...Object.fromEntries(ADDRESS_PARTS.map((key) => [key, form[key] ?? ''])) }
    : changedDetails;
  const gallery = original.gallery ?? original.images ?? [];
  const galleryChanged = !same(payload.gallery, gallery);
  const storedPlan = original.floorPlan ?? '';
  const newPlan = payload.floorPlan ?? '';
  const planWasTaggable = gallery.includes(storedPlan);
  const floorPlanChanged = newPlan !== storedPlan && (newPlan !== '' || planWasTaggable);
  const headlineChanged = !same(form.carpetArea, before.carpetArea)
    && Number(original.area) === Number(before.carpetArea);
  return {
    ...fields,
    ...(clearsMaintenance && { clearMaintenance: true }),
    ...(clearsLandUse && { clearLandUse: true }),
    ...(headlineChanged && { area: payload.area }),
    ...(propertyTypeChanged
      ? { formDetails: currentDetails }
      : (Object.keys(details).length || removesBuyerEligibility || removesLoanAvailable)
        && { formDetails: { ...storedDetails, ...details } }),
    ...(galleryChanged && { gallery: payload.gallery }),
    ...(floorPlanChanged && { floorPlan: newPlan }),
  };
}
