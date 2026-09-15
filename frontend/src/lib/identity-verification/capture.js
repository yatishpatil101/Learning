import { prepareUpload } from '../uploads/prepareUpload.js';

const DOC_MIME = 'image/jpeg';
const DOC_QUALITY = 0.92;

/** The quality probe wants a thumbnail; a capture wants every pixel the sensor gave. */
const PROBE_EDGE = 240;

export async function startCameraStream({ facingMode, width = 1280, height = 720 }) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This device does not expose a browser camera. Open this page on your phone.');
  }
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: width },
      height: { ideal: height },
    },
  });
}

export function stopCameraStream(stream) {
  stream?.getTracks?.().forEach((track) => track.stop());
}

/**
 * The part of the camera frame the guide overlay covers. The preview paints with `object-cover`, so
 * mapping the guide back through that transform keeps the stored file readable enough for OCR.
 */
function guidedRegion(video, guide) {
  const frameWidth = video.videoWidth;
  const frameHeight = video.videoHeight;
  const preview = video.getBoundingClientRect();
  const area = guide?.getBoundingClientRect();
  // Before the first frame arrives there is no transform to invert, and no guide to honour.
  if (!frameWidth || !frameHeight || !preview.width || !area?.width) {
    return { x: 0, y: 0, width: frameWidth || 1280, height: frameHeight || 720 };
  }
  const scale = Math.max(preview.width / frameWidth, preview.height / frameHeight);
  const hiddenX = (frameWidth * scale - preview.width) / 2;
  const hiddenY = (frameHeight * scale - preview.height) / 2;
  return {
    x: (hiddenX + area.left - preview.left) / scale,
    y: (hiddenY + area.top - preview.top) / scale,
    width: area.width / scale,
    height: area.height / scale,
  };
}

function canvasFor(video, guide, maxEdge = 0) {
  const region = guidedRegion(video, guide);
  const scale = maxEdge ? Math.min(1, maxEdge / Math.max(region.width, region.height)) : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(region.width * scale));
  canvas.height = Math.max(1, Math.round(region.height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(video, region.x, region.y, region.width, region.height, 0, 0, canvas.width, canvas.height);
  return { canvas, context };
}

export async function capturePreparedImage(video, { fileName, document, guide }) {
  const { canvas } = canvasFor(video, guide);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, DOC_MIME, DOC_QUALITY));
  const file = new File([blob], fileName, { type: DOC_MIME, lastModified: Date.now() });
  return prepareUpload(file, { document });
}

export function capturePreviewUrl(file) {
  return URL.createObjectURL(file);
}

export function releasePreviewUrl(url) {
  if (url) URL.revokeObjectURL(url);
}

export function readFrameQuality(video, guide) {
  // Judged on the guided region, not on a corner of the whole frame: the hint is about the card the
  // user is holding, and a room can be bright and sharp while the card in front of it is neither.
  const { canvas, context } = canvasFor(video, guide, PROBE_EDGE);
  const image = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let brightness = 0;
  let sharpness = 0;
  for (let index = 0; index < image.length; index += 4) {
    const grey = (image[index] + image[index + 1] + image[index + 2]) / 3;
    brightness += grey;
    if (index >= 8) sharpness += Math.abs(grey - ((image[index - 4] + image[index - 3] + image[index - 2]) / 3));
  }
  const pixels = image.length / 4 || 1;
  return {
    brightness: brightness / pixels,
    sharpness: sharpness / pixels,
  };
}