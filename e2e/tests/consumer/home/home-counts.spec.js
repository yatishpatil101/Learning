import { expect, test } from '../../../fixtures/live.js';
import { API } from '../../../helpers/liveAuth.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const TILES = [
  { title: 'Flats', types: ['flat'], expectedDeal: 'buy' },
  { title: 'Commercial', types: ['commercial'], dealFromStock: true },
  { title: 'Plots / Land', types: ['plot', 'farmland'], expectedDeal: 'buy' },
  { title: 'Villas & Houses', types: ['house', 'villa'], expectedDeal: 'buy' },
];

test('home category tiles render the server count and link to the matching deal', async ({ page, request }) => {
  const counts = await liveCounts(request);

  await page.goto(BASE);

  for (const tile of TILES) {
    const deal = dealFor(tile, counts);
    const expected = countFor(tile.types, deal, counts);
    const link = page.getByRole('link', { name: new RegExp(`^${escapeRegExp(tile.title)}\\b`) }).first();

    await expect(link).toContainText(new RegExp(`${formatCount(expected)}\\s*properties`, 'i'));
    const href = await link.getAttribute('href');
    const url = new URL(href, BASE);
    expect(url.pathname).toBe('/listings');
    expect(url.searchParams.get('deal')).toBe(deal);
    expect(url.searchParams.get('type')).toBe(tile.types.join(','));
  }
});

async function liveCounts(request) {
  const res = await request.get(`${API}/bootstrap`);
  expect(res.status(), 'GET /bootstrap').toBe(200);
  const body = (await res.json()).counts;
  return new Map((body.counts || []).map((row) => [`${row.category}:${row.deal}`, Number(row.count) || 0]));
}

function countFor(types, deal, counts) {
  return types.reduce((sum, type) => sum + (counts.get(`${type}:${deal}`) || 0), 0);
}

function dealFor(tile, counts) {
  if (!tile.dealFromStock) return tile.expectedDeal;
  const rent = countFor(tile.types, 'rent', counts);
  const buy = countFor(tile.types, 'buy', counts);
  if (rent === 0 && buy > 0) return 'buy';
  return rent >= buy ? 'rent' : 'buy';
}

function formatCount(value) {
  return new Intl.NumberFormat('en-IN').format(value);
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
