import { expect } from '@playwright/test';
import { stubGooglePlaces } from './places.js';

const API = `http://localhost:${process.env.API_PORT || '8081'}/api`;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const localityField = (page) => page.locator('[data-err="locality"]');

const localityMenu = (page) => page.locator('.dz-dropdown__menu.is-portal-open');

const optionNamed = (page, name) => localityMenu(page).locator('.dz-dropdown__option')
  .filter({ hasText: new RegExp(`^\\s*${escapeRe(name)}(?![A-Za-z])`, 'i') }).first();

async function triggerOf(field) {
  const trigger = field.locator('.dz-dropdown__trigger');
  return (await trigger.count()) ? trigger.first() : field;
}

// A locality exists only because it was picked, so the picker is searched by typing; the dev seed makes
// the curated names live, so the search fallback offers them with no Google stub.
export async function chooseLocality(page, opener, name = 'Baner', { query = name, domClick = false, tap = false } = {}) {
  await (tap ? opener.tap() : opener.click());
  await expect(localityMenu(page)).toBeVisible();
  await localityMenu(page).locator('.dz-dropdown__search input').fill(query);
  const option = optionNamed(page, name);
  await expect(option).toBeVisible({ timeout: 15000 });
  const multi = (await localityMenu(page).getAttribute('aria-multiselectable')) === 'true';
  if (domClick) await option.evaluate((el) => el.click());
  else if (tap) await option.tap();
  else await option.click();
  if (multi && await localityMenu(page).isVisible()) await page.keyboard.press('Escape');
  await expect(localityMenu(page)).toBeHidden();
}

export async function pickLocalitiesIn(page, trigger, names, opts) {
  for (const name of names) await chooseLocality(page, trigger, name, opts);
}

export async function pickLocalityIn(page, field, name = 'Baner', opts) {
  await chooseLocality(page, await triggerOf(field), name, opts);
  await expect(field.locator('.dz-dropdown__value')).toContainText(new RegExp(escapeRe(name), 'i'));
}

export const pickLocality = (page, name = 'Baner', opts) => pickLocalityIn(page, localityField(page), name, opts);

export async function pickPlaceholderLocality(page, name = 'Baner', opts) {
  await chooseLocality(page, page.getByText('Select locality'), name, opts);
  await expect(page.getByText('Select locality')).toHaveCount(0);
}

export const GOOGLE_LOCALITY_TYPES = ['sublocality_level_1', 'sublocality', 'political'];

// Defaults sit in Baner, so another name needs its own coordinates or the server mints a new row.
export async function pickGoogleLocality(page, name, {
  field = localityField(page), lat = 18.559, lng = 73.787, types = GOOGLE_LOCALITY_TYPES, expectValue = name, ...stub
} = {}) {
  await stubGooglePlaces(page, { lat, lng, locality: name, types, ...stub });
  await (await triggerOf(field)).click();
  await expect(localityMenu(page)).toBeVisible();
  await localityMenu(page).locator('.dz-dropdown__search input').fill(name);
  const option = localityMenu(page).locator('.dz-dropdown__option').filter({ hasText: name }).first();
  await expect(option).toBeVisible({ timeout: 15000 });
  await option.click();
  if (expectValue) await expect(field.locator('.dz-dropdown__value')).toContainText(expectValue);
}

export async function mintLocality(name, { lat = 18.52, lng = 73.85 } = {}) {
  const res = await fetch(`${API}/localities/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ placeId: `mint-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name, lat, lng, types: GOOGLE_LOCALITY_TYPES }),
  });
  expect(res.status, 'the dev lookup trusts the client hint').toBe(200);
  return res.json();
}

export const uniqueLocalityName = (prefix = 'Zztest Mint') => `${prefix} ${Date.now().toString(36)}`;

// What the home search offers by name: a locality is suggested only while it has approved listings for the deal.
export async function stockBySlug(deal = 'buy') {
  const stock = new Map();
  for (let page = 0; page < 20; page++) {
    const res = await fetch(`${API}/properties?deal=${deal}&size=100&page=${page}`);
    expect(res.ok, `GET /properties page ${page} -> ${res.status}`).toBe(true);
    const body = await res.json();
    for (const p of body.content || []) {
      const row = stock.get(p.localitySlug) || { name: p.locality, count: 0 };
      stock.set(p.localitySlug, { ...row, count: row.count + 1 });
    }
    if (page + 1 >= (body.totalPages ?? 1)) break;
  }
  return stock;
}