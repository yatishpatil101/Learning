export const MAX_PHOTOS = 10;
export const MAX_UPLOAD_BYTES = 1_000_000;
export const MAX_INPUT_BYTES = 25_000_000;
export const PHOTO_ACCEPT = '.heif,.heic,.jpeg,.jpg,.png,image/heif,image/heic,image/jpeg,image/png';
export const DOCUMENT_ACCEPT = `${PHOTO_ACCEPT},.pdf,application/pdf`;
export const PHOTO_GUIDANCE = 'HEIF/HEIC, JPEG/JPG or PNG. Up to 10 photos, each stored under 1 MB. Originals up to 25 MB; larger images are optimized automatically.';
export const CAMERA_GUIDANCE = 'For smaller originals, use High Efficiency (HEIF/HEIC) on a supported iPhone or Android camera. File sizes vary; HEIC is converted to JPEG for browser compatibility.';
export const DOCUMENT_GUIDANCE = 'PDF, HEIF/HEIC, JPEG/JPG or PNG. Each document must fit under 1 MB after optimization (originals up to 25 MB; PDFs up to 100 pages). PDFs retain their text and pages; files that cannot fit are refused.';
export const PDF_GUIDANCE = 'Digitally signed PDFs under 1 MB are stored exactly as issued. Larger signed PDFs cannot be uploaded: rewriting them would invalidate the signature. Keep the original; for a large electricity bill, use a current property-tax receipt instead. Documents are optional for publishing.';

const EXTENSIONS = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heic', pdf: 'application/pdf' };
const normalizedType = (type) => type.toLowerCase().split(';')[0].replace('image/jpg', 'image/jpeg').replace('image/heif', 'image/heic');

/** Filename and MIME are hints; the bytes must independently agree. */
export async function uploadType(file, isDocument) {
  if (!(file instanceof Blob) || !file.size) throw new Error('Choose a non-empty photo or document.');
  if (file.size > MAX_INPUT_BYTES) throw new Error('Choose an original file no larger than 25 MB.');
  const expected = EXTENSIONS[file.name?.split('.').pop().toLowerCase()];
  if (!expected || (!isDocument && expected === 'application/pdf')) {
    throw new Error(isDocument ? 'Use PDF, HEIF/HEIC, JPEG/JPG or PNG only.' : 'Use HEIF/HEIC, JPEG/JPG or PNG photos only.');
  }
  const declared = normalizedType(file.type || '');
  if (declared && declared !== 'application/octet-stream' && declared !== expected) {
    throw new Error('The file type does not match its filename. Export it again in a supported format.');
  }
  const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const text = new TextDecoder('latin1').decode(bytes);
  let actual;
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) actual = 'image/jpeg';
  else if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)) actual = 'image/png';
  else if (text.startsWith('%PDF-')) actual = 'application/pdf';
  else if (text.slice(4, 8) === 'ftyp' && /^(heic|heix|mif1)$/.test(text.slice(8, 12)) && !/avif|avis/.test(text)) actual = 'image/heic';
  if (!actual || actual !== expected) throw new Error('The file contents do not match a supported format. Export the file again.');
  return actual;
}