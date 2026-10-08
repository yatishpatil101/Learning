import { Home, Images, IndianRupee, MapPin } from 'lucide-react';
import {
  floorOptions, totalFloorsOptions,
  shellOptions, naStatusOptions, otherRightsOptions, buyerEligibilityOptions,
  PROPERTY_TYPES, commercialSubtypeOptions, commercialLabelOf,
  isLandType, landUseFor, DEPOSIT_MONTHS,
} from '../../consumer/list-property/constants.js';

/* Shared canonical option data, imported from the consumer "Post a property" flow
   so the two forms can never drift apart. Re-exported for the wizard steps. */
export {
  floorOptions, totalFloorsOptions,
  naStatusOptions, otherRightsOptions, buyerEligibilityOptions,
  commercialSubtypeOptions, commercialLabelOf,
  isLandType, landUseFor, DEPOSIT_MONTHS,
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

/* Furnishing keys match the consumer canonical (unfurnished / semi / furnished) so
   an admin-posted listing is found under the same Furnishing filter. */
export const furnishingOptions = [
  { value: 'unfurnished', label: 'Unfurnished' },
  { value: 'semi', label: 'Semi-Furnished' },
  { value: 'furnished', label: 'Furnished' },
];

/* Commercial shell type (consumer stores tuples; expose {value,label}). */
export const shellTypeOptions = shellOptions.map(([value, label]) => ({ value, label }));

/* Mirrors the consumer inline options value-for-value so listings created either way filter identically. */
export const possessionOptions = [
  { value: 'ready', label: 'Ready to Move' }, { value: 'new', label: 'New Launch' },
  { value: 'under', label: 'Under Construction' },
];

/* localStorage key for the concierge draft (survives an accidental refresh mid-call). A draft stores its
   step number, so the key changes whenever the steps are renumbered. */
export const DRAFT_KEY = 'dz_pob_draft_v2';

/* Mirrors the owner's own List Property rail (list-property/StepNav.jsx), so both flows read alike. */
export const STEPS = [
  { id: 1, label: 'Details', icon: Home },
  { id: 2, label: 'Location', icon: MapPin },
  { id: 3, label: 'Pricing', icon: IndianRupee },
  { id: 4, label: 'Photos & Review', icon: Images },
];
export const LAST_STEP = STEPS.length;

/* Only what is critical and unique to the property; the owner completes the rest after claiming. */
export const INITIAL_FORM = {
  ownerName: '', ownerMobile: '', ownerNotes: '',
  deal: 'rent', propertyType: '', commercialType: '', bhk: '', carpetArea: '',
  floor: '', totalFloors: '', furnishing: 'unfurnished', shellType: '',
  naStatus: '', otherRights: '', buyerEligibility: '',
  locality: '', localitySlug: '', society: '', societyId: '', lat: null, lng: null, pincode: '', address: '',
  price: '', deposit: '', availableFrom: '', possession: 'ready', reraId: '',
  photos: [],
};

export const fld = 'w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-gray-500 focus:border-teal-400/50 focus:outline-none focus:ring-1 focus:ring-teal-400/30 transition';
export const label = 'block text-sm font-medium text-gray-300 mb-1.5';
export const errCls = 'border-red-400/60 focus:border-red-400 focus:ring-red-400/30';
