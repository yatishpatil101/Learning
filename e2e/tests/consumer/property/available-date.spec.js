import { ACTORS, expect, test } from '../../../fixtures/live.js';
import { API, authHeaders, ownerIdOf, storedPhotoUrl, uniqueMobile } from '../../../helpers/liveAuth.js';
import { approveListing, rejectListing } from '../../../helpers/moderation.js';

const created = new Set();
let seq = 0;

const nextOwner = () => `${uniqueMobile().slice(0, -1)}${(seq++) % 10}`;

const isoInDays = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const monthYear = (iso) => {
  const [year, month, day] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric' })
    .format(new Date(year, month - 1, day));
};

async function publish(request, availableFrom) {
  const headers = await authHeaders(nextOwner());
  const create = await request.post(`${API}/me/listings`, {
    headers,
    data: {
      title: `Zztest sqm possession ${Date.now()}`,
      deal: 'buy',
      propertyType: 'Open Plot',
      price: 7200000,
      locality: 'Wagholi',
      city: 'Pune',
      area: 450,
      areaUnit: 'sqm',
      landUse: 'residential',
      possession: 'under-construction',
      images: [storedPhotoUrl('', ownerIdOf(headers))],
      formDetails: {
        availableFrom,
        plotZone: 'Residential',
      },
    },
  });
  expect(create.status(), await create.text()).toBe(201);
  const { id } = await create.json();
  created.add(id);

  const approve = await approveListing(request, id, await authHeaders(ACTORS.admin));
  expect(approve.status(), await approve.text()).toBeLessThan(300);
  return id;
}

test.afterEach(async ({ request }) => {
  if (!created.size) return;
  const headers = await authHeaders(ACTORS.admin);
  for (const id of created) {
    await rejectListing(request, id, headers, { reason: 'Zztest cleanup' });
  }
  created.clear();
});

test('a plot shows the real possession date and square metre unit', async ({ page, request }) => {
  const availableFrom = isoInDays(90);
  const id = await publish(request, availableFrom);

  await page.goto(`/property/${id}`);

  const detail = (label) => page.locator('.detail-card', { hasText: label });
  await expect(detail('Possession')).toContainText(`From ${monthYear(availableFrom)}`);
  await expect(detail('Plot Area')).toContainText('450 sq.m.');
});
