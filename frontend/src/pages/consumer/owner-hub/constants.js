/* Owner Hub — shared option sets. Residential-focused (the valuation tools model
   homes, not land/commercial). */

import { VALUATION_LOCALITIES } from '../../../lib/data/valuation.js';

export const HUB_LOCALITIES = VALUATION_LOCALITIES;

/* The option `value` is what gets stored on a property, so it stays an English
   id — only the label is keyed, and renaming copy can never orphan saved data. */
export const HOME_TYPES = [
  { value: 'Flat', labelKey: 'ownerHub.typeFlat' },
  { value: 'Villa', labelKey: 'ownerHub.typeVilla' },
  { value: 'Independent House', labelKey: 'ownerHub.typeHouse' },
];

export const BHK_OPTIONS = [
  { value: '1', labelKey: 'ownerHub.bhk1' },
  { value: '2', labelKey: 'ownerHub.bhk2' },
  { value: '3', labelKey: 'ownerHub.bhk3' },
  { value: '4', labelKey: 'ownerHub.bhk4' },
];

export const FURNISHING_OPTIONS = [
  { value: 'unfurnished', labelKey: 'ownerHub.furnUnfurnished' },
  { value: 'semi-furnished', labelKey: 'ownerHub.furnSemi' },
  { value: 'furnished', labelKey: 'ownerHub.furnFurnished' },
];

/* Document category ids are stored on every uploaded document, so they stay
   English too — look the id up here to render a translated heading. */
export const DOC_CAT_KEYS = {
  'Title & Ownership': 'ownerHub.catTitle',
  Society: 'ownerHub.catSociety',
  'Approvals & Plans': 'ownerHub.catApprovals',
  'Purchase & Payments': 'ownerHub.catPurchase',
  'Tax & Utilities': 'ownerHub.catTax',
  Other: 'ownerHub.catOther',
};

export const FIELD_CLS =
  'field w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-gray-500';
