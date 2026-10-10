import assert from 'node:assert/strict';
import { hasContactDetails } from './contactDetails.js';

const accepted = [
  '2 BHK in Kothrud - 65,00,000 / 750 sq.ft',
  'Spacious 3 BHK, 1,250 sq.ft, 4th floor of 12',
  'Expected rent 65000 - 70000 depending on furnishing',
  'Rent 65000 | 70000 negotiable',
  'Deposit 60000-90000, maintenance extra',
  'Rent 65000, 70000 negotiable',
  'Rent 65000/70000 negotiable',
  'Rent 65000 / 70000 negotiable',
  'Price 1,25,000, area 750 sq.ft',
  'Available 987654321 October',
];

const refused = [
  '2 BHK Kothrud, call 9876543210',
  'Call 98765 43210 for a visit',
  'Owner 9 8 7 6 5 4 3 2 1 0',
  'Ring +91-98765-43210',
  "Call 98'765'43210",
  'Call 98765,43210',
  'Call 98765/43210',
  'Call 98,765,43210',
  'Call 98765 4321O',
  'Call 9876 dash 543210',
  'Call 98765 space 43210',
  'Call 98765 dot 43210',
  'Call 9876 O 54321',
  'Call 9876543210 or o98765 43210',
];

for (const text of accepted) assert.equal(hasContactDetails(text), false, `false alarm: ${text}`);
for (const text of refused) assert.equal(hasContactDetails(text), true, `slipped through: ${text}`);
console.log(`contactDetails: ${accepted.length + refused.length} cases passed`);