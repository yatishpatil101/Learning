import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';

/* Nestor help-assistant acceptance tests (see session plan). The widget is a
   floating concierge mounted in ConsumerLayout on every consumer page. */

async function openPanel(page) {
  await page.getByRole('button', { name: /Nestor/i }).first().click();
  await expect(page.getByRole('dialog', { name: /Nestor/i })).toBeVisible();
}

test.describe('Nestor assistant', () => {
  test('FAB visible on consumer pages, absent on full-bleed reels', async ({ page }) => {
    for (const path of ['/', '/listings?deal=buy']) {
      await page.goto(`${BASE}${path}`);
      await expect(page.getByRole('button', { name: /Ask Nestor|Open Nestor/i }).first())
        .toBeVisible({ timeout: 5000 });
    }
    await page.goto(`${BASE}/reels`);
    await page.waitForTimeout(400);
    await expect(page.getByRole('button', { name: /Nestor/i })).toHaveCount(0);
  });

  test('opens with greeting + quick chips, Esc closes', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await openPanel(page);
    await expect(page.getByText(/your PuneNest guide/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Find a home', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'List my property', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: /Nestor/i })).toHaveCount(0);
  });

  test('answers a how-to query and its action deep-links', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await openPanel(page);
    const box = page.getByRole('dialog', { name: /Nestor/i });
    await box.getByRole('textbox', { name: /Ask Nestor/i }).fill('how do I contact an owner');
    await box.getByRole('button', { name: /^Send$/i }).click();
    // An answer bubble appears...
    await expect(box.getByText(/contact details unlock/i)).toBeVisible({ timeout: 5000 });
    // ...with a working deep-link action.
    await box.getByRole('button', { name: /Browse listings/i }).click();
    await page.waitForURL('**/listings**');
    expect(page.url()).toContain('/listings');
  });

  test('low-confidence query offers human-support escalation', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await openPanel(page);
    const box = page.getByRole('dialog', { name: /Nestor/i });
    await box.getByRole('textbox', { name: /Ask Nestor/i }).fill('zzqqxx nonsense');
    await box.getByRole('button', { name: /^Send$/i }).click();
    await expect(box.getByRole('button', { name: /Raise a support ticket/i })).toBeVisible({ timeout: 5000 });
  });

  test('does not overlap the city waitlist bar on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    // Seed cookie consent so the DPDPA banner doesn't keep the Nestor FAB max-sm:hidden on mobile.
    await page.addInitScript(() => {
      localStorage.setItem('pn_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }));
    });
    // Force a non-live city so CityChrome shows its bottom waitlist bar.
    await page.goto(`${BASE}/`);
    await page.evaluate(() => localStorage.setItem('puneNestCity', 'Nagpur'));
    await page.reload();
    const bar = page.getByText(/join the waitlist/i).first();
    await expect(bar).toBeVisible({ timeout: 5000 });
    const fab = page.getByRole('button', { name: /Ask Nestor|Open Nestor/i }).first();
    await expect(fab).toBeVisible();
    const fb = await fab.boundingBox();
    const bb = await bar.boundingBox();
    const overlap = fb.x < bb.x + bb.width && fb.x + fb.width > bb.x
      && fb.y < bb.y + bb.height && fb.y + fb.height > bb.y;
    expect(overlap).toBeFalsy();
  });

  test('no console/page errors with the assistant mounted', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/`);
    await openPanel(page);
    const box = page.getByRole('dialog', { name: /Nestor/i });
    await box.getByRole('textbox', { name: /Ask Nestor/i }).fill('how does punenest work');
    await box.getByRole('button', { name: /^Send$/i }).click();
    await page.waitForTimeout(400);
    expect(errors).toHaveLength(0);
  });
});
