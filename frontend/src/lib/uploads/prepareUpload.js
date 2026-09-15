import { MAX_UPLOAD_BYTES, uploadType } from './policy.js';

const PROCESSING_TIMEOUT_MS = 30_000;

function processInWorker(file, type, signal) {
  return new Promise((resolve, reject) => {
    const worker = type === 'application/pdf'
      ? new Worker(new URL('./pdf.worker.js', import.meta.url), { type: 'module' })
      : new Worker(new URL('./image.worker.js', import.meta.url), { type: 'module' });
    const finish = (error, result) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(new DOMException('Upload preparation cancelled.', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('This file took too long to process. Try a smaller original.')), PROCESSING_TIMEOUT_MS);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = () => finish(new Error('Could not process this file. Try another supported original.'));
    worker.onmessage = ({ data }) => {
      if (data.error) finish(new Error(data.error));
      else if (data.unchanged) finish(null, file.type === type ? file : new File([file], file.name, { type, lastModified: file.lastModified }));
      else if (!(data.blob instanceof Blob) || !data.blob.size || data.blob.size >= MAX_UPLOAD_BYTES) {
        finish(new Error('This file cannot fit under 1 MB at the supported quality. Please choose a smaller original.'));
      } else {
        const name = type === 'application/pdf' ? file.name : file.name.replace(/\.[^.]+$/, '.jpg');
        finish(null, new File([data.blob], name, { type: data.blob.type, lastModified: file.lastModified }));
      }
    };
    if (signal?.aborted) abort(); else worker.postMessage({ file, type });
  });
}

/** Issuer-original PDFs must never enter a rewriting/compression path. */
export async function prepareUpload(file, { document = false, originalPdf = false, signal } = {}) {
  signal?.throwIfAborted();
  const type = await uploadType(file, document);
  signal?.throwIfAborted();
  if (originalPdf && type !== 'application/pdf') {
    throw new Error('Upload the original MSEDCL PDF, not a photo or scan.');
  }
  if (originalPdf && file.size >= MAX_UPLOAD_BYTES) {
    throw new Error('The original PDF must be under 1 MB. Keep it unchanged; use a current property-tax receipt instead if it is too large.');
  }
  return processInWorker(file, type, signal);
}