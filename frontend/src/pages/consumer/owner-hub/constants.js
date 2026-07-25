/* Owner Hub — shared option sets. Residential-focused (the valuation tools model
   homes, not land/commercial). */

import { VALUATION_LOCALITIES } from '../../../lib/data/valuation.js';

export const HUB_LOCALITIES = VALUATION_LOCALITIES;

export const HOME_TYPES = [
  { value: 'Flat', label: 'Flat / Apartment' },
  { value: 'Villa', label: 'Villa' },
  { value: 'Independent House', label: 'Independent House' },
];

export const BHK_OPTIONS = [
  { value: '1', label: '1 BHK' },
  { value: '2', label: '2 BHK' },
  { value: '3', label: '3 BHK' },
  { value: '4', label: '4+ BHK' },
];

export const FURNISHING_OPTIONS = [
  { value: 'unfurnished', label: 'Unfurnished' },
  { value: 'semi-furnished', label: 'Semi-furnished' },
  { value: 'furnished', label: 'Furnished' },
];

export const FIELD_CLS =
  'field w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-gray-500';
