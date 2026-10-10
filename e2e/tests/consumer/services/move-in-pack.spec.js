import { test, expect, ACTORS, STAFF } from '../../../fixtures/live.js';
import { API, authHeaders } from '../../../helpers/liveAuth.js';
import { appReady } from '../../../helpers/app.js';

/* Reads the packers board back via GET /tickets with a staff token (the buyer is refused it), since a toast
   alone passes on a lead that never left the browser. The waitlist rate limit is in ServiceWaitlistTest. */

const PRICES = { movers: 8000, clean: 2500, agreement: 1500, paint: 6000, verify: 999, internet: 500 };

/** Two items, and the 12% bundle discount the page applies to the whole pack. */
const CHOSEN = ['Packers & Movers', 'Deep Cleaning'];
const TOTAL = PRICES.movers + PRICES.clean;
const EXPECTED_QUOTE = TOTAL - Math.round(TOTAL * 0.12);

/** Fixed by `ServiceWaitlists` on the server. Asserted literally so a drift in either fails here. */
const WAITLIST_SUBJECT = 'Move-in Pack \u2014 waitlist';

/** Unique per run: the live database is not reset between specs, and one row must mean one signup. */
const MOBILE = `98${String(Date.now()).slice(-8)}`;

/** Newest-first, and scoped to the packers desk by the server. */
async function packersBoard(size = 20) {
  const res = await fetch(`${API}/tickets?size=${size}`, { headers: await authHeaders(STAFF.packers) });
  expect(res.status).toBe(200);
  const body = await res.json();
  return body.content || [];
}

/* Publishing the pack is a server-side act, performed through the admin route the console uses. The
   live database is not reset between specs, so each describe sets the state it needs explicitly. */
async function setMovePack(patch) {
  const res = await fetch(`${API}/admin/settings`, {
    method: 'PUT',
    // authHeaders already sets content-type; a second, differently-cased key sends it twice
    // and the server answers 415.
    headers: await authHeaders(ACTORS.admin),
    body: JSON.stringify({ movePack: patch }),
  });
  expect(res.status).toBe(200);
}

async function openHub(page) {
  await page.goto('/services');
  await appReady(page);
}

/* Everything below the fold sits at opacity 0 until `useScrollReveal` fires, and Playwright will
   not scroll to something it reads as invisible — a deadlock. Force the end state. */
async function packSection(page) {
  await expect(page.locator('a.svc-card')).toHaveCount(9);
  await page.evaluate(() => document.querySelectorAll('.reveal').forEach((el) => el.classList.add('visible')));
  const section = page.locator('section').filter({ hasText: 'Draazy Move-in Pack' }).last();
  await expect(section).toBeVisible();
  return section;
}

async function chooseItems(pack) {
  for (const name of CHOSEN) await pack.getByRole('button', { name: new RegExp(name) }).click();
}

test.describe('Move-in Pack booking (live)', () => {
  test.beforeAll(async () => { await setMovePack({ enabled: true, items: PRICES }); });
  test.afterAll(async () => { await setMovePack({ enabled: false }); });

  test('the booking leaves the browser and reaches the ops board with the price and the order', async ({ page, login }) => {
    const before = (await packersBoard()).length;
    await login.asBuyer();
    await openHub(page);
    const pack = await packSection(page);
    await chooseItems(pack);

    // Armed before the click: a toast is not evidence that a request was made.
    const posted = page.waitForRequest(
      (r) => r.method() === 'POST' && /\/api\/tickets$/.test(new URL(r.url()).pathname),
      { timeout: 15_000 },
    );
    await pack.getByRole('button', { name: 'Book Move-in Pack' }).click();
    const body = JSON.parse((await posted).postData() || '{}');
    expect(body.quotedValue).toBe(EXPECTED_QUOTE);
    // value must not be in the body at all, not even null: a client sending the key
    // is one lenient mapper away from setting it.
    expect(Object.keys(body)).not.toContain('value');
    await expect(page.getByText(/Move-in Pack booked/i)).toBeVisible();

    await expect.poll(async () => (await packersBoard()).length).toBe(before + 1);
    const [row] = await packersBoard();
    // The board row is the slim TicketRow; price, pipeline value and line items are on the full ticket.
    const res = await fetch(`${API}/tickets/${row.id}`, { headers: await authHeaders(STAFF.packers) });
    expect(res.status).toBe(200);
    const latest = await res.json();
    expect(latest.subject).toBe('Move-in Pack booking');
    expect(latest.team).toBe('packers');
    // The number the customer agreed to, computed in the browser and read back through a different account's token.
    expect(latest.quotedValue).toBe(EXPECTED_QUOTE);
    // Accepting a price from the client must not also let it write the pipeline figure.
    expect(latest.value).toBeNull();

    // A price with no line items is a quote nobody can honour;
    // asserted whole because a mapper that drops a field does so quietly.
    expect(latest.detail).toBe(CHOSEN.join(', '));
    // Identity comes off the session, never off the page: the form never asked for either.
    expect(latest.mobile).toBe(ACTORS.buyer);
    expect(latest.customer).toBeTruthy();
  });

  test('a booking the server refuses is reported as refused, and the selection survives', async ({ page, login }) => {
    /* The POST is made to fail; the assertion is a pair (failure toast present AND success toast absent)
       because either alone passes on the wrong page. */
    await login.asBuyer();

    // Scoped to the POST and installed after login, so the page's own reads still work.
    await page.route('**/api/tickets', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"server_error"}' });
    });

    const before = (await packersBoard()).length;
    await openHub(page);
    const pack = await packSection(page);
    await chooseItems(pack);
    await pack.getByRole('button', { name: 'Book Move-in Pack' }).click();

    await expect(page.getByText(/couldn't book your Move-in Pack/i)).toBeVisible();
    await expect(
      page.getByText(/Move-in Pack booked/i),
      'the customer was told their move was arranged by a server that had just refused it',
    ).toHaveCount(0);

    expect((await packersBoard()).length).toBe(before);

    // Clearing the selection on failure would turn the retry into a re-do,
    // and a stuck booking state would block it.
    await expect(pack.getByRole('button', { name: 'Book Move-in Pack' })).toBeEnabled();
    await expect(pack.getByRole('button', { name: new RegExp(CHOSEN[0]) })).toHaveClass(/bg-teal-400\/10/);
  });

  test('a signed-out visitor is sent to sign in before anything is written', async ({ page }) => {
    const before = (await packersBoard()).length;
    await openHub(page);
    const pack = await packSection(page);
    await chooseItems(pack);
    await pack.getByRole('button', { name: 'Book Move-in Pack' }).click();

    await expect(page).toHaveURL(/\/signin/);
    // The redirect is the positive anchor: the gate runs before the write,
    // so no half-identified ticket reaches the desk.
    expect((await packersBoard()).length).toBe(before);
  });

  test('the customer who booked cannot read the board they booked onto', async () => {
    const res = await fetch(`${API}/tickets?size=1`, { headers: await authHeaders(ACTORS.buyer) });
    expect(res.status).toBe(403);
  });
});

test.describe('Move-in Pack waitlist (live)', () => {
  // Set explicitly rather than trusted from the seed: the booking describe above switches the pack on.
  test.beforeAll(async () => { await setMovePack({ enabled: false }); });

  const joinWaitlist = (page) =>
    page.waitForResponse((r) => r.url().includes('/service-waitlist') && r.request().method() === 'POST');

  test('a stranger joins without signing in, and asking again does not put them on the board twice', async ({ page }) => {
    const onBoard = async () => (await packersBoard(100)).filter((t) => t.mobile === MOBILE);

    await test.step('the lead lands on the packers board', async () => {
      await openHub(page);
      const pack = await packSection(page);

      await pack.getByPlaceholder('Enter mobile number').fill(MOBILE);
      const nameField = pack.getByPlaceholder(/Your name/i);
      if (await nameField.count()) await nameField.fill('Waitlist Tester');

      // Armed before the click, so a page that showed the banner for another reason cannot pass.
      const posted = joinWaitlist(page);
      await pack.getByRole('button', { name: 'Notify me' }).click();
      expect((await posted).status()).toBe(201);

      await expect(pack.getByText("You're on the waitlist!")).toBeVisible();

      const rows = await onBoard();
      expect(rows).toHaveLength(1);
      expect(rows[0].subject).toBe(WAITLIST_SUBJECT);
      expect(rows[0].team).toBe('packers');
      expect(rows[0].status).toBe('open');
    });

    await test.step('asking again does not put the same person on the board twice', async () => {
      await openHub(page);
      const pack = await packSection(page);

      await pack.getByPlaceholder('Enter mobile number').fill(MOBILE);
      const posted = joinWaitlist(page);
      await pack.getByRole('button', { name: 'Notify me' }).click();
      // 201 again, not 409: a conflict would tell a stranger whether a number was already listed.
      expect((await posted).status()).toBe(201);

      expect(await onBoard()).toHaveLength(1);
    });
  });

  test('nobody can read the waitlist back without a staff token', async () => {
    // The rows are unverified phone numbers, so there is no GET at all;
    // the board read above proves the server is answering.
    const res = await fetch(`${API}/service-waitlist`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  test('a malformed mobile is refused without a request', async ({ page }) => {
    await openHub(page);
    const pack = await packSection(page);

    let requested = false;
    page.on('request', (r) => { if (r.url().includes('/service-waitlist')) requested = true; });

    await pack.getByPlaceholder('Enter mobile number').fill('12345');
    await pack.getByRole('button', { name: 'Notify me' }).click();
    await expect(pack.getByText('Enter a valid 10-digit mobile number.')).toBeVisible();
    expect(requested).toBe(false);
  });
});
