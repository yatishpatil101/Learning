import { test, expect } from '../../../fixtures/live.js';

const filters = (page) => page.locator('aside:has(h3:has-text("Filters"))');
const facetRequest = (page, match = () => true) => page.waitForRequest((r) => {
  if (!r.url().includes('/properties?')) return false;
  return match(new URL(r.url()).searchParams);
}, { timeout: 15000 });

const urlParams = (page) => new URL(page.url()).searchParams;
const sameTokens = (actual, expected) => expect([...actual].sort()).toEqual([...expected].sort());

async function typeBudget(page, edge, text) {
  await filters(page).getByRole('button', { name: new RegExp(`Budget Range ${edge}`) }).click();
  const input = filters(page).getByRole('textbox', { name: `Budget Range ${edge} value` });
  await input.fill(text);
  await input.press('Enter');
}

test('BHK multi-select survives reload and reaches the wire as backend tokens', async ({ page }) => {
  const tokens = ['0', '2', '5plus'];
  const first = facetRequest(page, (q) => tokens.every((token) => q.getAll('bhks').includes(token)));
  await page.goto('/listings?deal=buy&bhks=0,2,5plus');

  sameTokens(new URL((await first).url()).searchParams.getAll('bhks'), tokens);
  await expect.poll(() => urlParams(page).get('bhks'), { timeout: 15000 }).toBe('0,2,5plus');
  await expect(filters(page).getByRole('button', { name: /BHK Type.*1 RK.*2 BHK.*5\+ BHK/i })).toBeVisible();

  const reloaded = facetRequest(page, (q) => tokens.every((token) => q.getAll('bhks').includes(token)));
  await page.reload();

  sameTokens(new URL((await reloaded).url()).searchParams.getAll('bhks'), tokens);
  await expect.poll(() => urlParams(page).get('bhks'), { timeout: 15000 }).toBe('0,2,5plus');
});

test('lakh and crore budget typing reaches the wire as numeric bounds', async ({ page }) => {
  await page.goto('/listings?deal=buy');

  await typeBudget(page, 'minimum', '50L');
  await expect.poll(() => urlParams(page).get('budget'), { timeout: 15000 }).toBe('5000000-50000000');

  const sent = facetRequest(page, (q) => q.get('minPrice') === '5000000' && q.get('maxPrice') === '12000000');
  await typeBudget(page, 'maximum', '1.2Cr');

  const q = new URL((await sent).url()).searchParams;
  expect(q.get('minPrice')).toBe('5000000');
  expect(q.get('maxPrice')).toBe('12000000');
  await expect.poll(() => urlParams(page).get('budget'), { timeout: 15000 }).toBe('5000000-12000000');
});

test('legacy availability URLs migrate to the Possession filter and wire construction', async ({ page }) => {
  const expected = ['under-construction', 'new-launch'];
  const sent = facetRequest(page, (q) => expected.every((token) => q.getAll('construction').includes(token)));
  await page.goto('/listings?deal=buy&avail=uc');

  sameTokens(new URL((await sent).url()).searchParams.getAll('construction'), expected);
  await expect.poll(() => urlParams(page).has('avail'), { timeout: 15000 }).toBe(false);
  expect(urlParams(page).get('constr')).toBe('under,new');
  await expect(filters(page).getByRole('button', { name: /Possession.*Under Construction.*New Launch/i })).toBeVisible();
});
