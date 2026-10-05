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

function webpSize(view) {
  const text = new TextDecoder('latin1').decode(new Uint8Array(view.buffer, 0, Math.min(view.byteLength, 64)));
  if (!text.startsWith('RIFF') || text.slice(8, 12) !== 'WEBP') throw new Error('Invalid WebP metadata.');
  const kind = text.slice(12, 16);
  if (kind === 'VP8X' && view.byteLength >= 30) {
    return [[1 + view.getUint8(24) + (view.getUint8(25) << 8) + (view.getUint8(26) << 16),
      1 + view.getUint8(27) + (view.getUint8(28) << 8) + (view.getUint8(29) << 16)]];
  }
  if (kind === 'VP8 ' && view.byteLength >= 30) {
    return [[view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff]];
  }
  if (kind === 'VP8L' && view.byteLength >= 25) {
    const b0 = view.getUint8(21);
    const b1 = view.getUint8(22);
    const b2 = view.getUint8(23);
    const b3 = view.getUint8(24);
    return [[1 + b0 + ((b1 & 0x3f) << 8), 1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10))]];
  }
  throw new Error('Invalid WebP metadata.');
}

/** Bound advertised dimensions before allocating decoded pixels; decoding still validates the image. */
export async function checkImageDimensions(file, type) {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  const sizes = type === 'image/png' && buffer.byteLength >= 24
    ? [[view.getUint32(16), view.getUint32(20)]]
    : type === 'image/jpeg' ? jpegSize(view)
      : type === 'image/webp' ? webpSize(view)
        : heifSizes(view, 0, buffer.byteLength);
  if (!sizes.length || sizes.some(([width, height]) => !width || !height)) throw new Error('Invalid image dimensions.');
  if (sizes.some(([width, height]) => width * height > MAX_IMAGE_PIXELS)) throw new Error('Choose an image no larger than 48 megapixels.');
}
