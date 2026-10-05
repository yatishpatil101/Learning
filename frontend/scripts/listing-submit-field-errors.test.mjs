import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapServerFieldErrors } from '../src/pages/consumer/list-property/serverFieldErrors.js';

test('server validation fields map onto wizard keys and steps', () => {
  assert.deepEqual(mapServerFieldErrors({ deal: 'buy' }, [
    { field: 'carpetArea', message: 'Area is required' },
    { field: 'builtUpArea', message: 'Built-up must exceed carpet' },
    { field: 'pincode', message: 'Pincode is invalid' },
    { field: 'formDetails.flatNumber', message: 'Unit is required' },
    { field: 'construction', message: 'Possession is required' },
  ]), {
    errors: {
      carpetArea: 'Area is required',
      builtUp: 'Built-up must exceed carpet',
      pincode: 'Pincode is invalid',
      flatNumber: 'Unit is required',
      possession: 'Possession is required',
    },
    step: 1,
    unknown: [],
  });
});

test('rent price errors land on monthlyRent and unknown fields stay generic', () => {
  assert.deepEqual(mapServerFieldErrors({ deal: 'rent' }, [
    { field: 'price', message: 'Rent is too low' },
    { field: 'description', message: 'Description is too short' },
    { field: 'moderationOnly', message: 'Cannot map this' },
  ]), {
    errors: {
      monthlyRent: 'Rent is too low',
      description: 'Description is too short',
    },
    step: 3,
    unknown: ['moderationOnly'],
  });
});
