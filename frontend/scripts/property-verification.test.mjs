import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName } from 'pdf-lib';
import * as documents from '../src/pages/consumer/list-property/constants.js';
import { computeProgress } from '../src/pages/consumer/list-property/progress.js';
import { uploadType } from '../src/lib/uploads/policy.js';

const file = { name: 'proof.pdf', mime: 'application/pdf' };
const form = { deal: 'buy', propertyType: 'flat' };
const progress = (docs, deal = 'buy') => computeProgress({ form: { ...form, deal }, documents: docs });
const PNG_BYTES = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAARElEQVR4AeyROw0AIAxEL5WADzSw4AcRaGLBDzqKg7uhS4c2eVOTy33snemMtrYzDMErASBBB/0OMNTKCSIoi+pfEYAPAAD//68o26gAAAAGSURBVAMAR8QwUeUtYucAAAAASUVORK5CYII='), (c) => c.charCodeAt(0));

test('badge evidence uses one title document for sale and one offered document for rent', () => {
  assert.deepEqual(
    documents.docsFor('buy', 'flat', 'office').filter((d) => d.verifies).map((d) => d.key),
    ['Index II', 'Share Certificate'],
  );
  assert.deepEqual(
    documents.docsFor('rent', 'flat', 'office').filter((d) => d.verifies).map((d) => d.key),
    ['Electricity Bill', 'Index II', 'Share Certificate', 'Property Tax Receipt'],
  );
  assert.deepEqual(
    documents.docsFor('buy', 'openplot', 'office').filter((d) => d.verifies).map((d) => d.key),
    ['7/12 Extract', '8A Extract', 'Property Card'],
  );
  for (const { value: propertyType } of documents.PROPERTY_TYPES) {
    for (const deal of ['buy', 'rent']) {
      const offered = documents.docsFor(deal, propertyType, 'office');
      assert.equal(new Set(offered.map((d) => d.key)).size, offered.length);
      assert.equal(offered.some((d) => d.originalPdf), false);
      assert.ok(!offered.some((d) => /\b(aadhaar|pan)\b/i.test(d.key)));
    }
  }
});

test('badge preparation counts one qualifying document and never substitutes a bill for sale title', () => {
  const complete = documents.badgeDocumentProgress;
  assert.equal(typeof complete, 'function');
  assert.equal(complete('rent', 'flat', {}), 0);
  assert.equal(complete('rent', 'flat', { 'Electricity Bill': file }), 1);
  assert.equal(complete('rent', 'flat', { 'Property Tax Receipt': file }), 1);
  assert.equal(complete('rent', 'flat', { 'Ownership Proof': file }), 0);
  assert.equal(complete('buy', 'flat', { 'Electricity Bill': file }), 0);
  assert.equal(complete('buy', 'flat', { 'Index II': file }), 1);
  assert.equal(complete('buy', 'flat', { 'Share Certificate': file }), 1);
  assert.equal(complete('buy', 'openplot', { 'Property Card': file }), 1);
});

test('listing progress ignores documents because the wizard no longer uploads them', () => {
  assert.deepEqual(progress({ 'Index II': file }), progress({}));
  assert.deepEqual(progress({ 'Electricity Bill': file }, 'rent'), progress({}, 'rent'));
  assert.notEqual(computeProgress({ form, photos: Array(5).fill('photo') }).nudge, 'evidence');
});

test('badge document type policy accepts images and PDFs', async () => {
  const png = new File([PNG_BYTES], 'bill.png', { type: 'image/png' });
  assert.equal(await uploadType(png, true), 'image/png');
  const pdf = new File(['%PDF-1.7\n', new Uint8Array(1_000_000)], 'bill.pdf', { type: 'application/pdf' });
  assert.equal(await uploadType(pdf, true), 'application/pdf');
});

// Signature-shaped dictionaries exercise the preservation branch, not cryptographic validity.
test('PDF worker preserves small signature-bearing bytes and never recommends stripping signatures', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText('Synthetic ownership evidence');
  pdf.catalog.set(PDFName.of('Perms'), pdf.context.obj({ DocMDP: pdf.context.obj({ Type: 'Sig', ByteRange: [0, 0, 0, 0] }) }));
  const bytes = await pdf.save();
  const originalSelf = globalThis.self;
  let output;
  globalThis.self = { postMessage: (result) => { output = result; } };
  try {
    await import('../src/lib/uploads/pdf.worker.js');
    await self.onmessage({ data: { file: new File([bytes], 'signed.pdf', { type: 'application/pdf' }) } });
    assert.deepEqual(output, { unchanged: true });
    await self.onmessage({ data: { file: new File([bytes, new Uint8Array(1_000_000).fill(32)], 'large-signed.pdf', { type: 'application/pdf' }) } });
    assert.match(output.error, /signature|signed/i);
    assert.doesNotMatch(output.error, /unsigned/i);
  } finally {
    if (originalSelf === undefined) delete globalThis.self;
    else globalThis.self = originalSelf;
  }
});