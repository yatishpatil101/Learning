import imageCompression from 'browser-image-compression';
import heicDecoderUrl from 'heic-to/csp?url';
import { MAX_UPLOAD_BYTES } from './policy.js';
import { checkImageDimensions, MAX_IMAGE_PIXELS } from './imageDimensions.js';

const MAX_EDGE = 2560;

self.onmessage = async ({ data: { file, type } }) => {
  let bitmap;
  let canvas;
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
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
    const context = canvas.getContext('2d');
    // White preserves the appearance of transparent scans when converting them to JPEG.
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close(); bitmap = null;
    const raster = await canvas.convertToBlob({ type: 'image/png' });
    const source = new File([raster], 'image.png', { type: 'image/png' });
    const blob = await imageCompression(source, {
      fileType: 'image/jpeg', initialQuality: 0.95, maxIteration: 1,
      // The package treats maxIteration: 0 as ten attempts. One retry floors quality at 0.9025.
      maxSizeMB: (MAX_UPLOAD_BYTES - 1) / (1024 * 1024), alwaysKeepResolution: true, useWebWorker: false,
    });
    self.postMessage({ blob });
  } catch (error) {
    self.postMessage({ error: error?.message?.includes('48 megapixels') ? error.message : 'Could not decode this photo. Export a single still image as JPEG or PNG and try again.' });
  } finally {
    bitmap?.close();
    if (canvas) { canvas.width = 1; canvas.height = 1; }
  }
};
