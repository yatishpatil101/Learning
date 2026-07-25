/* ---------- default form state ---------- */
export const initialForm = {
  deal: 'buy',
  propertyType: '',
  commercialType: '',
  // Smart defaults — Pune's most common configuration, pre-filled to reduce
  // friction (endowed-progress). All remain editable.
  bhk: '2',
  // PG / Hostel occupancy — a PG usually offers several (single … dormitory), so
  // this is a multi-select array. Each selected type carries its own rent below.
  sharing: [],
  // Per-occupancy monthly rent, keyed by sharing type (e.g. { single: '12000' }).
  // The headline monthlyRent is derived as the cheapest of these (starting price).
  sharingRents: {},
  // PG / Hostel: who the PG is for, and whether meals are provided. Sensible
  // defaults (open to anyone, no meals) keep the flow quick but editable.
  pgGender: 'any',
  pgMeals: 'none',
  bathrooms: '2',
  balconies: '1',
  carpetArea: '',
  builtUp: '',
  // house types (independent / villa)
  plotArea: '',
  floorsInHouse: '',
  // flatmate home type — a room share can be a flat OR an independent house /
  // villa / row house. propertyType drives the physical fields; homeTypeLabel is
  // the exact label shown on the room card. gatedCommunity applies to houses.
  homeTypeLabel: 'Flat',
  gatedCommunity: false,
  // flatmate washroom — is the offered room's bathroom private (attached) or a
  // shared/common one? A top question for room seekers.
  attachedBath: '',
  // commercial specifics
  washrooms: '',
  shellType: '',
  parkingSpaces: '',
  powerBackup: false,
  pantry: false,
  camCharges: '',
  suitableFor: [],
  fixtures: [],
  // land specifics (open plot / farm land)
  areaUnit: 'sqft',
  plotLength: '',
  plotWidth: '',
  openSides: '',
  roadWidth: '',
  cornerPlot: false,
  boundaryWall: false,
  plotZone: '',
  naSanctioned: false,
  waterSource: '',
  electricity: false,
  roadAccess: false,
  satbara: false,
  floor: '',
  totalFloors: '',
  facing: '',
  age: '',
  furnishing: 'unfurnished',
  furniture: [],
  locality: '',
  flatNumber: '',
  tower: '',
  society: '',
  // Society ENTITY binding (societies.js / community-minted). Empty when the
  // lister typed a name without picking/creating a society (legacy-safe).
  societyId: '',
  street: '',
  landmark: '',
  pincode: '',
  // Property identity (duplicate prevention + ownership verification). The
  // electricity consumer number is unique per metered unit and works for rent
  // and buy alike, so it doubles as the strongest dedup key and the fast-track
  // to the Verified Owner badge. pmcPropertyId (tax-receipt PTIN) is a secondary
  // strong key. Both are optional and never shown to buyers.
  electricityConsumerNo: '',
  pmcPropertyId: '',
  propLat: 18.5590,
  propLng: 73.7760,
  price: '',
  priceNegotiable: false,
  transactionType: '',
  possession: 'ready',
  ownership: '',
  monthlyMaintenance: '',
  reraId: '',
  loanAvailable: true,
  monthlyRent: '',
  deposit: '',
  rentMaintMode: 'included',
  rentMaintenance: '',
  availableFrom: '',
  preferredTenants: [],
  vegOnly: false,
  petsAllowed: false,
  petsPolicy: '',
  foodPref: 'any',
  agreementDuration: '11',
  lockIn: '0',
  noticePeriod: '1',
  description: '',
  amenities: [],
  // flatmate
  roomType: '',
  rentShare: '',
  lookingFor: 'any',
  lifestyle: [],
  note: '',
  // flatmate host eligibility — who is listing this room. 'owner' lists their own
  // flat room-by-room; 'tenant' is a sitting flatmate seeking a replacement and
  // self-attests a registered agreement (+ optional owner mobile for Ops consent).
  hostRole: 'owner',
  agreementDeclared: false,
  agreementDoc: null,
  ownerConsentMobile: '',
};
