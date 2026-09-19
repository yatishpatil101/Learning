import { createRequire } from 'node:module';
import { test, expect } from '../fixtures/live.js';
import { signedInAsNew } from '../helpers/liveAuth.js';

const requireFrontend = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { PDFDocument, PDFName, PDFString } = requireFrontend('pdf-lib');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4AWJiYGD4D8IgBpBmYAAAAAD//7vS9wEAAAAGSURBVAMAGDACA6ybwrYAAAAASUVORK5CYII=', 'base64');
const CAP = 1_000_000;
const photoInput = (page) => page.locator('[data-err="photos"] label.upload-zone input');

async function openPhotos(page) {
  await signedInAsNew(page);
  await page.evaluate(() => localStorage.setItem('dzDraft:list-property', JSON.stringify({
    deal: 'rent', propertyType: 'flat', carpetArea: '900', bhk: '2', bathrooms: '2',
    // A tower's floors are answered on step 1, so a draft without them never gets past it.
    floor: '9', totalFloors: '14',
    flatNumber: 'M-101', society: 'Media Test Home', pincode: '411045',
    monthlyRent: '23000', deposit: '46000', availableFrom: '2026-12-01',
  })));
  await page.goto('/list-property');
  await expect(page.locator('.lp-steps')).toBeVisible();
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.locator('[data-err="locality"]').click();
  await page.getByRole('option', { name: 'Baner', exact: true }).click();
  await page.locator('input[data-err="society"]').fill('Media Test Home');
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.getByRole('button', { name: /Next Step/i }).click();
  // The draft already carries the rent, deposit and date, so the pricing step needs no answers.
  await page.getByRole('button', { name: /Next Step/i }).click();
  await expect(page.locator('[data-err="photos"]')).toBeVisible();
}

async function prepare(page, buffer, name, mimeType, document = false) {
  return page.evaluate(async ({ base64, name, mimeType, document }) => {
    const { prepareUpload } = await import('/src/lib/uploads/prepareUpload.js');
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const input = new File([bytes], name, { type: mimeType });
    try {
      const output = await prepareUpload(input, { document });
      return { size: output.size, type: output.type, name: output.name, unchanged: output === input,
        base64: btoa(String.fromCharCode(...new Uint8Array(await output.slice(0, 100).arrayBuffer()))) };
    } catch (error) { return { error: error.message }; }
  }, { base64: buffer.toString('base64'), name, mimeType, document });
}

async function pdf({ large = false, signed = false, incompressible = false } = {}) {
  const doc = await PDFDocument.create();
  doc.addPage().drawText('Ownership proof: all text must remain selectable.');
  if (large) doc.catalog.set(PDFName.of('TestPayload'), PDFString.of('property record '.repeat(100_000)));
  if (signed) doc.catalog.set(PDFName.of('TestSignature'), doc.context.obj({ Type: 'Sig', ByteRange: [0, 10, 20, 30] }));
  if (incompressible) {
    const bytes = new Uint8Array(1_100_000);
    let seed = 71;
    for (let i = 0; i < bytes.length; i += 1) { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; bytes[i] = seed >>> 24; }
    doc.catalog.set(PDFName.of('TestStream'), doc.context.register(doc.context.flateStream(bytes)));
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

test.describe('upload preparation in the real browser', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/signin'); });

  test('preserves compatible files below 1 MB byte-for-byte', async ({ page }) => {
    for (const size of [PNG.length, CAP - 1]) {
      const input = Buffer.concat([PNG, Buffer.alloc(size - PNG.length)]);
      const result = await prepare(page, input, 'room.png', 'image/png');
      expect(result).toMatchObject({ size, type: 'image/png', unchanged: true });
    }
    const input = await pdf();
    expect(await prepare(page, input, 'deed.pdf', 'application/pdf', true))
      .toMatchObject({ size: input.length, unchanged: true });
    for (const type of ['', 'application/octet-stream']) {
      expect(await prepare(page, input, 'deed.pdf', type, true))
        .toMatchObject({ size: input.length, type: 'application/pdf', unchanged: false });
    }
  });

  test('rejects disallowed formats, disguised files and excessive inputs', async ({ page }) => {
    const cases = [
      [PNG, 'room.webp', 'image/webp', false],
      [PNG, 'room.avif', 'image/avif', false],
      [Buffer.from('<svg>not an image</svg>'), 'room.jpg', 'image/jpeg', false],
      [await pdf(), 'deed.pdf', 'application/pdf', false],
      [PNG, 'deed.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', true],
      [Buffer.alloc(25_000_001), 'huge.jpg', 'image/jpeg', false],
      [Buffer.alloc(0), 'empty.png', 'image/png', false],
      [Buffer.from([255, 216, 255]), 'truncated.jpg', 'image/jpeg', false],
      [PNG.subarray(0, 8), 'truncated.png', 'image/png', false],
    ];
    for (const [bytes, name, type, document] of cases) {
      expect((await prepare(page, bytes, name, type, document)).error, name).toBeTruthy();
    }
  });

  test('compresses an oversized image without spending resolution it does not have to', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { prepareUpload } = await import('/src/lib/uploads/prepareUpload.js');
      const canvas = document.createElement('canvas');
      canvas.width = 1800; canvas.height = 1200;
      const ctx = canvas.getContext('2d');
      const pixels = ctx.createImageData(canvas.width, canvas.height);
      let seed = 29;
      for (let i = 0; i < pixels.data.length; i += 4) {
        seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
        const shade = 150 + ((seed >>> 24) % 30);
        pixels.data.set([shade, shade + 10, shade + 20, 255], i);
      }
      ctx.putImageData(pixels, 0, 0);
      const original = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const output = await prepareUpload(new File([original], 'interior.png', { type: 'image/png' }));
      const decoded = await createImageBitmap(output);
      const dimensions = [decoded.width, decoded.height]; decoded.close();
      return { before: original.size, after: output.size, type: output.type, dimensions };
    });
    expect(result.before).toBeGreaterThanOrEqual(CAP);
    expect(result.after).toBeLessThan(CAP);
    expect(result.type).toBe('image/jpeg');
    expect(result.dimensions).toEqual([1800, 1200]);
  });

  test('the exact 1 MB boundary is processed, never passed through', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { prepareUpload } = await import('/src/lib/uploads/prepareUpload.js');
      const c = new OffscreenCanvas(64, 64);
      c.getContext('2d').fillRect(0, 0, 64, 64);
      const png = await c.convertToBlob({ type: 'image/png' });
      const file = new File([png, new Uint8Array(1_000_000 - png.size)], 'boundary.png', { type: 'image/png' });
      const result = await prepareUpload(file);
      return { size: result.size, unchanged: file === result };
    });
    expect(result.size).toBeLessThan(CAP);
    expect(result.unchanged).toBe(false);
  });

  test('rejects huge advertised dimensions before decoding a tiny compressed input', async ({ page }) => {
    const huge = Buffer.from(PNG);
    huge.writeUInt32BE(100_000, 16); huge.writeUInt32BE(100_000, 20);
    expect((await prepare(page, huge, 'huge.png', 'image/png')).error).toMatch(/48 megapixels/);
  });

  test('never refuses a photo for its size: quality is spent before resolution', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { prepareUpload } = await import('/src/lib/uploads/prepareUpload.js');
      const noise = (width, height) => {
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d');
        const pixels = ctx.createImageData(width, height);
        let seed = 17;
        for (let i = 0; i < pixels.data.length; i += 4) {
          for (let channel = 0; channel < 3; channel += 1) {
            seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
            pixels.data[i + channel] = seed >>> 24;
          }
          pixels.data[i + 3] = 255;
        }
        ctx.putImageData(pixels, 0, 0);
        return canvas;
      };
      const shots = [];
      for (const [width, height] of [[1200, 900], [2560, 1920]]) {
        const canvas = noise(width, height);
        // The worker's last rung before it starts shedding pixels.
        const floor = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.35 });
        const original = await canvas.convertToBlob({ type: 'image/png' });
        const output = await prepareUpload(new File([original], 'noise.png', { type: 'image/png' }));
        const decoded = await createImageBitmap(output);
        let scan;
        try {
          const asDocument = await prepareUpload(new File([original], 'scan.png', { type: 'image/png' }), { document: true });
          const read = await createImageBitmap(asDocument);
          scan = { edge: Math.max(read.width, read.height) }; read.close();
        } catch (error) { scan = { error: error.message }; }
        shots.push({ source: `${width}x${height}`, width, height, before: original.size, floor: floor.size,
          after: output.size, type: output.type, out: [decoded.width, decoded.height], scan });
        decoded.close();
      }
      return shots;
    });
    // One shot each side of the branch, so neither a version that always downscales nor one that
    // never does can pass: the trade-off is the claim, not merely the byte ceiling.
    expect(result.map((shot) => shot.floor < CAP)).toEqual([true, false]);
    for (const shot of result) {
      expect(shot.before, shot.source).toBeGreaterThanOrEqual(CAP);
      expect(shot.after, shot.source).toBeLessThan(CAP);
      expect(shot.type, shot.source).toBe('image/jpeg');
      // Pixels are shed only once the quality ladder has run out; otherwise the frame stays whole.
      if (shot.floor < CAP) expect(shot.out, shot.source).toEqual([shot.width, shot.height]);
      else expect(Math.max(...shot.out), shot.source).toBeLessThan(Math.max(shot.width, shot.height));
      // A photo is never refused; a scan may be, but never silently made unreadable instead.
      if (!shot.scan.error) expect(shot.scan.edge, shot.source).toBeGreaterThanOrEqual(Math.min(1600, Math.max(shot.width, shot.height)));
    }
  });

  test('converts a real HEIC into a browser-readable JPEG under 1 MB', async ({ page, request }) => {
    // Pinned upstream libheif example (MIT); no user media is sent to an external service.
    const response = await request.get('https://raw.githubusercontent.com/strukturag/libheif/v1.22.2/examples/example.heic');
    expect(response.ok()).toBe(true);
    const input = await response.body();
    expect(input.length).toBe(718114);
    const result = await prepare(page, input, 'phone.heic', 'image/heic');
    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ type: 'image/jpeg', name: 'phone.jpg', unchanged: false });
    expect(result.size).toBeLessThan(CAP);
  });

  test('optimizes oversized PDFs without rasterizing pages', async ({ page }) => {
    const input = await pdf({ large: true });
    expect(input.length).toBeGreaterThan(CAP);
    const result = await page.evaluate(async (base64) => {
      const { prepareUpload } = await import('/src/lib/uploads/prepareUpload.js');
      const file = new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], 'deed.pdf', { type: 'application/pdf' });
      const result = await prepareUpload(file, { document: true });
      const data = new Uint8Array(await result.arrayBuffer());
      return { size: result.size, bytes: Array.from(data) };
    }, input.toString('base64'));
    expect(result.size).toBeLessThan(CAP);
    const optimized = await PDFDocument.load(Uint8Array.from(result.bytes));
    const original = await PDFDocument.load(input);
    expect(optimized.getPageCount()).toBe(original.getPageCount());
    const streams = (doc) => doc.getPage(0).node.Contents().asArray().map((ref) => Buffer.from(doc.context.lookup(ref).getContents()));
    expect(streams(optimized)).toEqual(streams(original));
    expect(Buffer.from(optimized.catalog.get(PDFName.of('TestPayload')).asBytes()).toString('ascii')).toBe('property record '.repeat(100_000));
  });

  test('preserves a small signed PDF but rejects malformed and oversized PDFs', async ({ page }) => {
    const signed = await pdf({ signed: true });
    expect(await prepare(page, signed, 'signed.pdf', 'application/pdf', true))
      .toMatchObject({ size: signed.length, unchanged: true });
    expect((await prepare(page, Buffer.from('%PDF-1.7 invalid'), 'broken.pdf', 'application/pdf', true)).error).toMatch(/PDF/i);
    expect((await prepare(page, await pdf({ incompressible: true }), 'scan.pdf', 'application/pdf', true)).error).toMatch(/1 MB|smaller/i);
  });

  test('cancels preparation and does not give hidden videos completion credit', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { prepareUpload } = await import('/src/lib/uploads/prepareUpload.js');
      const { computeProgress } = await import('/src/pages/consumer/list-property/progress.js');
      const { initialForm } = await import('/src/pages/consumer/list-property/initialForm.js');
      const controller = new AbortController(); controller.abort();
      let error;
      try { await prepareUpload(new File(['%PDF-1.7 test'], 'test.pdf', { type: 'application/pdf' }), { document: true, signal: controller.signal }); }
      catch (cause) { error = cause.name; }
      return { error, without: computeProgress({ form: initialForm }), with: computeProgress({ form: initialForm, video: 'legacy.mp4' }) };
    });
    expect(result.error).toBe('AbortError');
    expect(result.with).toEqual(result.without);
  });

  test('terminates an already-created worker when preparation is cancelled', async ({ page }) => {
    const result = await page.evaluate(async (base64) => {
      const { prepareUpload } = await import('/src/lib/uploads/prepareUpload.js');
      const NativeWorker = window.Worker;
      const controller = new AbortController();
      let created = 0; let terminated = 0; let error;
      window.Worker = class extends NativeWorker {
        constructor(...args) { super(...args); created += 1; queueMicrotask(() => controller.abort()); }
        terminate() { terminated += 1; super.terminate(); }
      };
      try {
        const file = new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], 'room.png', { type: 'image/png' });
        await prepareUpload(file, { signal: controller.signal });
      } catch (cause) { error = cause.name; }
      finally { window.Worker = NativeWorker; }
      return { created, terminated, error };
    }, PNG.toString('base64'));
    expect(result).toEqual({ created: 1, terminated: 1, error: 'AbortError' });
  });
});

test('wizard hides videos and explains accepted photo formats', async ({ page }) => {
  await openPhotos(page);
  await expect(photoInput(page)).toHaveAttribute('accept', /\.heic/);
  await expect(photoInput(page)).not.toHaveAttribute('accept', /webp|avif|image\/\*/);
  await expect(page.locator('input[accept^="video"]')).toHaveCount(0);
  await expect(page.getByText(/HEIF.*iPhone|iPhone.*HEIF/i)).toBeVisible();
  // The 25 MB and 48 MP guards are decode-memory limits, told to the one file that hits them.
  await expect(page.locator('[data-err="photos"] label.upload-zone')).not.toContainText(/25 ?MB|megapixel/i);
  await expect(page.locator('.lp-step')).not.toContainText(/5MB|10MB|20 photos/);
});

test('wizard caps a batch at ten, keeps the cap across picks and frees a removed slot', async ({ page }) => {
  await openPhotos(page);
  const photos = page.locator('[data-err="photos"] .grid img');
  let uploads = 0;
  page.on('request', (request) => { if (request.url().endsWith('/api/me/photos') && request.method() === 'POST') uploads += 1; });
  await photoInput(page).setInputFiles(Array.from({ length: 11 }, (_, i) => ({ name: `room-${i}.png`, mimeType: 'image/png', buffer: PNG })));
  await expect(photos).toHaveCount(10);
  await expect(photoInput(page)).toBeDisabled();
  expect(uploads).toBe(10);
  await expect(page.getByRole('button', { name: /Remove photo/i }).first().locator('span')).toHaveClass(/w-\[22px\].*h-\[22px\].*bg-red-500\/40/);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: /Remove photo/i }).first().click();
  await expect(photos).toHaveCount(9);
  await expect(photoInput(page)).toBeEnabled();
  await photoInput(page).setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: PNG });
  await expect(photos).toHaveCount(10);
  expect(uploads).toBe(11);
});

test('wizard shows per-document errors instead of silently retaining a rejected filename', async ({ page }) => {
  await openPhotos(page);
  await page.locator('.doc-upload input').first().setInputFiles({ name: 'signed.pdf', mimeType: 'application/pdf', buffer: await pdf({ signed: true }) });
  await expect(page.locator('[data-err] .dz-field-error').filter({ hasText: /unsigned|signed/i })).toBeVisible();
  await expect(page.locator('.doc-name').filter({ hasText: 'signed.pdf' })).toHaveCount(0);
});

test('service-request attachments also compress before the shared server size gate', async ({ page }) => {
  await signedInAsNew(page);
  const input = await pdf({ large: true });
  expect(input.length).toBeGreaterThan(CAP);
  const result = await page.evaluate(async (base64) => {
    const svc = await import('/src/services/serviceRequestService.js');
    const { get, post } = await import('/src/services/http.js');
    const property = await post('/me/listings', { title: 'Upload policy home', deal: 'rent', propertyType: 'Flat', price: 23000, locality: 'Baner', city: 'Pune', images: [] });
    const request = await svc.createServiceRequest({ type: 'valuation', propertyId: property.id, customer: { name: 'Media test' }, details: { property: 'Baner, Pune' } });
    await svc.addServiceRequestDoc(request.id, { fileName: 'ownership.pdf', mime: 'application/pdf', dataUrl: `data:application/pdf;base64,${base64}` });
    const stored = await get(`/service-requests/${request.id}`);
    return stored.documents;
  }, input.toString('base64'));
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ fileName: 'ownership.pdf', mimeType: 'application/pdf' });
  expect(result[0].sizeBytes).toBeLessThan(CAP);
});

test('a pending photo prevents duplicate picks and premature submission', async ({ page }) => {
  await openPhotos(page);
  let release;
  let requests = 0;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/me/photos', async (route) => { requests += 1; await held; await route.continue(); });
  try {
    await photoInput(page).setInputFiles({ name: 'first.png', mimeType: 'image/png', buffer: PNG });
    await expect.poll(() => requests).toBe(1);
    await expect(page.getByRole('button', { name: 'Preparing files…', exact: true })).toBeDisabled();
    await expect(photoInput(page)).toBeDisabled();
    await photoInput(page).evaluate((input, base64) => {
      const data = new DataTransfer();
      data.items.add(new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], 'second.png', { type: 'image/png' }));
      input.files = data.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, PNG.toString('base64'));
  } finally { release(); }
  await expect(page.locator('[data-err="photos"] .grid img')).toHaveCount(1);
  await expect(photoInput(page)).toBeEnabled();
  expect(requests).toBe(1);
});

test('upload instructions and controls fit narrow phones', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPhotos(page);
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByText(/HEIF.*iPhone|iPhone.*HEIF/i)).toBeVisible();
  }
  await page.locator('[data-err="photos"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('upload-phone.png'), fullPage: true });
});