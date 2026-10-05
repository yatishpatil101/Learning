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

  test('opens with greeting and chips, escalates a nonsense query, answers a how-to with a deep link, all error-free', async ({ page, consoleErrors }) => {
    test.slow();
    // A non-live city renders the bottom waitlist bar that can overlap this FAB.
    await page.goto('/');
    await openPanel(page);
    const box = page.getByRole('dialog', { name: PANEL });
    const ask = async (q) => {
      await box.getByRole('textbox', { name: 'Ask Draaz' }).fill(q);
      await box.getByRole('button', { name: /^Send$/i }).click();
    };

    await test.step('greeting, quick chips, and Esc closes', async () => {
      await expect(page.getByText(/your Draazy guide/i)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Find a home', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'List my property', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: PANEL })).toHaveCount(0);
      await openPanel(page);
    });

    await test.step('a low-confidence query offers human-support escalation', async () => {
      await ask('zzqqxx nonsense');
      await expect(box.getByRole('button', { name: /Raise a support ticket/i })).toBeVisible({ timeout: 5000 });
    });

    await test.step('a how-to query is answered and its action deep-links', async () => {
      await ask('how do I contact an owner');
      await expect(box.getByText(/sends the owner a contact request/i)).toBeVisible({ timeout: 5000 });
      await box.getByRole('button', { name: /Browse listings/i }).click();
      await page.waitForURL('**/listings**');
      expect(page.url()).toContain('/listings');
    });

    expect(consoleErrors).toHaveLength(0);
  });
  test('does not overlap the city waitlist bar on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    // Seed consent so the separate banner cannot obscure the assistant being measured.
    await page.addInitScript(() => {
      localStorage.setItem('dz_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }));
    });
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

  test('on a phone the open panel is centred and holds the page still', async ({ page }) => {
    await page.setViewportSize({ width: 440, height: 800 });
    await page.addInitScript(() => {
      localStorage.setItem('dz_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }));
    });
    await page.goto('/listings?deal=buy');
    await page.evaluate(() => window.scrollTo(0, 300));
    const before = await page.evaluate(() => window.scrollY);
    await openPanel(page);
    const panel = page.getByRole('dialog', { name: PANEL });
    await expect.poll(() => panel.evaluate((p) => {
      const l = p.parentElement;
      const cs = getComputedStyle(l);
      const pr = p.getBoundingClientRect();
      const lr = l.getBoundingClientRect();
      return cs.left === cs.right && Math.abs((pr.left - lr.left) - (lr.right - pr.right)) <= 1;
    })).toBe(true);
    const box = await panel.boundingBox();

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.scrollY)).toBe(before);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: PANEL })).toHaveCount(0);
    await page.mouse.wheel(0, 600);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
  });

});
