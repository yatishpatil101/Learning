import { test, expect } from '../../fixtures/live.js';

// Anchoring prevents the assistant's short name from matching broader Draazy controls.
const FAB = /^(Ask|Open) Draaz\b/i;
const PANEL = 'Draaz help assistant';

async function openPanel(page) {
  await page.getByRole('button', { name: FAB }).first().click();
  await expect(page.getByRole('dialog', { name: PANEL })).toBeVisible();
}

test.describe('Draaz assistant', () => {
  test('FAB visible on consumer pages, absent on full-bleed reels', async ({ page }) => {
    for (const path of ['/', '/listings?deal=buy']) {
      await page.goto(path);
      await expect(page.getByRole('button', { name: FAB }).first())
        .toBeVisible({ timeout: 5000 });
    }
    await page.goto('/reels');
    await page.waitForTimeout(400);
    await expect(page.getByRole('button', { name: FAB })).toHaveCount(0);
  });

  test('opens with greeting + quick chips, Esc closes', async ({ page }) => {
    await page.goto('/');
    await openPanel(page);
    await expect(page.getByText(/your Draazy guide/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Find a home', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'List my property', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: PANEL })).toHaveCount(0);
  });

  test('answers a how-to query and its action deep-links', async ({ page }) => {
    await page.goto('/');
    await openPanel(page);
    const box = page.getByRole('dialog', { name: PANEL });
    await box.getByRole('textbox', { name: 'Ask Draaz' }).fill('how do I contact an owner');
    await box.getByRole('button', { name: /^Send$/i }).click();
    await expect(box.getByText(/contact details unlock/i)).toBeVisible({ timeout: 5000 });
    await box.getByRole('button', { name: /Browse listings/i }).click();
    await page.waitForURL('**/listings**');
    expect(page.url()).toContain('/listings');
  });

  test('low-confidence query offers human-support escalation', async ({ page }) => {
    await page.goto('/');
    await openPanel(page);
    const box = page.getByRole('dialog', { name: PANEL });
    await box.getByRole('textbox', { name: 'Ask Draaz' }).fill('zzqqxx nonsense');
    await box.getByRole('button', { name: /^Send$/i }).click();
    await expect(box.getByRole('button', { name: /Raise a support ticket/i })).toBeVisible({ timeout: 5000 });
  });

  test('does not overlap the city waitlist bar on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    // Seed consent so the separate banner cannot obscure the assistant being measured.
    await page.addInitScript(() => {
      localStorage.setItem('dz_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }));
    });
    // A non-live city renders the bottom waitlist bar that can overlap this FAB.
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('draazyCity', 'Nagpur'));
    await page.reload();
    const bar = page.getByText(/join the waitlist/i).first();
    await expect(bar).toBeVisible({ timeout: 5000 });
    const fab = page.getByRole('button', { name: FAB }).first();
    await expect(fab).toBeVisible();
    const fb = await fab.boundingBox();
    const bb = await bar.boundingBox();
    const overlap = fb.x < bb.x + bb.width && fb.x + fb.width > bb.x
      && fb.y < bb.y + bb.height && fb.y + fb.height > bb.y;
    expect(overlap).toBeFalsy();
  });

  test('no console/page errors with the assistant mounted', async ({ page, consoleErrors }) => {
    await page.goto('/');
    await openPanel(page);
    const box = page.getByRole('dialog', { name: PANEL });
    await box.getByRole('textbox', { name: 'Ask Draaz' }).fill('how does draazy work');
    await box.getByRole('button', { name: /^Send$/i }).click();
    await page.waitForTimeout(400);
    expect(consoleErrors).toHaveLength(0);
  });
});
