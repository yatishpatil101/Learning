export const initialForm = {
  deal: 'buy',
  propertyType: '',
  commercialType: '',
  // Smart defaults — Pune's most common configuration, pre-filled to reduce
  // friction (endowed-progress). All remain editable.
  bhk: '2',
  bathrooms: '2',
  balconies: '1',
  carpetArea: '',
  builtUp: '',
  superBuiltUp: '',
  plotArea: '',
  floorsInHouse: '',
  // A room share can be a flat or an independent house, so `propertyType` drives the physical
  // fields while `homeTypeLabel` is the exact label on the room card.
  homeTypeLabel: 'Flat',
  gatedCommunity: false,
  // flatmate washroom — is the offered room's bathroom private (attached) or a
  // shared/common one? A top question for room seekers.
  attachedBath: '',
  /* The flat's occupancy ledger and the terms a seeker asks about in the first message. Blank
     means "the host did not say", which is not the same answer as a stated zero. */
  occupants: '',
  maxOccupants: '',
  noticePeriodDays: '',
  lockInMonths: '',
  maintenanceBilling: '',
  electricityBilling: '',
  washrooms: '',
  shellType: '',
  parkingSpaces: '',
  /* No `powerBackup`: it is a commercial amenity offered in all three profile lists, and a second control
     here made one fact answerable twice. Absent means "unstated"; `toEditForm` still carries a stored value. */
  pantry: false,
  camCharges: '',
  suitableFor: [],
  fixtures: [],
  gstOnRent: '',
  fitOutMonths: '',
  escalationPct: '',
  tenancyStatus: '',
  inPlaceRent: '',
  leaseExpiry: '',
  seatCount: '',
  frontage: '',
  floorLoad: '',
  clearHeight: '',
  sanctionedPower: '',
  dockCount: '',
  /* A plot default. A farm has no square feet on its unit list, so `changePropertyType` swaps this for
     `defaultAreaUnitFor(type)`; keeping 'sqft' would post a farm out by three orders of magnitude. */
  areaUnit: 'sqft',
  plotLength: '',
  plotWidth: '',
  openSides: '',
  roadWidth: '',
  cornerPlot: false,
  boundaryWall: false,
  plotZone: '',
  /* Unanswered. A boolean could not tell "still agricultural" from "never asked", and had no way
     at all to say deemed-NA. Legacy listings keep their stored `naSanctioned`. */
  naStatus: '',
  waterSource: '',
  electricity: false,
  roadAccess: false,
  /* What the 7/12's Other Rights column says, replacing a "7/12 available" toggle that every
     parcel could answer yes to. */
  otherRights: '',
  buyerEligibility: '',
  floor: '',
  totalFloors: '',
  facing: '',
  overlooking: '',
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
  // The electricity consumer number is unique per metered unit, so it is both the strongest dedup
  // key and the fast-track to Verified Owner. Optional, and never shown to buyers.
  electricityConsumerNo: '',
  pmcPropertyId: '',
  propLat: 18.5590,
  propLng: 73.7760,
  /* The coordinates above are a map default (Baner centre) and Baner's own canonical coords are
     identical, so nothing can tell a chosen spot from an untouched one. Record the placement. */
  pinPlaced: false,
  price: '',
  priceNegotiable: false,
  transactionType: '',
  /* Unanswered: this is the field the Ready-to-Move / Under-Construction facet is built from, so a
     pre-selected default would make the required check unfailable and publish a claim as the owner's own. */
  construction: '',
  ownership: '',
  monthlyMaintenance: '',
  reraId: '',
  loanAvailable: true,
  monthlyRent: '',
  deposit: '',
  // Unstated. Defaulting to 'included' printed "Maintenance: Included" on the detail page of every
  // rental whose owner never touched the control, beside the figures they did give.
  rentMaintMode: '',
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
  roomType: '',
  rentShare: '',
  lookingFor: 'any',
  lifestyle: [],
  note: '',
  // Who is listing the room: an 'owner' lists their own flat, a 'tenant' is a sitting flatmate
  // seeking a replacement and self-attests a registered agreement for Ops consent.
  hostRole: 'owner',
  agreementDeclared: false,
  agreementDoc: null,
  // Kept flat beside the doc rather than nested inside it because the server stores them as their
  // own columns — the badge-expiry sweep queries `agreementValidTill`, and jsonb keys cannot be indexed.
  agreementRegNo: '',
  agreementRegisteredOn: '',
  agreementValidTill: '',
  ownerConsentMobile: '',
};
