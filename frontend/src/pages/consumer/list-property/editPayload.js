import { ADDRESS_PARTS, pickListingFormDetails } from '../../../lib/listingFormDetails.js';

const FIELD_INPUTS = {
  title: ['bhk', 'propertyType', 'commercialType', 'locality'],
  type: ['propertyType', 'commercialType'], deal: ['deal'], bhkNum: ['bhk', 'propertyType'],
  price: ['price', 'monthlyRent', 'deal'], deposit: ['deposit', 'deal'],
  maintenance: ['monthlyMaintenance', 'rentMaintenance', 'rentMaintMode', 'deal'],
  negotiable: ['priceNegotiable'], locality: ['locality'],
  lat: ['propLat'], lng: ['propLng'], address: ADDRESS_PARTS, societyId: ['societyId'],
  areaUnit: ['areaUnit'],
  carpetArea: ['carpetArea'], builtUp: ['builtUp'], furnishing: ['furnishing'],
  floor: ['floor'], totalFloors: ['totalFloors'], age: ['age'], construction: ['age'],
  bathrooms: ['bathrooms', 'propertyType'], balconies: ['balconies', 'propertyType'],
  parkingSpaces: ['parkingSpaces'], facing: ['facing'], overlooking: ['overlooking'],
  pincode: ['pincode'], reraId: ['reraId'], electricityConsumerNo: ['electricityConsumerNo'],
  amenities: ['amenities'], desc: ['description'],
};

/* Order-insensitive for arrays: `amenities` is a SET the user toggles, and a chip re-selected in a
   different order is not an edit. Comparing the serialized arrays directly would call that a change
   and widen a deliberately sparse PATCH into one that rewrites untouched fields. */
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
  const changedDetails = Object.fromEntries(Object.entries(pickListingFormDetails(form))
    .filter(([key, value]) => !same(value, before[key])));
  /* A rewritten line must stay fully decomposed, or the next edit recomposes the address out of the
     one box that happened to change and drops the rest. */
  const details = 'address' in fields
    ? { ...changedDetails, ...Object.fromEntries(ADDRESS_PARTS.map((key) => [key, form[key] ?? ''])) }
    : changedDetails;
  const galleryChanged = !same(payload.gallery, original.gallery ?? original.images ?? []);
  // Keep an independently stated headline; only update it when it actually mirrored this input.
  const headlineChanged = !same(form.carpetArea, before.carpetArea)
    && Number(original.area) === Number(before.carpetArea);
  return {
    ...fields,
    ...(headlineChanged && { area: payload.area }),
    ...(Object.keys(details).length && {
      formDetails: { ...pickListingFormDetails(original.formDetails), ...details },
    }),
    ...(galleryChanged && { gallery: payload.gallery, photoHashes: payload.photoHashes }),
  };
}