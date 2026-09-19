import heicDecoderUrl from 'heic-to/csp?url';
import { MAX_UPLOAD_BYTES } from './policy.js';
import { checkImageDimensions, MAX_IMAGE_PIXELS } from './imageDimensions.js';

const MAX_EDGE = 2560;
/* A scan degraded past reading is worse than one the owner is told to retake, so documents stop at a
   legibility floor and `prepareUpload` refuses them; the photo floor encodes orders under the cap. */
const PHOTO = { minEdge: 320, qualities: [0.92, 0.8, 0.68, 0.56, 0.44, 0.35] };
const DOCUMENT = { minEdge: 1600, qualities: [0.92, 0.82, 0.72, 0.62] };

const release = (canvas) => { canvas.width = 1; canvas.height = 1; };

function scaleTo(image, edge) {
  const scale = Math.min(1, edge / Math.max(image.width, image.height));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
  const context = canvas.getContext('2d');
  // White preserves the appearance of transparent scans when converting them to JPEG.
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Takes ownership of `source`: the canvas is released on both the return and the throw path. */
async function compressUnderCap(source, { minEdge, qualities }) {
  let frame = source;
  try {
    for (;;) {
      let smallest;
      for (const quality of qualities) {
        smallest = await frame.convertToBlob({ type: 'image/jpeg', quality });
        if (smallest.size < MAX_UPLOAD_BYTES) return smallest;
      }
      const edge = Math.max(frame.width, frame.height);
      if (edge <= minEdge) return smallest;
      if (frame !== source) release(frame);
      /* JPEG bytes track pixel count, so the round that just failed predicts the next edge; a fixed
         step would take a dozen rounds. Resampled from `source`, never from an already-shrunk frame. */
      const predicted = Math.round(edge * Math.min(0.8, Math.sqrt((MAX_UPLOAD_BYTES * 0.8) / smallest.size)));
      frame = scaleTo(source, Math.max(minEdge, predicted));
    }
  } finally {
    if (frame !== source) release(frame);
    release(source);
  }
}

self.onmessage = async ({ data: { file, type, document } }) => {
  let bitmap;
  try {
    await checkImageDimensions(file, type);
    if (type === 'image/heic') {
      // Keep the LGPL decoder independently replaceable; the CSP build does not require eval.
      const { heicTo } = await import(/* @vite-ignore */ heicDecoderUrl);
      bitmap = await heicTo({ blob: file, type: 'bitmap' });
    } else bitmap = await createImageBitmap(file);
    if (!bitmap.width || bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) throw new Error('Choose an image no larger than 48 megapixels.');
    if (file.size < MAX_UPLOAD_BYTES && type !== 'image/heic') {
      self.postMessage({ unchanged: true }); return;
    }
    // Up to 48 MP of decoded pixels: release the bitmap before the first encode, not after the last.
    const source = scaleTo(bitmap, MAX_EDGE);
    bitmap.close(); bitmap = null;
    self.postMessage({ blob: await compressUnderCap(source, document ? DOCUMENT : PHOTO) });
  } catch (error) {
    self.postMessage({ error: error?.message?.includes('48 megapixels') ? error.message : 'Could not decode this photo. Export a single still image as JPEG or PNG and try again.' });
  } finally {
    bitmap?.close();
  }
};
