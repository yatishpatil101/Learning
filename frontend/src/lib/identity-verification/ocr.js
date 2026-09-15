// Worker, wasm core and language model are all bundled from our own origin: a blob worker inherits
// this page's `script-src 'self'`, and a CDN would leak who starts an identity check.
import coreUrl from 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url';
import workerUrl from 'tesseract.js/dist/worker.min.js?url';

let modulePromise;

function normalizeText(value) {
  return String(value || '').replace(/[^A-Za-z0-9/\-\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseDob(text) {
  const match = text.match(/(\d{2})[-/](\d{2})[-/](\d{4})|(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (!match) return null;
  if (match[4]) return `${match[4]}-${match[5]}-${match[6]}`;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function parseName(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.find((line) => /^[A-Z][A-Z\s]{4,40}$/.test(line) && !/(GOVT|INDIA|CARD|UNIQUE|INCOME|TAX|DRIVING|LICENCE|DOB|BIRTH)/.test(line)) || null;
}

function parseNumber(docType, raw) {
  if (docType === 'aadhaar') {
    const digits = raw.replace(/\D/g, '');
    const match = digits.match(/\d{12}/);
    return match?.[0] || null;
  }
  if (docType === 'pan') {
    const match = raw.replace(/\s/g, '').toUpperCase().match(/[A-Z]{5}\d{4}[A-Z]/);
    return match?.[0] || null;
  }
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const match = compact.match(/[A-Z]{2}\d{2}\d{7,13}/);
  return match?.[0] || null;
}

async function tesseract() {
  if (!modulePromise) modulePromise = import('tesseract.js');
  return modulePromise;
}

/* A core that cannot start never rejects — emscripten's abort() tears the worker down from inside,
 * so `recognize` stays pending. This deadline is what actually delivers the manual-entry fallback. */
const OCR_DEADLINE_MS = 45000;

export async function extractIdentityClaims(file, docType) {
  const { recognize } = await tesseract();
  // The SIMD core is the only one shipped; anywhere it cannot run falls back to manual entry.
  // langPath is absolute because the worker resolves it against its own blob: URL, not the page.
  const { data } = await Promise.race([
    recognize(file, 'eng', {
      corePath: coreUrl,
      workerPath: workerUrl,
      langPath: `${globalThis.location.origin}/tessdata`,
    }),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('OCR timed out')), OCR_DEADLINE_MS);
    }),
  ]);
  const text = normalizeText(data?.text || '');
  return {
    number: parseNumber(docType, text),
    name: parseName((data?.text || '').toUpperCase()),
    dob: parseDob(text),
  };
}