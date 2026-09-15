import { PDFDocument, PDFDict, PDFArray, PDFName } from 'pdf-lib';
import { MAX_UPLOAD_BYTES } from './policy.js';

function rejectSignatureFields(pdf) {
  const pending = pdf.context.enumerateIndirectObjects().map(([, value]) => value);
  const visited = new Set();
  for (let index = 0; index < pending.length; index += 1) {
    if (pending.length > 100_000) throw new Error('This PDF is too complex. Please choose a smaller original.');
    const value = pending[index];
    if (visited.has(value)) continue;
    visited.add(value);
    if (value instanceof PDFDict) {
      if (value.has(PDFName.of('ByteRange')) || value.has(PDFName.of('DocMDP'))
        || pdf.context.lookup(value.get(PDFName.of('Type')))?.toString() === '/Sig'
        || pdf.context.lookup(value.get(PDFName.of('FT')))?.toString() === '/Sig') {
        throw new Error('This signed PDF is too large. Keep the original: compression would invalidate its signature.');
      }
      pending.push(...value.values());
    } else if (value instanceof PDFArray) pending.push(...value.asArray());
  }
}

// Never re-save a small PDF: even metadata changes invalidate an issuer's signature.
self.onmessage = async ({ data: { file } }) => {
  try {
    const pdf = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false, throwOnInvalidObject: true });
    if (pdf.getPageCount() < 1 || pdf.getPageCount() > 100) throw new Error('Please upload a PDF with 1 to 100 pages.');
    if (file.size < MAX_UPLOAD_BYTES) { self.postMessage({ unchanged: true }); return; }
    rejectSignatureFields(pdf);
    // Object-stream compression preserves text, vectors and pages; never replace them with screenshots.
    const bytes = await pdf.save({ useObjectStreams: true, updateFieldAppearances: false, addDefaultPage: false });
    self.postMessage({ blob: new Blob([bytes], { type: 'application/pdf' }) });
  } catch (error) {
    const message = error?.message || '';
    self.postMessage({ error: /signature|too complex|1 to 100 pages/.test(message) ? message : 'This PDF could not be processed. Upload a valid, unencrypted original PDF.' });
  }
};