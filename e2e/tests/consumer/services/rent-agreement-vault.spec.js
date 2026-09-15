/* The wizard's own "Saved to your Documents" badge is derived from local state, so the vault is
   read back over HTTP from outside the browser as the evidence the paper actually left it. */
import { expect, test } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAsNew } from '../../../helpers/liveAuth.js';

const PAGE = '/services/rent-agreement';

// The browser decodes even under-cap originals before uploading them unchanged.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4AWJiYGD4D8IgBpBmYAAAAAD//7vS9wEAAAAGSURBVAMAGDACA6ybwrYAAAAASUVORK5CYII=',
  'base64',
);

/** The owner's personal vault, read as the owner, from outside the browser. */
async function personalVault(mobile) {
  const res = await fetch(`${API}/me/documents/personal`, { headers: await authHeaders(mobile) });
  expect(res.status, 'the owner can read their own personal vault').toBe(200);
  const body = await res.json();
  return Array.isArray(body) ? body : (body?.content || []);
}

const idsOf = (rows) => new Set(rows.map((r) => r.id));

/** Fill the Property step and land on Owner, which is where the document slots live. */
async function toOwnerStep(page) {
  const p = page.locator('.step-panel.active');
  await p.getByPlaceholder('e.g. B-1204').fill('B-1204');
  await p.getByPlaceholder('e.g. Skyline Heights').fill('Skyline Heights');
  await p.getByPlaceholder('e.g. Baner').fill('Baner');
  await p.getByPlaceholder('411045').fill('411045');
  await page.getByRole('button', { name: 'Next' }).click();
  /* Every panel shares these placeholders, so a Next that refuses to advance would send the upload
     below into the Property panel and fail far from its cause. */
  await expect(page.locator('.step-dot').nth(1), 'wizard advanced to the Owner step').toHaveClass(/\bactive\b/);
}

/** Drop a file into one of the four owner document slots. `slot` is its index in `OWNER_DOCS`. */
async function uploadOwnerDoc(page, slot, name) {
  const p = page.locator('.step-panel.active');
  await p.locator('input[type="file"]').nth(slot).setInputFiles({ name, mimeType: 'image/png', buffer: PNG });
  await expect(p.getByText(name)).toBeVisible();
}

test.describe('rent-agreement document vault, live', () => {
  test('a paper uploaded in the wizard reaches the vault on the server, not this browser', async ({ page }) => {
    /* A brand-new account: a seeded actor's document set is a published invariant, and writing to
       it would break the next spec's premise on a database that lives for the whole run. */
    const mobile = await signedInAsNew(page);

    const before = await personalVault(mobile);
    expect(before, 'a new account starts with an empty personal vault').toHaveLength(0);
    const beforeIds = idsOf(before);

    await page.goto(PAGE);
    await toOwnerStep(page);
    await uploadOwnerDoc(page, 0, 'live-pan.png');

    // The optimistic badge — proof the handler ran, not proof the paper was filed. See the header.
    await expect(page.getByText('Saved to your Documents')).toBeVisible({ timeout: 15000 });

    /* An id-set delta survives a vault that already had rows. `fileName` because this reads the
       wire (`DocumentDto.fileName`); `name` is the client's word for it and would be undefined. */
    await expect(async () => {
      const arrived = (await personalVault(mobile)).filter((d) => !beforeIds.has(d.id));
      expect(arrived, 'the PAN card reached the server-side vault').toHaveLength(1);
      expect(arrived[0].category).toBe('PAN Card');
      expect(arrived[0].fileName).toBe('live-pan.png');
    }).toPass({ timeout: 15000 });

    /* The other half of "not this browser": a build that filed to the server *and* kept writing
       `draazyDocs:<mobile>` would pass the assertion above, so the absence is stated separately. */
    const localCopy = await page.evaluate((m) => localStorage.getItem('draazyDocs:' + m), mobile);
    expect(localCopy, 'the wizard no longer keeps a browser-local copy of the vault').toBeNull();
  });

  test('the same paper is not filed twice when it is picked again', async ({ page }) => {
    /* The dedup compares against the rows the server holds, which is the only version of the check
       that means anything on a second device. */
    const mobile = await signedInAsNew(page);
    expect(await personalVault(mobile)).toHaveLength(0);

    await page.goto(PAGE);
    await toOwnerStep(page);
    await uploadOwnerDoc(page, 1, 'live-aadhaar.png');
    await expect(page.getByText('Saved to your Documents')).toBeVisible({ timeout: 15000 });
    await expect(async () => {
      expect(await personalVault(mobile), 'the first pick was filed').toHaveLength(1);
    }).toPass({ timeout: 15000 });

    // Same slot, same file name, same category — the case the dedup exists for.
    await uploadOwnerDoc(page, 1, 'live-aadhaar.png');
    await page.waitForTimeout(2000);

    const after = await personalVault(mobile);
    expect(after, 'the re-pick did not file a second copy').toHaveLength(1);
    expect(after[0].category).toBe('Aadhaar Card');
  });
});
