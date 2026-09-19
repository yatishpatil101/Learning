import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toEditForm, toListingCreate, toViewModel, yearsToAgeBand } from '../src/services/providers/http/propertyMapper.js';
import { editPayload } from '../src/pages/consumer/list-property/editPayload.js';

test('a carpet edit updates an originally mirrored headline', () => {
  const form = { carpetArea: '875.5' };
  const payload = { carpetArea: 900.75, area: 900.75, gallery: [] };
  assert.deepEqual(editPayload(payload, { carpetArea: '900.75' }, { form, area: 875.5, gallery: [] }), {
    carpetArea: 900.75, area: 900.75,
  });
});

test('an address correction keeps the composed line and private components together', () => {
  const form = { flatNumber: 'A-1', society: 'Homes', street: 'Old Road' };
  const changed = { ...form, street: 'New Road' };
  assert.deepEqual(editPayload({ address: 'A-1, Homes, New Road', gallery: [] }, changed,
    { form, formDetails: { ...form, loanAvailable: false }, gallery: [] }), {
    // An absent wing is stored as the empty answer it is, so the parts still decompose the line.
    address: 'A-1, Homes, New Road', formDetails: { ...changed, tower: '', loanAvailable: false },
  });
});

test('intentional gallery changes still cross the sparse edit seam', () => {
  assert.deepEqual(editPayload({ gallery: ['new'], photoHashes: ['hash'] }, {}, { form: {}, gallery: ['old'] }), {
    gallery: ['new'], photoHashes: ['hash'],
  });
});

/* The plan is a tag on a photo rather than a form answer, so it reaches the patch through none of the
   `FIELD_INPUTS` machinery and needs its own clause — without one the edit path drops it silently. */
test('re-tagging the floor plan crosses the sparse edit seam', () => {
  const original = { form: {}, gallery: ['a', 'b'], floorPlan: 'a' };
  assert.deepEqual(editPayload({ gallery: ['a', 'b'], floorPlan: 'b' }, {}, original), { floorPlan: 'b' });
  assert.deepEqual(editPayload({ gallery: ['a', 'b'], floorPlan: 'a' }, {}, original), {});
});

test('untagging withdraws the plan, but only one the owner could see', () => {
  assert.deepEqual(editPayload({ gallery: ['a', 'b'], floorPlan: '' }, {},
    { form: {}, gallery: ['a', 'b'], floorPlan: 'a' }), { floorPlan: '' });
/* A stored plan that is not one of the photos has no thumbnail to carry the tag, so the blank means "never
   offered", not "removed": reading it as a withdrawal unpublishes the plan on any unrelated edit. */
  assert.deepEqual(editPayload({ gallery: ['a', 'b'], floorPlan: '' }, {},
    { form: {}, gallery: ['a', 'b'], floorPlan: '/floorplans/office.svg' }), {});
  assert.deepEqual(editPayload({ gallery: ['a', 'b'], floorPlan: 'b' }, {},
    { form: {}, gallery: ['a', 'b'], floorPlan: '/floorplans/office.svg' }), { floorPlan: 'b' });
});

test('clearing a saved built-up area is refused rather than silently ignored', () => {
  assert.throws(() => editPayload({}, { builtUp: '' }, { form: { builtUp: '1000' } }), /cannot be cleared/);
});

test('legacy explicit canonical rental facts prefill without overriding saved empty answers', () => {
  const vm = toViewModel({ deal: 'rent', pets: true, tenants: ['family', 'company', 'bachelor_male'], maintenance: 2500 });
  const form = toEditForm(vm);
  assert.equal(form.petsPolicy, 'yes');
  assert.equal(form.rentMaintMode, 'extra');
  assert.deepEqual(form.preferredTenants, ['family', 'company']);
  const explicit = toEditForm({ ...vm, formDetails: { petsPolicy: '', preferredTenants: [], rentMaintMode: '' } });
  assert.equal(explicit.petsPolicy, '');
  assert.equal(explicit.rentMaintMode, '');
  assert.deepEqual(explicit.preferredTenants, []);
});
test('built-up-only edits leave the independently stated headline and carpet untouched', () => {
  const form = { carpetArea: '875.5', builtUp: '1000.25' };
  const original = { form, area: 1000, gallery: [] };
  assert.deepEqual(editPayload({ builtUp: 1100.75, area: 875.5, gallery: [] }, { ...form, builtUp: '1100.75' }, original), { builtUp: 1100.75 });
});
test('unrelated edit never rewrites lossy canonical values or stored address', () => {
  const form = { age: '5-10', carpetArea: '875.5', description: 'Original', flatNumber: '', society: '' };
  const original = { form, gallery: ['photo'], formDetails: { loanAvailable: false } };
  const payload = { age: '5-10', area: 875.5, carpetArea: 875.5, address: 'Stored full address', desc: 'Changed', gallery: ['photo'] };
  assert.deepEqual(editPayload(payload, { ...form, description: 'Changed' }, original), { desc: 'Changed' });
});

test('supplemental edits retain other saved answers without writing missing defaults', () => {
  const form = { landmark: 'Old', loanAvailable: false, agreementDuration: '' };
  const original = { form, formDetails: { landmark: 'Old', loanAvailable: false }, gallery: [] };
  assert.deepEqual(editPayload({ gallery: [] }, { ...form, landmark: '' }, original), {
    formDetails: { landmark: '', loanAvailable: false },
  });
});
const details = {
  flatNumber: 'C-901', tower: 'North', society: 'Edit Homes', street: 'Baner Road',
  landmark: 'Near library', ownership: 'Freehold', loanAvailable: false,
  agreementDuration: '24', lockIn: '0', noticePeriod: '2', availableFrom: '2027-01-20',
  preferredTenants: ['family', 'bachelors'], petsPolicy: 'no', foodPref: 'veg',
  rentMaintMode: 'extra', possession: 'available', fixtures: [],
};
const wire = {
  id: 'test-id', propertyType: 'Flat', deal: 'rent', bhk: 2, area: 1000,
  carpetArea: 875.5, builtUpArea: 1000.25, price: 31000, deposit: 0, maintenance: 2500,
  lat: 18.56, lng: 73.77, societyId: 'society-id', locality: 'Baner',
  pincode: '411045', address: 'C-901, North, Edit Homes, Baner Road',
  electricityMeterNo: '00123456789', reraId: 'P52100000001',
  formDetails: details, floor: 0, bathrooms: 2, balconies: 0, parking: 0,
};

test('owner read restores each address, pricing and verification answer without losing false or zero', () => {
  const form = toEditForm(toViewModel(wire));
  for (const [key, value] of Object.entries(details)) assert.deepEqual(form[key], value, key);
  assert.equal(form.propertyType, 'flat');
  assert.equal(form.carpetArea, '875.5');
  assert.equal(form.builtUp, '1000.25');
  assert.equal(form.societyId, 'society-id');
  assert.equal(form.deposit, '0');
  assert.equal(form.floor, 'Ground');
  assert.equal(form.pincode, '411045');
  assert.equal(form.electricityConsumerNo, '00123456789');
  assert.equal(form.reraId, 'P52100000001');
});

test('the write mapper sends address details, postcode and both exact areas', () => {
  const body = toListingCreate({ type: 'Flat', pincode: '411045', carpetArea: 875.5,
    builtUp: 1000.25, formDetails: details });
  assert.equal(body.pincode, '411045');
  assert.equal(body.carpetArea, 875.5);
  assert.equal(body.builtUpArea, 1000.25);
  assert.deepEqual(body.formDetails, details);
});

test('a legacy address is recovered into the boxes in the order it was composed', async () => {
  const { splitStoredAddress } = await import('../src/lib/listingFormDetails.js');
  const compose = (form) => ['flatNumber', 'tower', 'society', 'street']
    .map((key) => String(form[key] ?? '').trim()).filter(Boolean).join(', ');

  const form = toEditForm(toViewModel({ ...wire, formDetails: undefined }));
  assert.equal(form.existingAddress, wire.address);
  assert.equal(form.flatNumber, 'C-901');
  assert.equal(form.tower, 'North');
  assert.equal(form.society, 'Edit Homes');
  assert.equal(form.street, 'Baner Road');
  // Whatever the split decided, rejoining the boxes must reproduce the stored line.
  assert.equal(compose(form), wire.address);

  for (const line of ['101, KATEPURAM PHASE-2, Shirode Road', 'B-1204, Green Acres', 'Old Banyan Society']) {
    assert.equal(compose(splitStoredAddress(line)), line, line);
  }
  assert.deepEqual(splitStoredAddress('101, KATEPURAM PHASE-2, Shirode Road'),
    { flatNumber: '101', society: 'KATEPURAM PHASE-2', street: 'Shirode Road' });
  // Land has no unit or wing, so its line only ever splits into project and street.
  assert.deepEqual(splitStoredAddress('Green Meadows, Survey Road', { land: true }),
    { society: 'Green Meadows', street: 'Survey Road' });

  // A line this wizard never composed is preserved whole rather than dropped or crammed into a box.
  for (const line of ['', '   ', 'Unit 9, East Annex,\nSurvey 42/7', 'A, B, C, D, E',
    `Flat ${'9'.repeat(25)}, Society`, 'Green Meadows, Survey Road, Pune']) {
    assert.equal(splitStoredAddress(line, { land: line.startsWith('Green') }), null, line);
  }
});

test('recovered address boxes the owner never touched send no address at all', () => {
  const form = toEditForm(toViewModel({ ...wire, formDetails: undefined }));
  const changed = { ...form, description: 'Changed' };
  assert.deepEqual(editPayload({ desc: 'Changed', gallery: [] }, changed, { form, gallery: [] }),
    { desc: 'Changed' });
});

test('rewriting a recovered address stores every part, not just the box that changed', () => {
  const form = toEditForm(toViewModel({ ...wire, formDetails: undefined }));
  const address = 'C-901, North, Edit Homes, Shirode Lane';
  assert.deepEqual(editPayload({ address, gallery: [] }, { ...form, street: 'Shirode Lane' }, { form, gallery: [] }), {
    address,
    formDetails: { flatNumber: 'C-901', tower: 'North', society: 'Edit Homes', street: 'Shirode Lane' },
  });
});

test('land is asked for a project name only when its saved line could not be decomposed', async () => {
  const { validateLocationStep } = await import('../src/pages/consumer/list-property/validation.js');
  const land = { propertyType: 'openplot', deal: 'buy', commercialType: '', locality: 'Baner',
    pincode: '', price: '5000000', possession: 'available', availableFrom: '2027-01-20',
    ownership: 'freehold', flatNumber: '', tower: '', society: '', street: '', societyId: '' };

  const undecomposed = { ...land, existingAddress: 'Plot 4, East Block,\nSurvey 42/7' };
  assert.equal(validateLocationStep({ ...undecomposed, street: 'New Road' }, undecomposed).society, true);
  // Boxes that already decompose the line are the owner's own answers; a blank one was never asked for.
  const decomposed = { ...land, existingAddress: 'Survey Road', street: 'Survey Road' };
  assert.equal(validateLocationStep({ ...decomposed, street: 'New Road' }, decomposed).society, undefined);
  // An untouched address is never re-demanded, however the line was stored.
  assert.deepEqual(validateLocationStep(undecomposed, undecomposed), {});
});

test('a missing age is not silently declared a new building', () => {
  for (const value of [null, undefined, '']) assert.equal(yearsToAgeBand(value), '');
  assert.equal(yearsToAgeBand(0), 'new');
});

test('display types and commercial subtypes invert to wizard keys', () => {
  for (const [type, expected] of Object.entries({
    Flat: 'flat', Apartment: 'flat', Studio: 'flat', Penthouse: 'flat',
    'Independent House': 'independent', 'Row House': 'independent', Villa: 'villa',
    'Open Plot': 'openplot', Plot: 'openplot', 'Farm Land': 'farmland',
    independent: 'independent', openplot: 'openplot', Commercial: 'commercial',
  })) assert.equal(toEditForm(toViewModel({ propertyType: type })).propertyType, expected, type);
  for (const [type, subtype] of Object.entries({
    'Office Space': 'office', 'Shop / Showroom': 'shop', 'Retail / Mall Unit': 'retail',
    'Warehouse / Godown': 'warehouse', 'Industrial / Factory': 'industrial',
    'Co-working Space': 'coworking',
  })) {
    const form = toEditForm(toViewModel({ propertyType: type }));
    assert.equal(form.propertyType, 'commercial', type);
    assert.equal(form.commercialType, subtype, type);
  }
  assert.equal(toEditForm({ type: 'Office Space', formDetails: { commercialType: '' } }).commercialType, '');
  assert.equal(toEditForm({ type: 'unknown' }).propertyType, '');
});

test('legacy missing answers stay blank and search availability is not a calendar date', () => {
  const vm = toViewModel({ address: '  Unit 9, Some building\nPune  ', deposit: null,
    maintenance: null, negotiable: null, availableFrom: 'within-month', possession: 'ready-to-move' });
  for (const key of ['deposit', 'maintenance', 'negotiable']) assert.equal(vm[key], null, key);
  const form = toEditForm(vm);
  assert.equal(form.existingAddress, vm.address);
  for (const key of ['flatNumber', 'tower', 'society', 'street', 'ownership', 'agreementDuration',
    'lockIn', 'noticePeriod', 'foodPref', 'petsPolicy', 'availableFrom',
    'deposit', 'monthlyMaintenance', 'rentMaintMode', 'furnishing', 'age']) {
    assert.equal(form[key], '', key);
  }
  // Possession is asked and answered through `construction`; the wizard has no separate box for it.
  assert.equal(form.construction, 'ready');
  assert.equal(toEditForm(toViewModel({})).construction, '');
  assert.equal(toEditForm({ area: 950, carpetArea: null }).carpetArea, '950');
  // An unbuilt flat has no age. That fact is possession's to state, and the age band stays blank
  // rather than carrying an 'under-construction' value the age control cannot show.
  assert.equal(toEditForm({ construction: 'under' }).age, '');
  for (const maintenance of [null, 0, 2500]) {
    const legacy = toEditForm(toViewModel({ deal: 'rent', maintenance }));
    assert.equal(legacy.rentMaintMode, maintenance > 0 ? 'extra' : '');
    assert.equal(legacy.rentMaintenance, maintenance == null ? '' : String(maintenance));
  }
});

test('supplemental details cannot inject canonical values, statuses, credentials or media', () => {
  const unsafe = { ...details, status: 'approved', verified: true, ownerId: 'other',
    propertyType: 'villa', carpetArea: '999', electricityConsumerNo: 'other',
    token: 'not-a-credential', images: ['photo'], video: { url: 'video' }, docs: ['document'] };
  assert.deepEqual(toListingCreate({ formDetails: unsafe }).formDetails, details);
  const form = toEditForm(toViewModel({ ...wire, formDetails: unsafe }));
  for (const key of ['status', 'verified', 'ownerId', 'token', 'images', 'video', 'docs']) {
    assert.equal(Object.hasOwn(form, key), false, key);
  }
  assert.equal(form.propertyType, 'flat');
  assert.equal(form.carpetArea, '875.5');
  assert.equal(form.electricityConsumerNo, wire.electricityMeterNo);
});

test('area writes accept positive decimals only and prefer canonical built-up area', () => {
  for (const value of [undefined, null, '', 0, -1, 'invalid', Infinity]) {
    const body = toListingCreate({ carpetArea: value, builtUpArea: value });
    assert.equal(body.carpetArea, undefined);
    assert.equal(body.builtUpArea, undefined);
  }
  assert.equal(toListingCreate({ builtUpArea: '1250.25', builtUp: 999 }).builtUpArea, 1250.25);
  assert.equal(toListingCreate({ builtUpArea: null, builtUp: '999.5' }).builtUpArea, 999.5);
  assert.equal(toListingCreate({}).formDetails, undefined);
  assert.deepEqual(toListingCreate({ formDetails: {} }).formDetails, {});
});

test('video metadata survives a read but is never written by the listing mapper', () => {
  const video = { url: '/video.mp4', duration: 20 };
  const vm = toViewModel({ ...wire, video });
  assert.deepEqual(vm.video, video);
  assert.deepEqual(vm.formDetails, details);
  assert.equal(Object.hasOwn(toListingCreate(vm), 'video'), false);
});

test('form-details helper matches the backend allowlist and preserves exact empty answers', async () => {
  const { pickListingFormDetails, ADDRESS_PARTS, hasStoredAddress } = await import('../src/lib/listingFormDetails.js');
  const backend = readFileSync(new URL('../../backend/src/main/java/com/draazy/api/catalog/listing/ListingFormDetails.java', import.meta.url), 'utf8');
  const groups = [...backend.matchAll(/Set<String> (TEXT|FLAGS|ARRAYS) = Set\.of\(([\s\S]*?)\);/g)];
  assert.equal(groups.length, 3);
  const answers = Object.fromEntries(groups.flatMap(([, group, contents]) =>
    [...contents.matchAll(/"([^"]+)"/g)].map(([, key]) => [key, group === 'FLAGS' ? false : group === 'ARRAYS' ? [] : ''])));
  assert.deepEqual(pickListingFormDetails({ ...answers, status: 'approved' }), answers);
  const form = toEditForm(toViewModel({ ...wire, formDetails: answers }));
  for (const [key, value] of Object.entries(answers)) assert.deepEqual(form[key], value, key);
  assert.deepEqual(pickListingFormDetails({ flatNumber: 0, tower: null, society: undefined }), { flatNumber: 0 });
  assert.deepEqual(pickListingFormDetails(null), {});
  assert.deepEqual(pickListingFormDetails(Object.create({ flatNumber: 'inherited' })), {});
  assert.deepEqual(ADDRESS_PARTS, ['flatNumber', 'tower', 'society', 'street']);
  assert.equal(hasStoredAddress({ existingAddress: '  Legacy address  ', street: ' ' }), true);
  for (const part of ADDRESS_PARTS) assert.equal(hasStoredAddress({ existingAddress: 'Legacy', [part]: 'new' }), false);
  assert.equal(hasStoredAddress({ existingAddress: ' ' }), false);
  assert.equal(hasStoredAddress(), false);
});