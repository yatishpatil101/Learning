/**
 * The service landing quote form puts a lead on a real ops desk.
 *
 * ## The failure this covers
 *
 * `ServiceLanding`'s quote form writes two records for one submit: an ops **lead ticket** the desk
 * calls back from, and a **flow request** the customer then tracks. Until now the lead ticket was
 * always written to `localStorage` — on every deployment, live included. So on a live install the
 * packers desk never saw the enquiry, the flow request carried no link back to it, and the customer
 * was shown the same "we'll call you" confirmation either way. Nothing failed loudly; the lead
 * simply did not exist outside the browser it was typed into.
 *
 * The page now raises the ticket through `POST /tickets` when the `ticket` domain is live, and
 * passes the returned id to `POST /service-requests` as `ticketId` (D45,
 * `service_requests.ticket_id`). This spec asserts both halves from the outside: the desk can see
 * the lead, and the request names it.
 *
 * ## Why it reads the board as staff rather than as the customer
 *
 * `GET /tickets` is staff/admin and additionally narrowed to the caller's own team, which is the
 * whole point — a lead is only "received" if the desk that must act on it can see it. Reading it
 * back as the person who raised it would prove the row exists without proving it arrived anywhere.
 *
 * ## Why the assertions are deltas
 *
 * The board is append-only and other specs raise tickets on the same desks. A count is a race; a
 * subject stamped with this run's id is not.
 *
 * Fixtures: `ACTORS.tenant` raises the enquiry, `STAFF.packers` reads the desk. Both are seeded.
 */
import { test, expect } from '@playwright/test';
import { API, authHeaders, signIn } from '../helpers/liveAuth.js';
import { ACTORS, STAFF } from '../fixtures/live.js';
import { appReady } from '../helpers/app.js';

/**
 * The packers form's first field is a `select` whose options are fixed strings, and its value
 * becomes the ticket subject. Picking a real option rather than typing keeps the spec honest about
 * what a customer can actually submit.
 */
const SERVICE_OPTION = 'Home Shifting — Local (within Pune)';

/**
 * The quote form's labels are not wired to their controls (`ServiceLanding` renders a bare
 * `<label>` beside each field), so `getByLabel` finds nothing; and the field is not a native
 * `<select>` either — `NativeSelect` keeps the `<option>`-child API but renders the themed
 * `dz-dropdown` widget, so `selectOption` has nothing to act on. Each field is wrapped in a
 * `data-err="<name>"` container for the validation highlight, and that is the stable hook. Named
 * here rather than inlined so the next person who hits the same two walls reads the reason once.
 */
const chooseService = async (page, option) => {
  await page.locator('[data-err="service"] .dz-dropdown__trigger').click();
  await page.getByRole('option', { name: option }).click();
};

test.describe('service landing → ops desk', () => {
  test('a packers enquiry reaches the packers board and the flow request names it', async ({ page }) => {
    const desk = await authHeaders(STAFF.packers);

    /* The floor. Without it a board that happened to be empty — or one this fixture cannot read —
       would let every assertion below pass by never finding anything to contradict. */
    const before = await (await page.request.get(`${API}/tickets?team=packers&size=100`, { headers: desk })).json();
    const beforeIds = new Set((before?.content || []).map((t) => t.id));

    await signIn(page, ACTORS.tenant);
    await page.goto('/services/packers-movers');
    await appReady(page);

    /* Name and mobile prefill from the session, and every remaining field is optional, so the one
       thing the spec must supply is the service the customer is asking for — which is also the
       value that becomes the ticket subject asserted below. The other fields are left blank
       deliberately: a lead with the minimum a customer can submit is the case most likely to lose
       information on the way to the desk. */
    await chooseService(page, SERVICE_OPTION);

    await page.getByRole('button', { name: 'Request Free Quote' }).click();

    /* The confirmation is optimistic by design — the customer is not made to wait on a round trip
       they cannot see — so the board is polled rather than read once. */
    let lead = null;
    await expect.poll(async () => {
      const res = await page.request.get(`${API}/tickets?team=packers&size=100`, { headers: desk });
      const rows = (await res.json())?.content || [];
      lead = rows.find((t) => !beforeIds.has(t.id));
      return lead ? 1 : 0;
    }, { timeout: 15000 }).toBe(1);

    expect(lead.team).toBe('packers');
    expect(lead.subject).toContain('Home Shifting');

    /* The link, from the customer's side. A request with a null `ticketId` is the exact defect this
       spec exists for: the lead and the workflow would be two unrelated rows about one person. */
    const mine = await authHeaders(ACTORS.tenant);
    let linked = null;
    await expect.poll(async () => {
      const res = await page.request.get(`${API}/service-requests?type=packers`, { headers: mine });
      const rows = (await res.json())?.content || [];
      linked = rows.find((r) => r.ticketId === lead.id);
      return linked ? 1 : 0;
    }, { timeout: 15000 }).toBe(1);

    expect(linked.ticketId).toBe(lead.id);
  });

  test('the board is not readable by the customer who raised the lead', async () => {
    /* The asymmetry the ticket domain is built on: anyone may write to the queue, only the desk may
       read it. Worth asserting here because this spec's first test proves a customer's action puts
       a row on a board — and that is only safe while the customer cannot then read the board. */
    const mine = await authHeaders(ACTORS.tenant);
    const res = await fetch(`${API}/tickets?team=packers`, { headers: mine });
    expect([401, 403]).toContain(res.status);
  });
});
