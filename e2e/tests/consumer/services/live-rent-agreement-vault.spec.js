/**
 * The rent-agreement wizard's document vault, against the **live** backend.
 *
 * ## The defect this pins
 *
 * `useRentAgreement.js` read and wrote the owner's personal document vault through
 * `lib/data/documents.js` — one browser's `localStorage` — while the dashboard vault beside it
 * (`DocumentsTab.jsx`) has been on `documentService` for some time. The hook's own comment claimed
 * the two "stay in sync" because they shared a key. That was true only on a mock build. Live, the
 * dashboard's papers are rows in `personal_documents` (V32, `GET`/`POST /me/documents/personal`),
 * so the wizard was reading an empty local store and writing its copy somewhere the dashboard would
 * never show it: the owner was asked to re-upload papers the platform already held, and the copy
 * they uploaded here was filed nowhere anyone could find it.
 *
 * The mock spec beside this one could not have caught it. It seeds `draazyDocs:<mobile>` and then
 * reads the same key back, so both halves of its assertion are the browser talking to itself —
 * the textbook vacuous fake. It is kept for what it still owns (the prefill path, which only has
 * bytes to prefill *from* on a mock build — see below); this file owns the claim that the paper
 * leaves the browser.
 *
 * ## Why the on-screen confirmation is not the evidence
 *
 * `StepOwner.jsx:37` derives "Saved to your Documents" from local state alone
 * (`d.dataUrl && !d.tooLarge`), never from the result of the save. The label therefore looks
 * identical whether the upload reached the server, was rejected, or was never sent — which is the
 * whole reason this spec reads the vault back over HTTP from outside the browser rather than
 * asserting the badge. The badge is used only as a signal that the pick handler ran to completion,
 * so the read below is not racing the upload.
 *
 * ## Why the prefill half is not asserted here
 *
 * A live vault row carries a signed `url`, not the bytes, and D120 means those bytes do not resolve
 * in dev. The wizard's own currency is a `dataUrl` (`toUploadFile` in the http service-request
 * provider rebuilds a `File` from one), so there is nothing live to prefill a slot *with*. The hook
 * filters on `d.dataUrl` and therefore prefills nothing live, which is honest — the owner uploads
 * once — rather than handing them a slot that would submit an empty file. Attaching an
 * already-stored personal document to a service request without re-uploading it needs a server
 * route that does not exist; it is filed in `tasks/DECISIONS-NEEDED.md`, not approximated here.
 */
import { expect, test } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAsNew } from '../../../helpers/liveAuth.js';

const PAGE = '/services/rent-agreement';

/* A one-pixel PNG. The bytes do not matter — what matters is that a real multipart body leaves the
   browser and a row comes back — but a valid image keeps the server's content sniffing out of it. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMDAQCb8v8AAAAASUVORK5CYII=',
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
  /* An assertion, not a wait-and-hope: a Next that refuses to advance is a product defect, and
     every panel shares its placeholders, so without this the upload below would go into the
     Property panel's markup and fail somewhere with nothing to do with the cause. */
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
    /* A brand-new account, because this spec's subject is a *write* to the account's own vault.
       A seeded actor's document set is a published invariant, and a spec that adds to it breaks the
       next spec's premise on a database that lives for the whole run. */
    const mobile = await signedInAsNew(page);

    const before = await personalVault(mobile);
    expect(before, 'a new account starts with an empty personal vault').toHaveLength(0);
    const beforeIds = idsOf(before);

    await page.goto(PAGE);
    await toOwnerStep(page);
    await uploadOwnerDoc(page, 0, 'live-pan.png');

    // The optimistic badge — proof the handler ran, not proof the paper was filed. See the header.
    await expect(page.getByText('Saved to your Documents')).toBeVisible({ timeout: 15000 });

    /* An id-set delta rather than a count or a name filter: it survives a vault that already had
       rows and does not depend on which fields the list projection happens to carry.

       `fileName`, not `name`: this reads the wire, where the field is `DocumentDto.fileName`.
       `name` is the *client's* word for it, minted by `documentMapper.toDoc`, and asserting it
       here yields `undefined` — which reads as "the row is wrong" when the row is correct and the
       spec was looking at the wrong side of the mapper. */
    await expect(async () => {
      const arrived = (await personalVault(mobile)).filter((d) => !beforeIds.has(d.id));
      expect(arrived, 'the PAN card reached the server-side vault').toHaveLength(1);
      expect(arrived[0].category).toBe('PAN Card');
      expect(arrived[0].fileName).toBe('live-pan.png');
    }).toPass({ timeout: 15000 });

    /* The other half of "not this browser". Before the fix the wizard wrote `draazyDocs:<mobile>`
       on every deployment; the assertion above would pass on a build that *also* still did that,
       so the absence has to be stated separately or the port is only half proven. */
    const localCopy = await page.evaluate((m) => localStorage.getItem('draazyDocs:' + m), mobile);
    expect(localCopy, 'the wizard no longer keeps a browser-local copy of the vault').toBeNull();
  });

  test('the same paper is not filed twice when it is picked again', async ({ page }) => {
    /* The dedup used to compare against `getDocsForProp`, i.e. against whatever this browser had
       seen. It now compares against the rows the server actually holds, which is the only version
       of the check that means anything on a second device — and the version that keeps an owner
       who re-picks the same file from growing a vault of duplicates. */
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
