import assert from 'node:assert/strict';
import { describeListing } from './describe.js';
import { hasContactDetails } from './contactDetails.js';

const form = {
  deal: 'rent',
  propertyType: 'flat',
  bhk: '2',
  society: 'Green Meadows',
  locality: 'Baner',
  carpetArea: '780',
  areaUnit: 'sqft',
  floor: '5',
  totalFloors: '12',
  facing: 'East',
  furnishing: 'semi',
  parkingSpaces: '1',
  monthlyRent: '35000',
  deposit: '100000',
  availableFrom: '2026-10-01',
  preferredTenants: ['family'],
  amenities: ['Gym', 'Modular Kitchen'],
};

const text = describeListing(form, 'en');
assert.match(text, /2 BHK/);
assert.match(text, /Green Meadows/);
assert.equal(hasContactDetails(text), false);
