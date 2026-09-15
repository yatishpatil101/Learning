export const MAX_IMAGE_PIXELS = 48_000_000;

function heifSizes(view, start, end, depth = 0) {
  if (depth > 4) throw new Error('Invalid HEIF image metadata.');
  const sizes = [];
  for (let offset = start; offset + 8 <= end;) {
    let size = view.getUint32(offset);
    let header = 8;
    const kind = String.fromCharCode(...new Uint8Array(view.buffer, offset + 4, 4));
    if (size === 1) {
      if (offset + 16 > end) throw new Error('Invalid HEIF image metadata.');
      size = Number(view.getBigUint64(offset + 8)); header = 16;
    } else if (size === 0) size = end - offset;
    if (size < header || size > end - offset) throw new Error('Invalid HEIF image metadata.');
    if (kind === 'ispe' && size >= header + 12) {
      sizes.push([view.getUint32(offset + header + 4), view.getUint32(offset + header + 8)]);
    } else if (['meta', 'iprp', 'ipco'].includes(kind)) {
      sizes.push(...heifSizes(view, offset + header + (kind === 'meta' ? 4 : 0), offset + size, depth + 1));
    }
    offset += size;
  }
  return sizes;
}

function jpegSize(view) {
  for (let offset = 2; offset + 4 <= view.byteLength;) {
    if (view.getUint8(offset++) !== 255) throw new Error('Invalid JPEG metadata.');
    while (offset < view.byteLength && view.getUint8(offset) === 255) offset += 1;
    if (offset + 3 > view.byteLength) break;
    const marker = view.getUint8(offset++);
    if (marker === 0xD9 || marker === 0xDA) break;
    if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD8)) continue;
    const size = view.getUint16(offset);
    if (size < 2 || size > view.byteLength - offset) break;
    if (marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker) && size >= 8) {
      return [[view.getUint16(offset + 5), view.getUint16(offset + 3)]];
    }
    offset += size;
  }
  throw new Error('Invalid JPEG metadata.');
}

/** Bound advertised dimensions before allocating decoded pixels; decoding still validates the image. */
export async function checkImageDimensions(file, type) {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  const sizes = type === 'image/png' && buffer.byteLength >= 24
    ? [[view.getUint32(16), view.getUint32(20)]]
    : type === 'image/jpeg' ? jpegSize(view) : heifSizes(view, 0, buffer.byteLength);
  if (!sizes.length || sizes.some(([width, height]) => !width || !height)) throw new Error('Invalid image dimensions.');
  if (sizes.some(([width, height]) => width * height > MAX_IMAGE_PIXELS)) throw new Error('Choose an image no larger than 48 megapixels.');
}
