/* Perceptual image hashing for duplicate-listing detection.
 *
 * Brokers re-list the same flat by copy-pasting the same photos under a slightly
 * different typed address, so the structured address fingerprint misses them.
 * A perceptual hash catches that: visually-identical photos collapse to (nearly)
 * the same hash even after re-compression, mild crop or resize.
 *
 * We use an average hash (aHash): downscale to 8x8 grayscale, then set each of
 * the 64 bits to 1 where the pixel is brighter than the image mean. Two photos
 * are "the same shot" when the Hamming distance between their hashes is small.
 *
 * Privacy: only the 16-hex-char hash is stored on the listing, never the image.
 * Image matching is a FUZZY signal — callers use it to FLAG for Ops review, not
 * to hard-block an owner (a reused stock amenity photo must not false-block).
 */

const SIZE = 8; // 8x8 = 64 bits.

/* Average-hash one image (a data URL or any loadable src) -> 16-char hex string.
   Resolves to '' when the image can't be decoded so a bad upload never throws. */
export const aHash = (src) =>
  new Promise((resolve) => {
    if (!src || typeof document === 'undefined') return resolve('');
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve('');
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
        const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
        const gray = new Array(SIZE * SIZE);
        let sum = 0;
        for (let i = 0; i < SIZE * SIZE; i += 1) {
          // Rec. 601 luma; ignores alpha.
          const g = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
          gray[i] = g;
          sum += g;
        }
        const mean = sum / (SIZE * SIZE);
        let bits = '';
        for (let i = 0; i < SIZE * SIZE; i += 1) bits += gray[i] >= mean ? '1' : '0';
        // Pack the 64 bits into 16 hex chars.
        let hex = '';
        for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
        resolve(hex);
      } catch {
        resolve(''); // tainted canvas (cross-origin) etc. — skip silently.
      }
    };
    img.onerror = () => resolve('');
    img.src = src;
  });

/* Hash a list of `{ url }` photo objects, dropping any that fail to decode.
   Deduplicates identical hashes so a listing's key set stays compact. */
export const hashPhotos = async (photos = []) => {
  const out = [];
  for (const p of photos) {
    // eslint-disable-next-line no-await-in-loop -- canvas reuse; lists are tiny (<=20).
    const h = await aHash(p && p.url);
    if (h && !out.includes(h)) out.push(h);
  }
  return out;
};

const POP = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4]; // popcount per nibble.

/* Hamming distance between two 16-hex-char aHashes (0 = identical, 64 = opposite).
   Returns Infinity when either hash is missing/malformed so it never matches. */
export const hammingHex = (a, b) => {
  if (!a || !b || a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    if (Number.isNaN(x)) return Infinity;
    d += POP[x];
  }
  return d;
};

/* Two photos closer than this many bits (of 64) are treated as the same shot.
   ~15% of the hash — tolerant of re-compression/resize, strict enough to avoid
   matching unrelated interiors. */
export const IMAGE_MATCH_THRESHOLD = 10;

/* Do any two photos across the two hash sets match within the threshold? */
export const photoSetsMatch = (a = [], b = [], threshold = IMAGE_MATCH_THRESHOLD) => {
  for (const x of a) for (const y of b) if (hammingHex(x, y) <= threshold) return true;
  return false;
};
