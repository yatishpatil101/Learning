import { ACTORS, expect, test } from '../../fixtures/live.js';
import { API, authHeaders, uploadedListingPhotos, uniqueMobile } from '../../helpers/liveAuth.js';

const PRIVATE_KEYS = ['address', 'electricityMeterNo', 'formDetails', 'description', 'images', 'amenities', 'flagReason'];

let seq = 0;
const newOwner = () => `${uniqueMobile().slice(0, -1)}${(seq++) % 10}`;

async function createListing(request) {
  const headers = await authHeaders(newOwner());
  const title = `Slim queue probe ${Date.now().toString(36)}${seq}`;
  const created = await request.post(`${API}/me/listings`, {
    headers,
    data: {
      title,
      deal: 'rent',
      propertyType: 'apartment',
      price: 26000,
      locality: 'Kothrud',
      city: 'Pune',
      description: 'South-facing flat with a covered balcony near the depot.',
      address: 'Flat 9C, Lotus Residency, Paud Road',
      electricityMeterNo: `MSEDCL-SLIM-${Date.now().toString(36)}${seq}`,
      images: await uploadedListingPhotos(headers),
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  return { ...(await created.json()), title };
}

test('a queue row is the slim projection and the detail read is the whole listing', async ({ request }) => {
  const listing = await createListing(request);
  const headers = await authHeaders(ACTORS.admin);

  const queue = await request.get(`${API}/admin/properties?q=${encodeURIComponent(listing.title)}&size=5`, { headers });
  expect(queue.status()).toBe(200);
  const row = (await queue.json()).content.find((r) => r.id === listing.id);
  expect(row, 'the new listing is in the queue').toBeTruthy();
  for (const key of PRIVATE_KEYS) expect(row, key).not.toHaveProperty(key);
  expect(Object.keys(row).length, 'row stays slim').toBeLessThan(50);
  expect(row.owner.mobile, 'the table renders the owner number').toBeTruthy();

  const detail = await request.get(`${API}/admin/properties/${listing.id}`, { headers });
  expect(detail.status()).toBe(200);
  expect(await detail.json()).toMatchObject({ id: listing.id, address: 'Flat 9C, Lotus Residency, Paud Road' });

  const seeker = await authHeaders(newOwner());
  expect((await request.get(`${API}/admin/properties/${listing.id}`, { headers: seeker })).status()).toBe(403);
});

test('opening the review modal is one detail read and one write; panels load when expanded', async ({ page, login, request }) => {
  const listing = await createListing(request);
  const calls = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith('/api/')) calls.push(`${req.method()} ${url.pathname.slice(4)}${url.search}`);
  });
  const seen = (pattern) => calls.filter((c) => pattern.test(c));

  await login.asAdmin();
  await page.goto(`/admin/properties?review=${listing.id}`);
  const modal = page.getByRole('dialog');
  await expect(modal.getByTestId('review-summary')).toContainText(listing.title);

  expect(seen(new RegExp(`^GET /admin/properties/${listing.id}$`))).toHaveLength(1);
  // StrictMode double-invokes the open effect in dev;
  // the contract is one merged write per invocation, never an open plus a read.
  expect(seen(new RegExp(`^POST /properties/${listing.id}/verification\\?markRead=true$`)).length).toBeGreaterThanOrEqual(1);
  expect(seen(new RegExp(`^POST /properties/${listing.id}/verification`))).toHaveLength(seen(/markRead=true/).length);
  expect(seen(/verification\/read/), 'the read receipt rides the open').toHaveLength(0);
  expect(seen(/\/outreach|message-templates|ownership/), 'collapsed panels stay quiet').toHaveLength(0);
  await expect.poll(() => seen(/^GET \/admin\/notes\//).length, 'only the decision note history, for its count').toBe(1);

  await modal.getByTestId('review-section-messages').click();
  await expect(modal.getByRole('button', { name: /Communication log/ })).toBeVisible();
  expect(seen(/\/outreach|message-templates/), 'the messages tab alone loads nothing extra').toHaveLength(0);

  await modal.getByRole('button', { name: /Communication log/ }).click();
  await expect.poll(() => seen(new RegExp(`^GET /properties/${listing.id}/outreach$`)).length).toBe(1);
  await expect.poll(() => seen(/^GET \/admin\/notes\//).length).toBe(2);

  expect(seen(/ownership/)).toHaveLength(0);
  await modal.getByTestId('review-section-badge').click();
  await expect.poll(() => seen(/GET \/properties\/.*\/verification\/ownership$/).length).toBe(1);
});
