import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NONE_VERIFICATION,
  toSubmissionPayload,
  toSubmissionResult,
  toVerificationViewModel,
} from '../src/services/providers/http/verificationMapper.js';

test('never-attempted identity verification reads as the none tier', () => {
  assert.deepEqual(toVerificationViewModel(null), { ...NONE_VERIFICATION });
  assert.equal(NONE_VERIFICATION.verified, false);
  assert.equal(NONE_VERIFICATION.status, 'none');
  assert.equal(NONE_VERIFICATION.docType, null);
  assert.equal(NONE_VERIFICATION.attemptsRemaining, 3);
});

test('identity status maps the backend contract and keeps temporary compatibility fields', () => {
  const view = toVerificationViewModel({
    status: 'rejected',
    docType: 'pan',
    docLast4: '1234',
    submittedAt: '2026-09-13T12:00:00Z',
    decidedAt: '2026-09-13T13:00:00Z',
    rejectionReason: 'blurry',
    rejectionNote: 'Retake in daylight',
    attemptsRemaining: 2,
    retryAfter: '2026-09-14T12:00:00Z',
  });
  assert.equal(view.verified, false);
  assert.equal(view.status, 'rejected');
  assert.equal(view.docType, 'pan');
  assert.equal(view.docLast4, '1234');
  assert.equal(view.maskedDocument, '1234');
  assert.equal(view.rejectionReason, 'blurry');
  assert.equal(view.rejectionNote, 'Retake in daylight');
  assert.equal(view.attemptsRemaining, 2);
  assert.equal(view.canRetry, true);
  assert.equal(view.verifiedAt, Date.parse('2026-09-13T13:00:00Z'));
  assert.equal(view.maskedAadhaar, null);
  assert.equal(view.aadhaarMobile, '');
  assert.equal(view.mobileMatch, null);
});

test('submission payload is multipart-safe and excludes absent parts', () => {
  const front = new File(['front'], 'front.jpg', { type: 'image/jpeg' });
  const selfie = new File(['selfie'], 'selfie.jpg', { type: 'image/jpeg' });
  const form = toSubmissionPayload({
    docType: 'pan',
    consent: true,
    claims: { number: 'ABCDE1234F', name: 'Asha Patil', dob: '1991-04-12' },
    captures: { front, selfie },
  });
  assert.equal(form.get('docType'), 'pan');
  assert.equal(form.get('consent'), 'true');
  assert.equal(form.get('claims'), '{"number":"ABCDE1234F","name":"Asha Patil","dob":"1991-04-12"}');
  assert.equal(form.get('front').name, 'front.jpg');
  assert.equal(form.get('selfie').name, 'selfie.jpg');
  assert.equal(form.get('back'), null);
});

test('submission result stays pending until staff review', () => {
  const result = toSubmissionResult({
    status: 'pending',
    docType: 'aadhaar',
    submittedAt: '2026-09-13T14:00:00Z',
    attemptsRemaining: 0,
  });
  assert.equal(result.pending, true);
  assert.equal(result.verified, false);
  assert.equal(result.status, 'pending');
  assert.equal(result.docType, 'aadhaar');
  assert.equal(result.submittedAt, Date.parse('2026-09-13T14:00:00Z'));
});