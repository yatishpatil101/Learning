import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName } from 'pdf-lib';
import * as documents from '../src/pages/consumer/list-property/constants.js';
import { computeProgress } from '../src/pages/consumer/list-property/progress.js';
import { prepareUpload } from '../src/lib/uploads/prepareUpload.js';
import { PDF_GUIDANCE } from '../src/lib/uploads/policy.js';

const file = { name: 'proof.pdf', mime: 'application/pdf' };
const form = { deal: 'buy', propertyType: 'flat' };
const progress = (docs, deal = 'buy') => computeProgress({ form: { ...form, deal }, documents: docs });

test('every property type offers the same sale and rent badge requirements', () => {
  for (const { value: propertyType } of documents.PROPERTY_TYPES) {
    for (const deal of ['buy', 'rent']) {
      const offered = documents.docsFor(deal, propertyType, 'office');
      const badge = offered.filter((d) => d.verifies).map((d) => d.key);
      assert.deepEqual(badge, deal === 'buy'
        ? ['Electricity Bill', 'Property Tax Receipt', 'Index II']
        : ['Electricity Bill', 'Property Tax Receipt'], `${propertyType} ${deal}`);
      assert.equal(new Set(offered.map((d) => d.key)).size, offered.length);
      assert.equal(offered.find((d) => d.key === 'Electricity Bill').originalPdf, true);
      assert.ok(!badge.includes('Sale Deed') && !badge.includes('7/12 Extract'));
    }
  }
});

test('badge preparation counts alternative bills once and never substitutes a deed for Index II', () => {
  const complete = documents.badgeDocumentProgress;
  assert.equal(typeof complete, 'function');
  assert.equal(complete('rent', {}), 0);
  assert.equal(complete('rent', { 'Electricity Bill': file }), 1);
  assert.equal(complete('rent', { 'Property Tax Receipt': file }), 1);
  assert.equal(complete('rent', { 'Ownership Proof': file }), 0);
  assert.equal(complete('buy', { 'Index II': file }), 0.5);
  assert.equal(complete('buy', { 'Electricity Bill': file, 'Sale Deed': file }), 0.5);
  assert.equal(complete('buy', { 'Index II': file, 'Property Tax Receipt': file }), 1);
  assert.equal(complete('buy', { 'Index II': file, 'Electricity Bill': file, 'Property Tax Receipt': file }), 1);
  assert.equal(complete('unknown', { 'Electricity Bill': file }), 0.5);
});

test('listing progress gives both address alternatives equal credit without requiring both', () => {
  const bill = progress({ 'Index II': file, 'Electricity Bill': file });
  const tax = progress({ 'Index II': file, 'Property Tax Receipt': file });
  const both = progress({ 'Index II': file, 'Electricity Bill': file, 'Property Tax Receipt': file });
  assert.deepEqual(bill, tax);
  assert.deepEqual(bill, both);
  assert.ok(bill.pct > progress({ 'Index II': file }).pct);
  assert.ok(progress({ 'Electricity Bill': file }, 'rent').pct > progress({}, 'rent').pct);
});

test('electricity upload rejects images and oversized originals before starting a worker', async () => {
  const png = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'bill.png', { type: 'image/png' });
  await assert.rejects(prepareUpload(png, { document: true, originalPdf: true }), /original.*PDF/i);
  const pdf = new File(['%PDF-1.7\n', new Uint8Array(1_000_000)], 'bill.pdf', { type: 'application/pdf' });
  await assert.rejects(prepareUpload(pdf, { document: true, originalPdf: true }), /original.*under 1 MB/i);
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
    assert.doesNotMatch(PDF_GUIDANCE, /unsigned copy/i);
  } finally {
    if (originalSelf === undefined) delete globalThis.self;
    else globalThis.self = originalSelf;
  }
});