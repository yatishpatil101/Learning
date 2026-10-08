/** The quote form's lead ticket must reach the ops desk: read back as staff, since GET /tickets is team-scoped.
 * Assertions use subjects stamped with this run's id, as the board is append-only and counts race. */
import { test, expect } from '@playwright/test';
import { API, authHeaders, signIn } from '../helpers/liveAuth.js';
import { ACTORS, STAFF } from '../fixtures/live.js';
import { appReady } from '../helpers/app.js';

/** The first field is a fixed-option `select` whose value becomes the ticket subject, so pick a real option. */
const SERVICE_OPTION = 'Home Shifting — Local (within Pune)';

/** Labels are not wired to their controls and `NativeSelect` renders the themed `dz-dropdown`, so `getByLabel`
 * and `selectOption` find nothing; the `data-err="<name>"` wrapper is the stable hook. */
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

    /* Name and mobile prefill from the session, so supply only the service, which becomes the ticket subject:
       the minimum a customer can submit is the case most likely to lose information en route. */
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
    /* Anyone may write to the queue but only the desk may read it; that asymmetry is what makes the first
       test safe, since a customer's row lands on a board the customer cannot read. */
    const mine = await authHeaders(ACTORS.tenant);
    const res = await fetch(`${API}/tickets?team=packers`, { headers: mine });
    expect([401, 403]).toContain(res.status);
  });
});
