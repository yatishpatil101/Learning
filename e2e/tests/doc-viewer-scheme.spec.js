import { test, expect } from '@playwright/test';
import { OWNER, seed } from '../helpers/app.js';

/* The document viewer's scheme allowlist (`frontend/src/lib/openDoc.js`).
 *
 * Uploaded documents are stored as base64 data URLs and opened in a new tab. A
 * `data:text/html;base64,…` URL opened as a *top-level* document runs script in
 * this origin — same-origin with the user's session — so it is stored XSS with
 * an extra click. `openDocUrl()` allowlists images and PDFs before the URL ever
 * reaches the browser, and every call site funnels through it.
 *
 * Storage is per-browser localStorage today, so a tampered value is currently
 * self-inflicted. That stops being true the day documents come from a server,
 * which is exactly why the guard is centralised — and why it needs a test that
 * fails loudly if someone "simplifies" it back to window.open(doc.dataUrl).
 *
 * The assertion is deliberately on the *browser*, not on a toast: a spec that
 * only checked for the error message would still pass if the tab opened as well.
 */

/** 1x1 transparent GIF — a legitimately viewable document. */
const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
/** `<script>` in a document that would run same-origin if it were ever opened. */
const HTML_PAYLOAD = `data:text/html;base64,${Buffer.from(
  '<script>window.opener&&(window.opener.__pwned=1)</script>',
).toString('base64')}`;

/** Seed the signed-in owner's personal (KYC) document vault. */
async function seedVault(page, docs) {
  await seed(page, { user: OWNER });
  await page.addInitScript(([mobile, list]) => {
    localStorage.setItem(`puneNestDocs:${mobile}`, JSON.stringify({ personal: list }));
  }, [OWNER.mobile, docs]);
}

const doc = (over) => ({
  id: `d-${over.category}`,
  category: 'Aadhaar Card',
  name: 'aadhaar.gif',
  size: 64,
  mime: 'image/gif',
  uploadedAt: Date.now(),
  ...over,
});

/** Open the vault and expand the KYC group so the per-doc View buttons render. */
async function openVault(page) {
  await page.goto('/dashboard#documents');
  const kyc = page.getByRole('button', { name: /identity|kyc/i }).first();
  if (await kyc.count()) await kyc.click().catch(() => {});
  await expect(page.getByRole('button', { name: /^view$/i }).first())
    .toBeVisible({ timeout: 15_000 });
}

test.describe('Document viewer — data: URL scheme allowlist', () => {
  test('an image document opens in a new tab', async ({ page, context }) => {
    await seedVault(page, [doc({ dataUrl: GIF })]);
    await openVault(page);

    const [tab] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('button', { name: /^view$/i }).first().click(),
    ]);
    expect(tab, 'a viewable document should still open').toBeTruthy();
    await tab.close();
  });

  test('an HTML document is refused rather than opened', async ({ page, context }) => {
    await seedVault(page, [doc({ name: 'notes.html', mime: 'text/html', dataUrl: HTML_PAYLOAD })]);
    await openVault(page);

    const before = context.pages().length;
    await page.getByRole('button', { name: /^view$/i }).first().click();

    /* No tab. Give the browser a real chance to open one — asserting on the
       count immediately would pass against a broken build simply because the
       navigation had not happened yet. */
    await expect
      .poll(() => context.pages().length, { timeout: 3_000, intervals: [250] })
      .toBe(before);

    // And the user is told why, rather than the click doing nothing at all.
    await expect(page.getByText(/preview/i).first()).toBeVisible({ timeout: 5_000 });
  });

  test('a document with no stored file is refused too', async ({ page, context }) => {
    /* The null case shares the guard with the hostile one: `isViewableDoc(null)`
       is false, so a missing upload must not open a blank tab. */
    await seedVault(page, [doc({ dataUrl: null })]);
    await openVault(page);

    const before = context.pages().length;
    await page.getByRole('button', { name: /^view$/i }).first().click();
    await expect
      .poll(() => context.pages().length, { timeout: 3_000, intervals: [250] })
      .toBe(before);
  });
});
