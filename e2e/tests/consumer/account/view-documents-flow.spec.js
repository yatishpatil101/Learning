import { test, expect } from '@playwright/test';

/* Buyer document-sharing flow, end to end.
   Owner uploads files under categories; a buyer requests those categories; the owner
   grants; granting must (a) record which uploaded files to share (sharedDocIds, matched
   by category), (b) notify the buyer, and (c) let the buyer open the view-only viewer,
   which aggregates every approved file for that buyer+property behind one link. */

const OWNER = '9530041000';
const BUYER = '9000041001';
const PROP = 'P-DOCS-1';

// A 1x1 PNG data URL — enough for the viewer to treat it as an image.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAoHqA1YAAAAASUVORK5CYII=';

function seedOwnerAndRequest(page) {
  return page.addInitScript(({ OWNER, BUYER, PROP, PNG }) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Owner Nilesh', mobile: OWNER, role: 'owner' }));
    localStorage.setItem('puneNestDocs:' + OWNER, JSON.stringify({
      [PROP]: [
        { id: 'file-sale', category: 'Sale Deed', name: 'sale-deed.png', mime: 'image/png', dataUrl: PNG },
        { id: 'file-noc', category: 'Society NOC', name: 'society-noc.png', mime: 'image/png', dataUrl: PNG },
      ],
    }));
    // Buyer asked for two categories → two pending records (one per docType).
    localStorage.setItem('puneNestDocReq:' + OWNER, JSON.stringify([
      { id: 'r-sale', propId: PROP, buyerName: 'Priya', buyerMobile: BUYER, docType: 'Sale Deed', status: 'pending', requestedAt: Date.now() },
      { id: 'r-noc', propId: PROP, buyerName: 'Priya', buyerMobile: BUYER, docType: 'Society NOC', status: 'pending', requestedAt: Date.now() },
    ]));
  }, { OWNER, BUYER, PROP, PNG });
}

test('granting matches uploaded files by category and notifies the buyer', async ({ page }) => {
  await seedOwnerAndRequest(page);
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

  // Drive the REAL grant logic (respondDocRequest + notifyBuyerDocsGranted) via the
  // app's own module, so the category-match and cross-user notification are exercised.
  const result = await page.evaluate(async ({ OWNER }) => {
    const mod = await import('/src/lib/data/documents.js');
    mod.respondDocRequest(OWNER, 'r-sale', 'granted');
    mod.respondDocRequest(OWNER, 'r-noc', 'granted');
    mod.notifyBuyerDocsGranted(OWNER, ['r-sale', 'r-noc']);
    const reqs = mod.getDocRequests(OWNER);
    return { reqs, shared: mod.countSharedDocs(OWNER, ['r-sale', 'r-noc']) };
  }, { OWNER });

  const sale = result.reqs.find((r) => r.id === 'r-sale');
  const noc = result.reqs.find((r) => r.id === 'r-noc');
  expect(sale.sharedDocIds).toEqual(['file-sale']);   // matched by category, not all files
  expect(noc.sharedDocIds).toEqual(['file-noc']);
  expect(result.shared).toBe(2);

  // Buyer got a notification in THEIR store (keyed by buyer mobile), linking to the viewer.
  const buyerNotifs = await page.evaluate((BUYER) => JSON.parse(localStorage.getItem('pnNotifications:' + BUYER) || '[]'), BUYER);
  expect(buyerNotifs.length).toBeGreaterThan(0);
  expect(buyerNotifs[0].link).toMatch(/\/view-documents\?o=9530041000&r=r-(sale|noc)/);
});

test('one granted link shows every approved file for that buyer + property', async ({ page }) => {
  // Two separately-granted requests (each one document) for the same buyer+property.
  // The viewer must union them so a single link surfaces every approved paper.
  await page.addInitScript(({ OWNER, BUYER, PROP, PNG }) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Priya', mobile: BUYER, role: 'buyer' }));
    localStorage.setItem('puneNestDocs:' + OWNER, JSON.stringify({
      [PROP]: [
        { id: 'file-sale', category: 'Sale Deed', name: 'sale-deed.png', mime: 'image/png', dataUrl: PNG },
        { id: 'file-noc', category: 'Society NOC', name: 'society-noc.png', mime: 'image/png', dataUrl: PNG },
      ],
    }));
    localStorage.setItem('puneNestDocReq:' + OWNER, JSON.stringify([
      { id: 'r-sale', propId: PROP, buyerName: 'Priya', buyerMobile: BUYER, docType: 'Sale Deed', status: 'granted', sharedDocIds: ['file-sale'] },
      { id: 'r-noc', propId: PROP, buyerName: 'Priya', buyerMobile: BUYER, docType: 'Society NOC', status: 'granted', sharedDocIds: ['file-noc'] },
    ]));
  }, { OWNER, BUYER, PROP, PNG });

  // Buyer opens the viewer with a single reqId; it aggregates both approved files.
  await page.goto(`/view-documents?o=${OWNER}&r=r-sale`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: /Shared Documents/i })).toBeVisible();
  await expect(page.getByText('sale-deed.png').first()).toBeVisible();
  await expect(page.getByText('society-noc.png').first()).toBeVisible();
  await expect(page.getByText(/2 documents shared/i)).toBeVisible();
  // View-only promise holds: no download control anywhere on the page.
  await expect(page.getByRole('button', { name: /download/i })).toHaveCount(0);
});

test('approved-but-not-uploaded shows an honest awaiting-upload state', async ({ page }) => {
  await page.addInitScript(({ OWNER, BUYER, PROP }) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Priya', mobile: BUYER, role: 'buyer' }));
    localStorage.setItem('puneNestDocs:' + OWNER, JSON.stringify({ [PROP]: [] })); // nothing uploaded
    localStorage.setItem('puneNestDocReq:' + OWNER, JSON.stringify([
      { id: 'r-sale', propId: PROP, buyerName: 'Priya', buyerMobile: BUYER, docType: 'Sale Deed', status: 'granted', sharedDocIds: [] },
    ]));
  }, { OWNER, BUYER, PROP });

  await page.goto(`/view-documents?o=${OWNER}&r=r-sale`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(/Documents not uploaded yet/i)).toBeVisible();
});
