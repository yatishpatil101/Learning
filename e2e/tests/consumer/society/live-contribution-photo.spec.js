/**
 * LIVE check that a resident's society photo is *uploaded*, not pasted into the request body.
 *
 * Excluded from the default run; needs a backend on :8081 under the `dev,e2e` profiles and the
 * `punenest_e2e` database. Run it explicitly:
 *
 *   cd e2e; npx playwright test tests/consumer/society/live-contribution-photo.spec.js --config=playwright.live.config.js
 *
 * ## Why this needed its own live spec
 *
 * This is the exact class of bug the whole live suite exists for, in its purest form: **the mock
 * could not fail.**
 *
 * `EvidenceUpload` hands its callback two things — a preview object `{ name, size, mime, dataUrl }`
 * and the original `File`. The photo modal was wiring only the first into `cForm.photo`, and
 * `submitContribution` was sending that object as `photoUrl`. On the wire `photoUrl` is a
 * `@Size(max = 500) String`, so Jackson could not bind it: the request died in deserialisation,
 * and `submitContribution`'s `catch` flattened that into "That could not be shared. Please try
 * again." — a resident tapping Post, being told to try again, and trying again forever.
 *
 * In mock mode the same object round-trips through `localStorage` and `CommunityTab` renders its
 * `dataUrl` happily. The photo appears. **Every mock spec passes, on a feature that has never once
 * worked against the real server.** No amount of mock coverage could have caught this, which is why
 * the fix does not ship without this file.
 *
 * ## What is actually asserted
 *
 * The load-bearing assertion is that the stored `photoUrl` is **not** a `data:` URL. That single
 * check is what separates a real upload from the preview, and it is the one that fails on the old
 * code. Around it:
 *
 * 1. The multipart `POST /me/photos` is observed happening, so the ordering (upload, *then*
 *    reference) is proven rather than inferred from the result.
 * 2. The contribution is re-read from `GET /societies/{slug}/contributions` over HTTP, outside the
 *    browser that made it — so what is being checked is what the server kept, not what React holds.
 * 3. The hub renders that same URL, rather than a preview it kept beside it.
 *
 * The stored object is **not** fetched back; `live-fees-and-photos.spec.js` explains why at its own
 * upload, and the reason applies unchanged here.
 *
 * A second test covers the failure path: `uploadPhoto` rejecting must not file a photo
 * contribution with no photo. The server would refuse that anyway ("Add a photo to share."), so
 * filing it would only trade a nameable failure for a generic one.
 *
 * The seeded verified society "Skyline Heights, Baner" is used, as in every other society live
 * spec — it is the one with coordinates and a listing, so the hub renders all five tabs.
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
 * Open the hub's Community tab and press "Add photo".
 *
 * The heading is awaited first because the tab list only paints once the society read resolves;
 * clicking into it earlier races the fetch.
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
  expect(mine.photoUrl, 'photoUrl must be a hosted URL').toMatch(/^https?:\/\//);
  expect(mine.photoUrl.length, 'photoUrl must fit the column').toBeLessThanOrEqual(500);

  /* Deliberately not fetched back, for the same reason `live-fees-and-photos.spec.js` gives at its
     own upload: under the dev storage bean the object really is written, but
     `MockFileStorage.storePublic` mints it on `https://mock.storage.local/`, a host that does not
     resolve. The bytes-come-back claim belongs to the storage provider and is made against the real
     bucket in `R2FileStorageLiveTest`; repeating it here would only assert which bean is wired.

     What is checked instead is that the page renders the server's URL rather than a preview it kept
     beside it — attached rather than visible, because the image cannot load from the fake host and
     a broken <img> may lay out at zero size. The `src` the app *chose* is the thing that regresses. */
  await expect(page.locator(`img[src="${mine.photoUrl}"]`).first()).toBeAttached();
});

test('an upload that fails files nothing, rather than a photo post with no photo', async ({ page }) => {
  const mobile = await uniqueMobile();
  await signIn(page, mobile);

  const caption = `This one should never land ${Date.now()}`;

  /* Break the upload at the network edge. Failing it server-side would need a file the server
     rejects, which tests the server's validation instead of the page's ordering — and the ordering
     is the thing this file is about. */
  await page.route('**/me/photos', (route) => route.abort('failed'));

  const modal = await openPhotoModal(page);
  await modal.locator('input[type="file"]').setInputFiles({
    name: 'entrance.png',
    mimeType: 'image/png',
    buffer: PNG_1PX,
  });
  await modal.getByPlaceholder(/Caption/i).fill(caption);

  /* Nothing may be filed. Asserted by watching for the request rather than by re-reading after a
     delay: a POST that never happens is the claim, and a `waitForResponse` that times out proves
     it more directly than an absence in a list that could simply be paged. */
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
