import { Building2, Camera, Check, IndianRupee, MapPin, User } from 'lucide-react';
import {
  localities, facingOptions, overlookingOptions, ageOptions, floorOptions, totalFloorsOptions,
  ownershipOptions, agreementOptions, lockinOptions, noticeOptions,
  commercialOwnershipOptions, commercialAgreementOptions, commercialLockinOptions, commercialNoticeOptions,
  shellOptions, washroomOptions, plotZoneOptions,
  openSidesOptions, waterSourceOptions, naStatusOptions, otherRightsOptions, buyerEligibilityOptions,
  PROPERTY_TYPES, commercialSubtypeOptions, commercialLabelOf,
  fixturesFor, suitableForFor, commercialProfileOf, commercialSpecsFor, COMMERCIAL_SPEC_KEYS, fitOutOptions, tenancyStatusOptions,
  amenitiesFor as amenitiesCatalogFor, furnitureItems,
  isLandType, isHouseType, landUseFor, defaultAreaUnitFor, DEPOSIT_MONTHS,
} from '../../consumer/list-property/constants.js';

/* Shared canonical option data, imported from the consumer "Post a property" flow
   so the two forms can never drift apart. Re-exported for the wizard steps. */
export {
  localities, facingOptions, overlookingOptions, ageOptions, floorOptions, totalFloorsOptions,
  ownershipOptions, agreementOptions, lockinOptions, noticeOptions,
  commercialOwnershipOptions, commercialAgreementOptions, commercialLockinOptions, commercialNoticeOptions,
  plotZoneOptions, openSidesOptions, waterSourceOptions, washroomOptions,
  naStatusOptions, otherRightsOptions, buyerEligibilityOptions,
  commercialSubtypeOptions, commercialLabelOf,
  fixturesFor, suitableForFor, commercialProfileOf, commercialSpecsFor, COMMERCIAL_SPEC_KEYS, fitOutOptions,
  isLandType, isHouseType, landUseFor, defaultAreaUnitFor, DEPOSIT_MONTHS,
};

export const typeOptions = PROPERTY_TYPES;
export const NONRES_TYPES = ['commercial', 'openplot', 'farmland'];
/* Raw-land types have no built structure. */
export const LAND_TYPES = ['openplot', 'farmland'];

export const bhkOptions = [
  { value: '1', label: '1 BHK' }, { value: '2', label: '2 BHK' },
  { value: '3', label: '3 BHK' }, { value: '4', label: '4 BHK' },
  { value: '5', label: '5+ BHK' },
];
export const bathroomOptions = ['1', '2', '3', '4+'];
export const balconyOptions = ['0', '1', '2', '3+'];

/* Furnishing keys match the consumer canonical (unfurnished / semi / furnished) so
   an admin-posted listing is found under the same Furnishing filter. */
export const furnishingOptions = [
  { value: 'unfurnished', label: 'Unfurnished' },
  { value: 'semi', label: 'Semi-Furnished' },
  { value: 'furnished', label: 'Furnished' },
];

/* Commercial shell type (consumer stores tuples; expose {value,label}). */
export const shellTypeOptions = shellOptions.map(([value, label]) => ({ value, label }));
export const tenancyOptions = tenancyStatusOptions.map(([value, label]) => ({ value, label }));
export const gstOptions = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];

/* Sale / possession / tenant selectors mirror the consumer inline options
   value-for-value so listings created either way filter identically. */
export const transactionTypeOptions = [
  { value: 'new', label: 'New Property' }, { value: 'resale', label: 'Resale' },
];
export const possessionOptions = [
  { value: 'ready', label: 'Ready to Move' }, { value: 'new', label: 'New Launch' },
  { value: 'under', label: 'Under Construction' },
];
export const preferredTenantsOptions = [
  { value: 'family', label: 'Family' }, { value: 'bachelors', label: 'Bachelors' },
  { value: 'company', label: 'Company Lease' }, { value: 'anyone', label: 'Anyone' },
];

/* Plain label strings so they persist straight into the listing, but sourced type-aware from the
   canonical catalog so values line up with the consumer amenity and furniture filters. */
export const amenitiesFor = (type, commercialType) =>
  amenitiesCatalogFor(type, commercialType).map((a) => a.label);
export const furnitureLabels = furnitureItems.map((f) => f.label);

/* localStorage key for the concierge draft (survives an accidental refresh mid-call). */
export const DRAFT_KEY = 'dz_pob_draft_v1';

export const STEPS = [
  { id: 1, label: 'Owner', icon: User },
  { id: 2, label: 'Property', icon: Building2 },
  { id: 3, label: 'Location', icon: MapPin },
  { id: 4, label: 'Pricing', icon: IndianRupee },
  { id: 5, label: 'Photos', icon: Camera },
  { id: 6, label: 'Review', icon: Check },
];

export const INITIAL_FORM = {
  ownerName: '', ownerMobile: '', ownerNotes: '',
  deal: 'rent', propertyType: '', commercialType: '', bhk: '', carpetArea: '',
  bathrooms: '', balconies: '', builtUp: '', plotArea: '', floorsInHouse: '',
  floor: '', totalFloors: '', facing: '', overlooking: '', age: '',
  furnishing: 'unfurnished', furniture: [],
  washrooms: '', shellType: '', parkingSpaces: '', pantry: false, camCharges: '', suitableFor: [], fixtures: [],
  gstOnRent: '', fitOutMonths: '', escalationPct: '', tenancyStatus: '', inPlaceRent: '', leaseExpiry: '',
  seatCount: '', frontage: '', floorLoad: '', clearHeight: '', sanctionedPower: '', dockCount: '',
  plotLength: '', plotWidth: '', openSides: '', roadWidth: '', cornerPlot: false,
  boundaryWall: false, plotZone: '', naStatus: '', waterSource: '',
  electricity: false, roadAccess: false, otherRights: '', buyerEligibility: '',
  locality: '', society: '', address: '', landmark: '',
  price: '', deposit: '', maintenance: '', rentMaintMode: '', priceNegotiable: false,
  transactionType: '', possession: 'ready', ownership: '', reraId: '', loanAvailable: true,
  availableFrom: '', preferredTenants: [], agreementDuration: '11', lockIn: '0', noticePeriod: '1',
  photos: [], amenities: [], description: '',
};

export const fld = 'w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-gray-500 focus:border-teal-400/50 focus:outline-none focus:ring-1 focus:ring-teal-400/30 transition';
export const label = 'block text-sm font-medium text-gray-300 mb-1.5';
export const errCls = 'border-red-400/60 focus:border-red-400 focus:ring-red-400/30';
