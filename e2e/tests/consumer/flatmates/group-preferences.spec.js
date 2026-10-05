import { test, expect } from '@playwright/test';
import { apiLogin, signedInAsNew } from '../../../helpers/liveAuth.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';
import { trackErrors } from '../../../helpers/console.js';
import { postAsGroup } from '../../../helpers/app.js';

const track = flatmateCleanup(test);

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function pickFrom(page, trigger, options) {
  const picker = page.getByRole('button', { name: trigger });
  for (const option of options) {
    await picker.click();
    await page.locator('.dz-dropdown__option', { hasText: option }).first().click();
    await expect(picker, 'a pick closes the menu').toHaveAttribute('aria-expanded', 'false');
  }
}

async function openForm(page) {
  await page.goto('/flatmates');
  await expect(page.getByRole('button', { name: /Move in now/i })).toBeVisible({ timeout: 20_000 });
  await postAsGroup(page);
  await expect(page.getByPlaceholder(/2 girls/i)).toBeVisible({ timeout: 10_000 });
}

test.describe('LIVE: a group still looking for a flat', () => {
  test('posts its shortlist and budget ranges, and the card, detail and listings search all read them back', async ({ page, browser }) => {
    const errors = trackErrors(page);
    const mobile = await signedInAsNew(page);
    const { accessToken } = await apiLogin(mobile);
    const title = `Hunting group ${Date.now().toString(36)}`;
    await openForm(page);

    await expect(page.getByRole('button', { name: /Still looking for a flat/i })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByPlaceholder(/e\.g\. 34,000/i), 'an exact rent belongs to a flat the group does not have yet').toHaveCount(0);
    await expect(page.getByRole('button', { name: /Current tenant/i })).toHaveCount(0);

    await page.getByPlaceholder(/2 girls/i).fill(title);
    await pickFrom(page, "Localities you'd live in", ['Baner', 'Wakad']);
    await page.getByRole('button', { name: '2 BHK' }).click();
    await page.getByRole('button', { name: '3 BHK' }).click();
    await page.getByLabel('Lowest rent for the whole flat').fill('30000');
    await page.getByLabel('Highest rent for the whole flat').fill('45000');
    await expect(page.getByTestId('group-per-head-range')).toHaveText('₹15,000 – ₹22,500/mo');
    await page.getByLabel('Lowest deposit').fill('60000');
    await page.getByLabel('Highest deposit').fill('100000');
    await page.getByRole('button', { name: 'Furnishing' }).click();
    await page.getByRole('option', { name: 'Semi-furnished' }).click();
    await page.getByLabel('Gated society only').check();
    await page.getByLabel('Owner must allow bachelors').check();
    const moveIn = page.getByTestId('group-preferences').getByTestId('move-in-field');
    await expect(moveIn.getByRole('button', { name: 'Flexible', exact: true }), 'a group states no move-in date unless asked').toHaveAttribute('aria-pressed', 'true');
    await moveIn.getByRole('button', { name: 'Immediate', exact: true }).click();
    await page.getByPlaceholder(/Your name/i).fill('Hunt Host');

    const posted = page.waitForResponse((r) => /\/api\/flatmates\/groups(\?|$)/.test(r.url()) && r.request().method() === 'POST');
    await page.getByRole('button', { name: /Create group/i }).click();
    const res = await posted;
    expect(res.status()).toBe(201);
    const sent = res.request().postDataJSON();
    expect(sent.rent, 'no exact rent is invented for a flat not yet found').toBeUndefined();
    expect(sent.locality).toBeUndefined();
    expect(sent.preferences.moveInBy, '"Immediately" travels as today, so the move-in filter can compare it').toBe(todayIso());
    const group = await res.json();
    track('groups', group.id, accessToken);
    expect(group.preferences).toMatchObject({
      localities: ['Baner', 'Wakad'], bhk: ['2', '3'], rentMin: 30000, rentMax: 45000,
      depositMin: 60000, depositMax: 100000, furnishing: 'semi', gatedOnly: true, bachelors: true,
    });
    expect(group.propertyId ?? null).toBeNull();
    expect(group.modStatus, 'a group with no flat publishes itself').toBe('live');
    await expect(page.getByText('Your group is live.')).toBeVisible();

    const origin = new URL(page.url()).origin;
    const stranger = await browser.newPage();
    await stranger.goto(`${origin}/flatmates?view=team-up`);
    const card = stranger.locator('.sf-card', { hasText: title });
    await expect(card).toBeVisible({ timeout: 20_000 });
    for (const fact of ['Baner, Wakad', 'Looking for a flat', 'Immediately']) {
      await expect(card.getByText(fact, { exact: true })).toBeVisible();
    }
    await expect(card.getByText(/₹15,000 – ₹22,500/)).toBeVisible();

    await stranger.goto(`${origin}/flatmates?view=team-up&movein=now`);
    await expect(stranger.locator('.sf-card', { hasText: title }), 'the board’s Immediate filter finds the group').toBeVisible({ timeout: 20_000 });
    await stranger.close();

    await page.goto(`/flatmates/group/${group.id}`);
    await expect(page.getByRole('heading', { name: /The flat we’re looking for/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Immediately').first()).toBeVisible();
    const find = page.getByTestId('group-find-flats');
    const href = new URL(await find.getAttribute('href'), 'http://x');
    expect(href.pathname).toBe('/listings');
    expect(Object.fromEntries(href.searchParams)).toMatchObject({
      deal: 'rent', loc: 'baner,wakad', bhks: '2,3', rent: '30000-45000', deposit: '60000-100000',
      furn: 'semi', tenants: 'bachelors', amen: 'security',
    });

    expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
  });

  test('refuses a shortlist-less or upside-down budget, or a phone number, before anything is sent', async ({ page }) => {
    await signedInAsNew(page);
    await openForm(page);
    let sent = false;
    page.on('request', (r) => { if (/\/api\/flatmates\/groups(\?|$)/.test(r.url()) && r.method() === 'POST') sent = true; });

    await page.getByPlaceholder(/2 girls/i).fill('Unready group');
    await page.getByPlaceholder(/Your name/i).fill('Nobody Yet');
    await page.getByRole('button', { name: /Create group/i }).click();
    await expect(page.getByText('Pick at least one locality.').first()).toBeVisible();

    await pickFrom(page, "Localities you'd live in", ['Baner']);
    await page.getByLabel('Lowest rent for the whole flat').fill('50000');
    await page.getByLabel('Highest rent for the whole flat').fill('40000');
    await page.getByRole('button', { name: /Create group/i }).click();
    await expect(page.getByText('Max budget can’t be below min.').first()).toBeVisible();

    await page.getByLabel('Highest rent for the whole flat').fill('60000');
    await page.getByPlaceholder(/2 girls/i).fill('Call 98200 11223');
    await page.getByRole('button', { name: /Create group/i }).click();
    await expect(page.getByText(/Remove the phone number, email or link/).first()).toBeVisible();
    expect(sent).toBe(false);
  });
});
