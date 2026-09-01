import { test, expect, ACTORS, STAFF } from '../../../fixtures/live.js';
import { API, authHeaders } from '../../../helpers/liveAuth.js';
import { appReady } from '../../../helpers/app.js';

/**
 * The Move-in Pack booking against the live API.
 *
 * The pack is the one consumer surface with a price the customer assembles themselves: six line
 * items, a 12% bundle discount, and a total they see before they agree to it. That total had
 * nowhere to go. `TicketCreate` refuses `value` on the sound grounds that a client writing its own
 * deal value is a client writing the pipeline report — but the rule was being read as "no money
 * from clients", so against Postgres the booking wrote nothing at all and the customer got a
 * success toast for a lead that reached nobody.
 *
 * D3 split the two facts apart: `quotedValue` is what the customer accepted, `value` stays ops'.
 * These tests are therefore mostly about the number, not the booking — a booking that arrives
 * without its price is a packers desk phoning to ask what was ordered.
 *
 * The strongest assertion here is the cross-boundary one: the total is computed in the browser from
 * admin-set prices, and read back off the ops board through a *different* account's token. Nothing
 * in the assertion path can see the arithmetic the page did.
 *
 * Fixtures: ACTORS.buyer books; STAFF.packers reads the board back, because GET /tickets is
 * ops-only and the buyer is refused it — which is itself asserted below.
 */

/** The prices the mock spec uses, so the arithmetic below is checkable by hand. */
const PRICES = { movers: 8000, clean: 2500, agreement: 1500, paint: 6000, verify: 999, internet: 500 };

/** Two items, and the 12% bundle discount the page applies to the whole pack. */
const CHOSEN = ['Packers & Movers', 'Deep Cleaning'];
const TOTAL = PRICES.movers + PRICES.clean;
const EXPECTED_QUOTE = TOTAL - Math.round(TOTAL * 0.12);

/** Newest-first, and scoped to the desk this booking lands on. */
async function packersBoard() {
  const res = await fetch(`${API}/tickets?size=20`, { headers: await authHeaders(STAFF.packers) });
  expect(res.status).toBe(200);
  const body = await res.json();
  return body.content || [];
}

/* Publishing the pack is now a server-side act, so this spec performs it as one.

   It used to be faked: `useMovePackConfig` read `settings.movePack` straight out of browser
   storage, so the only way to switch the pack on was to reach into localStorage and the `settings`
   domain being live changed nothing on this page. `GET /move-pack` closed that, and the spec got
   stronger rather than merely different — the prices asserted below are now the ones an
   administrator actually published, through the same route the console uses, and the arithmetic
   crosses the network twice before anything is checked.

   Restored in `afterAll` because the live database is not reset between specs and the seeded state
   is coming-soon: leaving the pack on sale would silently rewrite what the waitlist spec is
   testing. That spec sets its own state anyway, so this is belt and braces, not the only guard. */
async function setMovePack(patch) {
  const res = await fetch(`${API}/admin/settings`, {
    method: 'PUT',
    // `authHeaders` already sets `content-type`. Adding a second, differently-cased key here sends
    // the header twice and the server answers 415.
    headers: await authHeaders(ACTORS.admin),
    body: JSON.stringify({ movePack: patch }),
  });
  expect(res.status).toBe(200);
}

async function openHubWithPackLive(page) {
  await page.goto('/services');
  await appReady(page);
}

/* Everything below the fold sits at opacity 0 until `useScrollReveal` fires, and Playwright will
   not scroll to something it reads as invisible — a deadlock. Force the end state. */
async function packSection(page) {
  await expect(page.locator('a.svc-card')).toHaveCount(9);
  await page.evaluate(() => document.querySelectorAll('.reveal').forEach((el) => el.classList.add('visible')));
  const section = page.locator('section').filter({ hasText: 'PuneNest Move-in Pack' }).last();
  await expect(section).toBeVisible();
  return section;
}

async function bookPack(page) {
  const pack = await packSection(page);
  for (const name of CHOSEN) await pack.getByRole('button', { name: new RegExp(name) }).click();
  await pack.getByRole('button', { name: 'Book Move-in Pack' }).click();
  return pack;
}

test.describe('Move-in Pack booking (live)', () => {
  test.beforeAll(async () => { await setMovePack({ enabled: true, items: PRICES }); });
  test.afterAll(async () => { await setMovePack({ enabled: false }); });

  test('the booking reaches the ops board with the price the customer accepted', async ({ page, login }) => {
    const before = (await packersBoard()).length;
    await login.asBuyer();
    await openHubWithPackLive(page);
    await bookPack(page);
    await expect(page.getByText(/Move-in Pack booked/i)).toBeVisible();

    await expect.poll(async () => (await packersBoard()).length).toBe(before + 1);
    const [latest] = await packersBoard();
    expect(latest.subject).toBe('Move-in Pack booking');
    expect(latest.team).toBe('packers');
    // The number the customer agreed to, arrived at in the browser and read back off a different
    // account's view of the board.
    expect(latest.quotedValue).toBe(EXPECTED_QUOTE);
    // The other half of the split, and the reason the column exists: accepting a price from the
    // client did not also let it write the pipeline figure. These two fail together the day
    // somebody decides one money column was enough.
    expect(latest.value).toBeNull();
  });

  test('the desk can see what was ordered, not just what it cost', async ({ page, login }) => {
    await login.asBuyer();
    await openHubWithPackLive(page);
    await bookPack(page);
    await expect(page.getByText(/Move-in Pack booked/i)).toBeVisible();

    // A price with no line items is a quote nobody can honour. Asserted as a whole rather than by
    // sampling one item, because a mapper that drops a field drops it quietly.
    await expect.poll(async () => (await packersBoard())[0]?.detail).toBe(CHOSEN.join(', '));
    const [latest] = await packersBoard();
    // Identity comes off the session, never off the page — the form never asked for either of
    // these, so their presence is the server's doing.
    expect(latest.mobile).toBe(ACTORS.buyer);
    expect(latest.customer).toBeTruthy();
  });

  test('the booking leaves the browser', async ({ page, login }) => {
    await login.asBuyer();
    await openHubWithPackLive(page);
    const pack = await packSection(page);
    for (const name of CHOSEN) await pack.getByRole('button', { name: new RegExp(name) }).click();

    // Armed before the click, because the whole defect this replaces was a page that showed the
    // success toast without a request ever being made. A toast is not evidence.
    const posted = page.waitForRequest(
      (r) => r.method() === 'POST' && /\/api\/tickets$/.test(new URL(r.url()).pathname),
      { timeout: 15_000 },
    );
    await pack.getByRole('button', { name: 'Book Move-in Pack' }).click();
    const body = JSON.parse((await posted).postData() || '{}');
    expect(body.quotedValue).toBe(EXPECTED_QUOTE);
    // `value` must not be in the body at all — not present-and-null. A client that sends the key is
    // a client one lenient mapper away from setting it.
    expect(Object.keys(body)).not.toContain('value');
  });

  test('a signed-out visitor is sent to sign in before anything is written', async ({ page }) => {
    const before = (await packersBoard()).length;
    await openHubWithPackLive(page);
    const pack = await packSection(page);
    for (const name of CHOSEN) await pack.getByRole('button', { name: new RegExp(name) }).click();
    await pack.getByRole('button', { name: 'Book Move-in Pack' }).click();

    await expect(page).toHaveURL(/\/signin/);
    // The negative half, with the redirect above as its positive anchor: the gate runs before the
    // write, not after it, so no half-identified ticket reaches the desk.
    expect((await packersBoard()).length).toBe(before);
  });

  test('the customer who booked cannot read the board they booked onto', async () => {
    // The asymmetry the whole ticket API is built on, asserted from the consumer side: writing to
    // the queue is open to any signed-in caller, reading it is not.
    const res = await fetch(`${API}/tickets?size=1`, { headers: await authHeaders(ACTORS.buyer) });
    expect(res.status).toBe(403);
  });
});
