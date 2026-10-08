/** Society overlay editor (Directory tab Edit dialog) against the live API; values are read back over the API with its own token because the dialog once saved
 * to `localStorage` only, which a mock-mode spec cannot detect. It drives the first Directory row and reads the slug off the dialog's PATCH. */
import { test, expect } from '../../fixtures/live.js';
import { API, authHeaders, uniqueMobile } from '../../helpers/liveAuth.js';

/** A note no other run — or other test in this file — could have written. */
const uniqueNote = (label) => `${label} ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

/** Open the Directory tab and wait for its table, not its heading. */
async function openDirectory(page) {
  await page.goto('/admin/societies?tab=directory');
  await expect(page.getByRole('heading', { name: 'Societies', exact: true })).toBeVisible({ timeout: 20000 });
  // Rows are in the DOM twice — `Table` renders an `sm:hidden` stacked card per row before the
  // `hidden sm:block` table. Scope to the table or every count is doubled.
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 20000 });
}

/** The dialog, by its aria-label rather than its heading — the heading is the society's name. */
const dialog = (page) => page.getByRole('dialog', { name: 'Edit society' });

/** Mint a community society over the API and return its slug. */
async function mintSociety(name, mobile) {
  const headers = await authHeaders(mobile);
  const res = await fetch(`${API}/societies`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ name, placeId: `e2e-${name}`.replace(/[^A-Za-z0-9_-]/g, '-'), localitySlug: 'wakad', lat: 18.5989, lng: 73.7629 }),
  });
  expect(res.status, `mint ${name}`).toBeLessThan(300);
  return (await res.json()).slug;
}

test('the dialog opens from the server, and what it saves outlives the browser that typed it', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await openDirectory(page);

  const note = uniqueNote('Committee contactable via the secretary;');

  /* Await the GET (armed before the click) to prove the form is seeded from the server, not localStorage. */
  const opened = page.waitForResponse(
    (r) => /\/api\/admin\/societies\/[^/?]+$/.test(r.url()) && r.request().method() === 'GET',
    { timeout: 20000 },
  );
  await page.locator('table tbody tr').first().getByRole('button', { name: 'Edit' }).click();
  expect((await opened).status(), 'the editor reads the society from the server').toBe(200);

  await expect(dialog(page)).toBeVisible();
  // Claim status left the catalogue with society claims: the form is two checkboxes, a figure and a note.
  await expect(dialog(page).getByRole('checkbox')).toHaveCount(2);
  await expect(dialog(page).getByText(/claim/i)).toHaveCount(0);

  /* Absolute values, never a toggle: a toggle depends on the prior row state, i.e. whatever ran last. */
  await dialog(page).getByRole('checkbox').first().setChecked(true);
  await dialog(page).getByRole('checkbox').nth(1).setChecked(true);
  await dialog(page).getByLabel(/Maintenance/i).fill('7');
  await dialog(page).getByLabel(/Admin note/i).fill(note);

  const saved = page.waitForResponse(
    (r) => /\/api\/admin\/societies\/[^/?]+$/.test(r.url()) && r.request().method() === 'PATCH',
    { timeout: 20000 },
  );
  await dialog(page).getByRole('button', { name: 'Save' }).click();

  const res = await saved;
  expect(res.status(), 'the save reaches the server').toBe(200);
  const slug = new URL(res.url()).pathname.split('/').pop();

  await expect(page.getByText('Society details saved')).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);

  /* Read back over the API with a freshly minted token, so nothing can come from page storage or cache. */
  const back = await fetch(`${API}/admin/societies/${slug}`, { headers: await authHeaders('9000000000') });
  expect(back.status).toBe(200);
  const row = await back.json();
  expect(row.adminNote, 'the note is on the server, not in this browser').toBe(note);
  expect(row.registration).toBe(true);
  expect(row.conveyance).toBe(true);
  expect(Number(row.maintenancePerSqft)).toBe(7);

  expect(consoleErrors).toHaveLength(0);
});

test('a refused save keeps the dialog open and does not claim it worked', async ({ page, login }) => {
  await login.asAdmin();
  await openDirectory(page);

  await page.locator('table tbody tr').first().getByRole('button', { name: 'Edit' }).click();
  await expect(dialog(page)).toBeVisible();

  /* `@DecimalMax("100")` on the request record: 500/sqft must be refused by the server. */
  await dialog(page).getByLabel(/Maintenance/i).fill('500');

  const refused = page.waitForResponse(
    (r) => /\/api\/admin\/societies\/[^/?]+$/.test(r.url()) && r.request().method() === 'PATCH',
    { timeout: 20000 },
  );
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  expect((await refused).status(), 'the server refuses an out-of-range figure').toBe(422);

  /* Both halves needed: a closed dialog alone shows no toast, and a toast beside an open dialog still informs. */
  await expect(page.getByText('Society details saved')).toHaveCount(0);
  await expect(dialog(page)).toBeVisible();
});

test('the internal note stays off the payload a visitor gets, while the four public facts land on it', async () => {
  const slug = await mintSociety(`Notetest Residency ${String(Date.now()).slice(-7)}`, uniqueMobile());
  const note = uniqueNote('Chairperson disputes the conveyance date;');
  const admin = await authHeaders('9000000000');

  const res = await fetch(`${API}/admin/societies/${slug}`, {
    method: 'PATCH',
    headers: { ...admin, 'content-type': 'application/json' },
    body: JSON.stringify({ registration: true, conveyance: true, maintenancePerSqft: 4.5, adminNote: note }),
  });
  expect(res.status).toBe(200);

  /* Signed out, deliberately — `GET /societies/{slug}` is the payload every anonymous reader gets,
     and "the note is private" is a claim about that reader and no other. */
  const pub = await fetch(`${API}/societies/${slug}`);
  expect(pub.status).toBe(200);
  const body = await pub.json();

  /* Asserted twice: an absent `adminNote` key proves nothing if the prose moved to another field, and a substring
     sweep of the body proves nothing about the contract. */
  expect(body.adminNote, 'no note field on the public shape').toBeUndefined();
  expect(JSON.stringify(body), 'the prose appears nowhere in the payload').not.toContain(note);

  /* The control. Without this the test above passes just as well against a PATCH that silently
     discarded everything, which is the failure mode it is supposed to be ruling out. */
  expect(body.registration).toBe(true);
  expect(body.conveyance).toBe(true);
});
