import { Building2, Camera, Check, IndianRupee, MapPin, User } from 'lucide-react';
import {
  localities, facingOptions, ageOptions, floorOptions, totalFloorsOptions,
  ownershipOptions, agreementOptions, lockinOptions, noticeOptions,
  shellOptions, washroomOptions, suitableForTags, plotZoneOptions,
  openSidesOptions, waterSourceOptions,
  PROPERTY_TYPES, COMMERCIAL_SUBTYPES,
  amenitiesFor as amenitiesCatalogFor, furnitureFor as furnitureCatalogFor,
  isLandType, isCommercialType, isPgType, isHouseType,
} from '../../consumer/list-property/constants.js';
import { PG_SHARING } from '../../../data/propertyTypes.js';
export { PG_SHARING_HELP } from '../../../data/propertyTypes.js';

/* Shared canonical option data, imported from the consumer "Post a property" flow
   so the two forms can never drift apart. Re-exported for the wizard steps. */
export {
  localities, facingOptions, ageOptions, floorOptions, totalFloorsOptions,
  ownershipOptions, agreementOptions, lockinOptions, noticeOptions,
  plotZoneOptions, openSidesOptions, waterSourceOptions, washroomOptions,
  isLandType, isCommercialType, isPgType, isHouseType,
};

export const typeOptions = PROPERTY_TYPES;
export const commercialSubtypes = COMMERCIAL_SUBTYPES;
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
/* PG occupancy, derived from the canonical PG_SHARING taxonomy. */
export const pgSharingOptions = PG_SHARING.map(([value, label]) => ({ value, label }));

/* Furnishing keys match the consumer canonical (unfurnished / semi / furnished) so
   an admin-posted listing is found under the same Furnishing filter. */
export const furnishingOptions = [
  { value: 'unfurnished', label: 'Unfurnished' },
  { value: 'semi', label: 'Semi-Furnished' },
  { value: 'furnished', label: 'Furnished' },
];

/* Commercial shell type (consumer stores tuples; expose {value,label}). */
export const shellTypeOptions = shellOptions.map(([value, label]) => ({ value, label }));

/* Sale / possession / tenant / PG selectors mirror the consumer inline options
   value-for-value so listings created either way filter identically. */
export const transactionTypeOptions = [
  { value: 'new', label: 'New Property' }, { value: 'resale', label: 'Resale' },
];
export const possessionOptions = [
  { value: 'ready', label: 'Ready to Move' }, { value: 'available', label: 'Available From' },
];
export const preferredTenantsOptions = [
  { value: 'family', label: 'Family' }, { value: 'bachelors', label: 'Bachelors' },
  { value: 'company', label: 'Company Lease' }, { value: 'anyone', label: 'Anyone' },
];
export const pgGenderOptions = [
  { value: 'boys', label: 'Boys' }, { value: 'girls', label: 'Girls' }, { value: 'any', label: 'Anyone' },
];
export const pgMealsOptions = [
  { value: 'none', label: 'No Meals' }, { value: 'veg', label: 'Veg' }, { value: 'both', label: 'Veg & Non-veg' },
];
export const suitableForOptions = suitableForTags;

/* Amenities & furniture as plain label strings (persist straight into the listing,
   matching the consumer catalog shape) but sourced type-aware from the canonical
   catalog so values line up with the consumer amenity / furniture filters. */
export const amenitiesFor = (type, commercialType) =>
  amenitiesCatalogFor(type, commercialType).map((a) => a.label);
export const furnitureFor = (type) => furnitureCatalogFor(type).map((f) => f.label);

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
  deal: 'rent', propertyType: '', commercialType: '', bhk: '', sharing: [], carpetArea: '',
  bathrooms: '', balconies: '', builtUp: '', plotArea: '', floorsInHouse: '',
  floor: '', totalFloors: '', facing: '', age: '',
  furnishing: 'unfurnished', furniture: [],
  sharingRents: {}, pgGender: 'any', pgMeals: 'none',
  washrooms: '', shellType: '', parkingSpaces: '', powerBackup: false, pantry: false, camCharges: '', suitableFor: [],
  plotLength: '', plotWidth: '', openSides: '', roadWidth: '', cornerPlot: false,
  boundaryWall: false, plotZone: '', naSanctioned: false, waterSource: '',
  electricity: false, roadAccess: false, satbara: false,
  locality: '', society: '', address: '', landmark: '',
  price: '', deposit: '', maintenance: '', priceNegotiable: false,
  transactionType: '', possession: 'ready', ownership: '', reraId: '', loanAvailable: true,
  availableFrom: '', preferredTenants: [], agreementDuration: '11', lockIn: '0', noticePeriod: '1',
  photos: [], amenities: [], description: '',
};

export const fld = 'w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-gray-500 focus:border-teal-400/50 focus:outline-none focus:ring-1 focus:ring-teal-400/30 transition';
export const label = 'block text-sm font-medium text-gray-300 mb-1.5';
export const errCls = 'border-red-400/60 focus:border-red-400 focus:ring-red-400/30';
