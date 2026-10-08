import { expect, test } from '../../../fixtures/live.js';
import { API, uniqueMobile } from '../../../helpers/liveAuth.js';
import { mintSociety } from '../../../helpers/liveSociety.js';

/* `/societies` lists the societies the server holds: rows are read back over HTTP before the page opens (never compared with a copy of itself),
 * signed out, so a row an anonymous reader sees came from the catalogue and not from anything scoped to its author. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const SEARCH = 'Search by society, builder or locality';

async function mintedSociety(request, label) {
  const slug = await mintSociety(request, uniqueMobile(), label);
  const res = await request.get(`${API}/societies/${slug}`);
  expect(res.status()).toBe(200);
  return { slug, row: await res.json() };
}

/** `.glass` is the card's own shell; the toolbar and the empty state share the class but hold no society link. */
function cardFor(page, name) {
  return page.locator('.glass').filter({ has: page.getByRole('link', { name, exact: true }) });
}

/* `toHaveCount(1)` rather than `toBeVisible()`: while the filtered grid is repainting the locator
   matches several cards, a strict-mode violation that aborts the expectation instead of retrying. */
async function findInDirectory(page, name) {
  await page.goto(`${BASE}/societies`);
  await page.getByPlaceholder(SEARCH).fill(name);
  const card = cardFor(page, name);
  await expect(card).toHaveCount(1, { timeout: 30_000 });
  return card;
}

test('the directory lists a society minted after the seed', async ({ page, request }) => {
  const { slug, row } = await mintedSociety(request, 'dirlist');
  expect(row.name, 'the server named the society it just minted').toBeTruthy();

  const card = await findInDirectory(page, row.name);

  await expect(card.getByText(titleCase(row.localitySlug), { exact: false })).toHaveCount(1);
  await expect(card.getByRole('link', { name: row.name, exact: true }))
    .toHaveAttribute('href', `/society/${slug}`);
});

test('a card wears no Verified badge, and the directory never asks the server to filter on it', async ({ page, request }) => {
  const asked = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.pathname === '/api/societies') asked.push(url.searchParams.has('verified'));
  });
  const { row } = await mintedSociety(request, 'dirnobadge');

  const card = await findInDirectory(page, row.name);

  await expect(card.getByText('Verified', { exact: true })).toHaveCount(0);
  expect(asked.length, 'the directory read the catalogue').toBeGreaterThan(0);
  expect(asked.every((v) => v === false), 'a verified filter was sent').toBe(true);
});

/** The page's own transform, duplicated so the expectation does not depend on the code under test. */
function titleCase(slug) {
  return String(slug || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
