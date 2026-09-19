/**
 * In mock mode the preview object round-trips through localStorage and renders, so no mock spec can fail on
 * this: the load-bearing assertion is that the stored `photoUrl` is NOT a `data:` URL, re-read over HTTP.
 */
import { test, expect } from '../../../fixtures/live.js';
import { signIn, authHeaders, uniqueMobile, API } from '../../../helpers/liveAuth.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const SLUG = 'skyline-heights-baner';

/** A 1×1 PNG — small enough to inline, real enough that the server's content sniffing accepts it. */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Open the hub's Community tab and press "Add photo". The heading is awaited first because the tab list
 * only paints once the society read resolves; clicking into it earlier races the fetch.
 */
async function openPhotoModal(page) {
  await page.goto(`${BASE}/society/${SLUG}?tab=community`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: /Add photo/i }).click();
  const modal = page.getByRole('dialog', { name: /Add photo/i });
  await expect(modal).toBeVisible();
  return modal;
}

test('the photo a resident picks is uploaded and referenced, not pasted into the request', async ({ page }) => {
  const mobile = await uniqueMobile();
  await signIn(page, mobile);

  /* Unique per run: the seeded society accumulates contributions across every run of this file, and
     asserting on a shared caption would happily pass on somebody else's row. */
  const caption = `Main entrance after the repaint ${Date.now()}`;

  const modal = await openPhotoModal(page);

  /* Armed before the click that triggers it. `submitContribution` awaits the upload and the
     contribution back to back, so waiting afterwards can miss the first response entirely. */
  const uploaded = page.waitForResponse(
    (r) => r.url().includes('/me/photos') && r.request().method() === 'POST',
    { timeout: 20000 },
  );
  const filed = page.waitForResponse(
    (r) => /\/societies\/[^/]+\/contributions$/.test(r.url()) && r.request().method() === 'POST',
    { timeout: 20000 },
  );

  await modal.locator('input[type="file"]').setInputFiles({
    name: 'entrance.png',
    mimeType: 'image/png',
    buffer: PNG_1PX,
  });
  await modal.getByPlaceholder(/Caption/i).fill(caption);
  await modal.getByRole('button', { name: /Post to community/i }).click();

  /* The ordering assertion: the bytes went up as multipart *before* the contribution was filed.
     `postDataBuffer` rather than `postData` because a multipart body is not text. */
  const upload = await uploaded;
  expect(upload.status(), 'the photo upload should succeed').toBe(201);
  expect(upload.request().headers()['content-type'] || '').toMatch(/multipart\/form-data/);

  const contribution = await filed;
  expect(contribution.status(), 'the contribution should be accepted').toBe(201);

  await expect(page.getByText(caption)).toBeVisible({ timeout: 10000 });

  /* Re-read over HTTP, outside the browser. What the page is showing could be React state; what
     this returns is what the server actually kept. */
  const headers = await authHeaders(mobile);
  const listed = await fetch(`${API}/societies/${SLUG}/contributions`, { headers });
  expect(listed.status).toBe(200);
  const rows = await listed.json();
  const mine = (Array.isArray(rows) ? rows : rows.content || []).find((c) => c.body === caption);
  expect(mine, 'the contribution should be readable back from the server').toBeTruthy();

  /* The assertion the old code fails on, stated three ways so the failure message says which. */
  expect(typeof mine.photoUrl, 'photoUrl must be a string, not the preview object').toBe('string');
  expect(mine.photoUrl, 'photoUrl must be an uploaded reference, not a data: URL').not.toMatch(/^data:/);
    expect(mine.photoUrl, 'photoUrl must use the dev public-storage route').toMatch(/^\/api\/dev\/storage\/public\//);
  expect(mine.photoUrl.length, 'photoUrl must fit the column').toBeLessThanOrEqual(500);

    /* The page must render the server's URL rather than a preview kept beside it. The dev public store is
       same-origin through Vite, so visibility proves the bytes resolve as well as the `src` chosen. */
    await expect(page.locator(`img[src="${mine.photoUrl}"]`).first()).toBeVisible();
});

test('an upload that fails files nothing, rather than a photo post with no photo', async ({ page }) => {
  const mobile = await uniqueMobile();
  await signIn(page, mobile);

  const caption = `This one should never land ${Date.now()}`;

  /* Broken at the network edge: failing it server-side would need a file the server rejects, which tests the
     server's validation instead of the page's ordering. */
  await page.route('**/me/photos', (route) => route.abort('failed'));

  const modal = await openPhotoModal(page);
  await modal.locator('input[type="file"]').setInputFiles({
    name: 'entrance.png',
    mimeType: 'image/png',
    buffer: PNG_1PX,
  });
  await modal.getByPlaceholder(/Caption/i).fill(caption);

  /* Watched for rather than re-read after a delay: a POST that never happens is the claim, and an absence in
     a list could simply mean the row was paged. */
  let filedAnyway = false;
  page.on('request', (r) => {
    if (/\/societies\/[^/]+\/contributions$/.test(r.url()) && r.method() === 'POST') filedAnyway = true;
  });

  await modal.getByRole('button', { name: /Post to community/i }).click();

  /* The resident is told the upload failed — not the generic "could not be shared", which is what
     they used to get for a bug that had nothing to do with them. */
  await expect(page.getByText(/photo could not be uploaded/i)).toBeVisible({ timeout: 10000 });
  expect(filedAnyway, 'a failed upload must not file a contribution').toBe(false);

  /* The modal stays open with the caption intact, so the retry is one tap rather than a re-entry. */
  await expect(modal).toBeVisible();
  await expect(modal.getByPlaceholder(/Caption/i)).toHaveValue(caption);

  const headers = await authHeaders(mobile);
  const listed = await fetch(`${API}/societies/${SLUG}/contributions`, { headers });
  const rows = await listed.json();
  const found = (Array.isArray(rows) ? rows : rows.content || []).find((c) => c.body === caption);
  expect(found, 'nothing should have reached the server').toBeFalsy();
});
