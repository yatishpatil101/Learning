import { canonicalTypeKey, matchTypeKey, COMMERCIAL_SUBTYPES } from '../../../data/propertyTypes.js';
import { ADDRESS_PARTS, pickListingFormDetails, splitStoredAddress } from '../../../lib/listingFormDetails.js';

// The catalogue uses shorthand; the public API uses explicit construction and furnishing values.
const CONSTRUCTION_FROM_WIRE = {
  'ready-to-move': 'ready',
  'new-launch': 'new',
  'under-construction': 'under',
};
const CONSTRUCTION_TO_WIRE = Object.fromEntries(
  Object.entries(CONSTRUCTION_FROM_WIRE).map(([wire, ui]) => [ui, wire]),
);
const FURNISHING_FROM_WIRE = {
  unfurnished: 'unfurnished',
  'semi-furnished': 'semi',
  furnished: 'furnished',
};
const FURNISHING_TO_WIRE = Object.fromEntries(
  Object.entries(FURNISHING_FROM_WIRE).map(([wire, ui]) => [ui, wire]),
);

// Filter chips can hold collections; unknown vocabulary is omitted rather than sent as a bad write.
function translateFurnishing(table, value, direction) {
  if (value === undefined || value === null || value === '') return undefined;
  if (value instanceof Set || Array.isArray(value)) {
    const mapped = [...value].map((v) => translateFurnishing(table, v, direction)).filter(Boolean);
    return mapped.length ? mapped : undefined;
  }
  const mapped = table[value];
  if (!mapped) {
    console.warn(
      `[propertyMapper] unrecognised furnishing value "${value}" ${direction}; treating it as not ` +
      'stated. The contract vocabulary has probably changed — update FURNISHING_FROM_WIRE.',
    );
  }
  return mapped;
}

function translateConstruction(table, value, direction) {
  if (value === undefined || value === null || value === '') return undefined;
  const mapped = table[value];
  if (!mapped) {
    console.warn(
      `[propertyMapper] unrecognised possession value "${value}" ${direction}; ` +
      'treating it as not stated. The contract vocabulary has probably changed — update ' +
      'CONSTRUCTION_FROM_WIRE.',
    );
  }
  return mapped;
}

// Callers may hold either catalogue shorthand or the wire's construction vocabulary.
function writePossession(listing) {
  const fromUi = CONSTRUCTION_TO_WIRE[listing.construction];
  if (fromUi) return fromUi;
  if (CONSTRUCTION_FROM_WIRE[listing.possession]) return listing.possession;
  if (listing.construction || listing.possession) {
    console.warn(
      `[propertyMapper] cannot map possession for write (construction="${listing.construction}", ` +
      `possession="${listing.possession}"); omitting it so the request is not rejected.`,
    );
  }
  return undefined;
}

export function toViewModel(p) {
  if (!p) return null;
  return {
    // Routes accept slug-or-id; row operations still need the UUID.
    id: p.slug || p.id,
    uuid: p.id,
    type: p.propertyType,
    image: p.coverImage,
    gallery: p.images ?? [],
    // Summaries carry counts without loading every photo.
    photoCount: p.imageCount ?? (p.images?.length ?? 0),
    video: p.video ?? null,
    desc: p.description,
    bhkNum: p.bhk ?? 0,
    bhk: p.bhk ? `${p.bhk} BHK` : '',
    rera: Boolean(p.reraId),
    reraId: p.reraId ?? '',
    // Unknown amounts must not become an owner's explicit zero when reopening an edit.
    deposit: p.deposit ?? null,
    maintenance: p.maintenance ?? null,
    negotiable: p.negotiable ?? null,
    address: p.address ?? '',
    pincode: p.pincode ?? '',
    electricityConsumerNo: p.electricityMeterNo ?? undefined,
    formDetails: p.formDetails ?? null,
    createdAt: p.createdAt ? String(p.createdAt).slice(0, 10) : undefined,
    // Missing confirmation must leave the freshness reader's createdAt fallback intact.
    freshenedAt: p.lastConfirmedAt ? String(p.lastConfirmedAt).slice(0, 10) : undefined,
    flagReason: p.flagReason ?? '',
    recheckPending: p.recheckPending ?? false,
    recheckReason: p.recheckReason ?? '',
    recheckRequestedAt: p.recheckRequestedAt ?? '',
    // Contact masking is the server's decision, never the mapper's.
    owner: p.owner?.name,
    ownerId: p.owner?.id,
    ownerMobile: p.owner?.mobile,
    slug: p.slug,
    title: p.title,
    deal: p.deal,
    price: p.price,
    priceUnit: p.priceUnit,
    area: p.area,
    areaUnit: p.areaUnit,
    furnishing: translateFurnishing(FURNISHING_FROM_WIRE, p.furnishing, 'from the server') ?? null,
    locality: p.locality,
    localitySlug: p.localitySlug,
    societySlug: p.societySlug,
    societyId: p.societyId ?? null,
    city: p.city,
    lat: p.lat,
    lng: p.lng,
    status: p.status,
    dealStatus: p.dealStatus ?? 'active',
    featured: p.featured ?? false,
    boosted: p.boosted ?? false,
    verified: p.verified ?? false,
    ownerVerified: p.ownerVerified ?? false,
    ownershipVerified: p.ownershipVerified ?? false,
    views: p.views ?? 0,
    enquiries: p.enquiries ?? 0,
    docsCount: p.docsCount ?? 0,
    amenities: p.amenities ?? [],
    archived: p.archived ?? false,
    // Back-office fields are withheld server-side; absence means no visible concierge involvement.
    postedByAdmin: p.adminPipeline?.postedByAdmin ?? false,
    postedByStaff: p.adminPipeline?.postedByStaff ?? null,
    pipelineStage: p.adminPipeline?.pipelineStage ?? null,
    handbackMilestone: p.adminPipeline?.handbackMilestone ?? null,
    claimLinkSent: p.adminPipeline?.claimLinkSent ?? false,
    photosUploaded: p.adminPipeline?.photosUploaded ?? false,
    identityVerified: p.adminPipeline?.identityVerified ?? false,
    reminderCount: p.adminPipeline?.reminderCount ?? 0,
    construction: translateConstruction(CONSTRUCTION_FROM_WIRE, p.possession, 'from the server'),
    // Null means unstated, not a guessed age, direction, count or area ratio.
    landUse: p.landUse ?? null,
    ageYears: p.ageYears ?? null,
    floor: p.floor ?? null,
    totalFloors: p.totalFloors ?? null,
    facing: p.facing ?? null,
    overlooking: p.overlooking ?? null,
    bath: p.bathrooms ?? null,
    parkingSpaces: p.parking ?? null,
    balconies: p.balconies ?? null,
    carpetArea: p.carpetArea ?? null,
    builtUpArea: p.builtUpArea ?? null,
    superBuiltUpArea: p.superBuiltUpArea ?? null,
    floorPlan: p.floorPlan ?? null,
    room: p.room ?? null,
    tenants: Array.isArray(p.tenants) ? p.tenants : [],
    availableFrom: p.availableFrom ?? null,
    pets: p.pets ?? false,
    societyVerified: p.societyVerified ?? false,
    conveyanceDone: p.conveyanceDone ?? false,
    shareType: p.room ? 'flatmates' : null,
  };
}

export const toViewModelList = (payload) =>
  (Array.isArray(payload) ? payload : payload?.content ?? []).map(toViewModel);

export function toQuery(filters = {}, sort = 'newest') {
  return {
    deal: filters.deal,
    type: filters.type,
    locality: filters.locality,
    bhk: filters.bhk,
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
    furnishing: translateFurnishing(FURNISHING_TO_WIRE, filters.furnishing, 'in a filter'),
    possession: translateConstruction(CONSTRUCTION_TO_WIRE, filters.construction, 'in a filter'),
    q: filters.q,
    status: filters.status,
    sort: SORTS[sort] ?? SORTS.newest,
  };
}

const SORTS = {
  newest: 'createdAt,desc',
  oldest: 'createdAt,asc',
  'price-asc': 'price,asc',
  'price-desc': 'price,desc',
  'area-desc': 'area,desc',
};

// Public search cannot widen into privileged moderation reads.
const UNSUPPORTED = ['includeArchived', 'includeAllStatuses', 'real'];
export const unsupportedFilters = (filters = {}) =>
  UNSUPPORTED.filter((k) => filters[k] !== undefined && filters[k] !== false);

export function toModerationQuery(filters = {}, sort = 'newest') {
  return {
    ...toQuery(filters, sort),
    ...Object.fromEntries(['archived', 'recheck', 'featured', 'postedByAdmin', 'unconfirmed']
      .filter((key) => filters[key] !== undefined).map((key) => [key, filters[key]])),
  };
}

const WIZARD_TYPES = { flat: 'flat', house: 'independent', villa: 'villa', commercial: 'commercial', plot: 'openplot', farmland: 'farmland' };
const formString = (value) => value == null ? '' : String(value);

export function toEditForm(vm = {}) {
  const isRent = vm.deal === 'rent';
  const price = formString(vm.price);
  const type = (vm.type ?? '').toLowerCase();
  const commercialType = COMMERCIAL_SUBTYPES.find((subtype) => subtype.matches.some((part) => type.includes(part)))?.key ?? '';
  const typeKey = canonicalTypeKey(type) || Object.keys(WIZARD_TYPES).find((key) => matchTypeKey(key, type));
  const stored = pickListingFormDetails(vm.formDetails);
  // Only a listing saved before the boxes existed has an address left to recover from the line.
  const recovered = ADDRESS_PARTS.some((key) => String(stored[key] ?? '').trim())
    ? null
    : splitStoredAddress(vm.address, { land: typeKey === 'plot' || typeKey === 'farmland' });
  return {
    deal: vm.deal ?? '',
    propertyType: WIZARD_TYPES[typeKey] ?? (Object.values(WIZARD_TYPES).includes(type) ? type : commercialType ? 'commercial' : ''),
    commercialType,
    bhk: vm.bhkNum ? String(vm.bhkNum) : '',
    carpetArea: formString(vm.carpetArea ?? vm.area),
    builtUp: formString(vm.builtUpArea),
    areaUnit: vm.areaUnit ?? '',
    furnishing: vm.furnishing ?? '',
    locality: vm.locality ?? '',
    ...(isRent ? { monthlyRent: price, price: '' } : { price, monthlyRent: '' }),
    deposit: formString(vm.deposit),
    rentMaintenance: isRent ? formString(vm.maintenance) : '',
    monthlyMaintenance: isRent ? '' : formString(vm.maintenance),
    rentMaintMode: isRent && vm.maintenance > 0 ? 'extra' : '',
    priceNegotiable: vm.negotiable ?? '',
    reraId: vm.reraId ?? '',
    description: vm.desc ?? '',
    amenities: vm.amenities ?? [],
    floor: vm.floor === 0 ? 'Ground' : formString(vm.floor),
    totalFloors: formString(vm.totalFloors),
    facing: vm.facing ?? '',
    overlooking: vm.overlooking ?? '',
    age: (vm.construction === 'new' || vm.construction === 'under') ? 'under-construction' : yearsToAgeBand(vm.ageYears),
    bathrooms: formString(vm.bath),
    parkingSpaces: formString(vm.parkingSpaces),
    balconies: formString(vm.balconies),
    electricityConsumerNo: vm.electricityConsumerNo ?? '',
    pincode: vm.pincode ?? '',
    societyId: vm.societyId ?? '',
    propLat: vm.lat ?? '',
    propLng: vm.lng ?? '',
    // No unrelated draft address part survives an edit load.
    existingAddress: vm.address ?? '',
    flatNumber: '', tower: '', society: '', street: '', landmark: '',
    ...recovered,
    ownership: '', agreementDuration: '', lockIn: '', noticePeriod: '', foodPref: '', petsPolicy: vm.pets === true ? 'yes' : '',
    // Search availability is a bucket; handover timing is not construction status.
    availableFrom: '', possession: '',
    plotArea: '', floorsInHouse: '', washrooms: '', shellType: '', camCharges: '',
    plotLength: '', plotWidth: '', openSides: '', roadWidth: '', plotZone: '', waterSource: '',
    loanAvailable: undefined, powerBackup: undefined, pantry: undefined, cornerPlot: undefined,
    boundaryWall: undefined, naSanctioned: undefined, electricity: undefined, roadAccess: undefined, satbara: undefined,
    furniture: [], fixtures: [], suitableFor: [],
    preferredTenants: (vm.tenants ?? []).filter((value) => ['family', 'company', 'bachelors', 'anyone'].includes(value)),
    // A saved answer always outranks a part recovered from the composed line.
    ...stored,
  };
}

// NaN serializes as null, which clears a field; unparseable answers must instead be omitted.
const int = (v) => (v !== '' && v != null && Number.isFinite(Number(v)) ? Number(v) : undefined);
const posInt = (v) => (int(v) || undefined);
const positiveArea = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : undefined;

// The band's lower bound round-trips; under-construction is possession, not a zero-year building.
const AGE_BAND_TO_YEARS = {
  new: 0, '1-5': 1, '5-10': 5, '10-15': 10, '15+': 15,
};
const ageToYears = (band) => (band === 'under-construction' ? undefined : AGE_BAND_TO_YEARS[band]);

export function yearsToAgeBand(years) {
  if (years == null || years === '' || !Number.isFinite(Number(years))) return '';
  const y = Number(years);
  if (y >= 15) return '15+';
  if (y >= 10) return '10-15';
  if (y >= 5) return '5-10';
  if (y >= 1) return '1-5';
  return 'new';
}

// Trust-critical fields (status, owner and priceUnit) are deliberately server-owned.
export function toListingCreate(listing = {}) {
  const composed = ADDRESS_PARTS.map((key) => String(listing[key] ?? '').trim()).filter(Boolean).join(', ');
  return {
    title: listing.title,
    deal: listing.deal,
    propertyType: listing.type ?? listing.propertyType,
    price: listing.price,
    locality: listing.locality,
    city: listing.city ?? 'Pune',
    bhk: listing.bhkNum ?? undefined,
    area: listing.area,
    areaUnit: listing.areaUnit,
    carpetArea: positiveArea(listing.carpetArea),
    builtUpArea: positiveArea(listing.builtUpArea ?? listing.builtUp),
    furnishing: translateFurnishing(FURNISHING_TO_WIRE, listing.furnishing, 'for write'),
    deposit: listing.deposit,
    maintenance: listing.maintenance,
    negotiable: listing.negotiable,
    lat: listing.lat,
    lng: listing.lng,
    reraId: listing.reraId,
    possession: writePossession(listing),
    amenities: listing.amenities,
    images: listing.gallery ?? listing.images,
    description: listing.desc ?? listing.description,
    address: listing.address || composed || undefined,
    pincode: listing.pincode,
    formDetails: listing.formDetails == null ? undefined : pickListingFormDetails(listing.formDetails),
    floor: int(listing.floor),
    // Duplicate detection needs a resolved society id, never a free-text name.
    societyId: listing.societyId || undefined,
    electricityMeterNo: listing.electricityConsumerNo || undefined,
    // An empty PATCH array would erase stored photo evidence when no photo was decoded.
    photoHashes: Array.isArray(listing.photoHashes) && listing.photoHashes.length
      ? listing.photoHashes
      : undefined,
    bathrooms: int(listing.bathrooms),
    parking: int(listing.parkingSpaces),
    balconies: int(listing.balconies),
    facing: listing.facing || undefined,
    overlooking: listing.overlooking || undefined,
    totalFloors: posInt(listing.totalFloors),
    ageYears: ageToYears(listing.age),
  };
}

export function toListingUpdate(patch = {}) {
  // PATCH must not invent a city or compose a partial address from whichever parts happen to arrive.
  return Object.fromEntries(Object.entries(toListingCreate(patch)).filter(([key, value]) =>
    value !== undefined && (key !== 'city' || patch.city !== undefined)
      && (key !== 'address' || patch.address !== undefined)));
}
