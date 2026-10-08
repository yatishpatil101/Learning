import { test, expect } from '../../fixtures/live.js';

// Content budget: on a phone, the primary content of a money route must be on the first screen.
const consent = (page) =>
  page.addInitScript(() => {
    localStorage.setItem(
      'dz_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() }),
    );
  });

// Fully inside the first screen — no scrolling, and not under the bottom chrome.
async function expectAboveTheFold(page, locator, label) {
  await expect(locator, `${label} should render`).toBeVisible();
  const box = await locator.boundingBox();
  const vh = page.viewportSize().height;
  expect(box, `${label} should have a box`).not.toBeNull();
  expect(box.y, `${label} starts below the fold (y=${Math.round(box.y)}, viewport=${vh})`).toBeLessThan(vh);
  expect(
    box.y + box.height,
    `${label} is cut off by the fold (ends at ${Math.round(box.y + box.height)}, viewport=${vh})`,
  ).toBeLessThanOrEqual(vh);
}

// Nothing may be painted on top of the element's centre.
async function expectNothingCovering(page, locator, label) {
  const box = await locator.boundingBox();
  expect(box, `${label} should have a box`).not.toBeNull();
  const covering = await page.evaluate(
    ({ x, y, w, h }) => {
      const cx = x + w / 2;
      const cy = y + h / 2;
      // elementFromPoint is viewport-relative and returns null outside it.
      if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) {
        return 'OFFSCREEN';
      }
      const el = document.elementFromPoint(cx, cy);
      if (!el) return 'OFFSCREEN';
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        const pos = getComputedStyle(n).position;
        if (pos === 'fixed' || pos === 'sticky') {
          return `${n.tagName.toLowerCase()}.${String(n.className).split(/\s+/)[0]}`;
        }
      }
      return null;
    },
    { x: box.x, y: box.y, w: box.width, h: box.height },
  );
  expect(covering, `${label} is covered by floating chrome (${covering})`).toBeNull();
}

test.describe('Mobile content budget', () => {
  test('the posting wizard opens on a form field, not on marketing copy', async ({ page, login }) => {
    await consent(page);
    // Use a new owner because the seeded owner opens the upgrade prompt.
    await login.asNewOwner();
    await page.goto('/list-property');

    // The first thing the owner must be able to act on: the "Property For"
    // Sale/Rent choice that every later step branches from.
    const firstField = page.getByRole('button', { name: 'Sale', exact: true }).first();
    await expectAboveTheFold(page, firstField, 'first wizard control');
  });

  test('the assistant coach-mark never covers the listing price', async ({ page }) => {
    await consent(page);
    await page.goto('/listings');
    const card = page.locator('a[href^="/property/"]').first();
    await expect(card).toBeVisible();
    await card.click();
    await page.waitForURL(/\/property\//);

    // Do not assert gallery placement; photo-vs-price priority is a product choice.
    const price = page.getByTestId('property-price');
    await expectAboveTheFold(page, price, 'property price');
    // Avoid `scrollIntoViewIfNeeded`; it can park content under sticky chrome.
    await price.evaluate((el) => {
      window.scrollBy({ top: el.getBoundingClientRect().top - 160, behavior: 'instant' });
    });
    await page.waitForTimeout(300);
    await expectNothingCovering(page, price, 'property price');
  });

  test('the coach-mark is spent after two sightings and does not return', async ({ page }) => {
    await consent(page);
    await page.goto('/services');
    const nudge = page.getByText('New here?', { exact: false });
    await expect(nudge).toBeVisible();

    await page.reload();
    await expect(page.getByText('New here?', { exact: false })).toBeVisible();

    // Third: budget spent, so it must not reappear on later page loads for the rest of the session.
    await page.reload();
    await expect(page.getByText('New here?', { exact: false })).toHaveCount(0);
  });
});

// These catch content that exists but is off-screen or too small to use.
test.describe('Mobile reach and legibility', () => {
  test('every control in the societies toolbar is on screen', async ({ page }) => {
    await consent(page);
    await page.goto('/societies');
    await expect(page.getByRole('button', { name: 'Sort societies' })).toBeVisible();

    const vw = page.viewportSize().width;
    const escaping = await page.evaluate((w) => {
      const bar = document.querySelector('.glass.rounded-2xl');
      if (!bar) return ['toolbar not found'];
      const bad = [];
      for (const el of bar.querySelectorAll('button, input, .dz-dropdown__trigger')) {
        const r = el.getBoundingClientRect();
        if (r.width && r.right > w + 1) {
          bad.push(`${(el.innerText || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 24)} right=${Math.round(r.right)}`);
        }
      }
      return bad;
    }, vw);

    // Clipped overflow hides the control without creating page scroll.
    expect(escaping, `controls escaping a ${vw}px viewport`).toEqual([]);
  });

  test('the flatmates verified badge is a real target and stays in its card', async ({ page }) => {
    await consent(page);
    // Use `team-up` because the seeker badge only renders on SeekerCard.
    await page.goto('/flatmates?view=team-up');

    const badge = page.locator('.sf-card [role="img"][aria-label*="erified"]').first();
    await expect(badge).toBeVisible();
    const box = await badge.boundingBox();
    expect(box.width, 'verified icon size').toBeGreaterThanOrEqual(16);

    const escaping = await page.evaluate(() => {
      const bad = [];
      for (const b of document.querySelectorAll('.sf-card [role="img"][aria-label*="erified"]')) {
        const r = b.getBoundingClientRect();
        const c = b.closest('.sf-card').getBoundingClientRect();
        if (r.width && (r.left < c.left - 1 || r.right > c.right + 1)) bad.push(b.getAttribute('aria-label'));
      }
      return bad;
    });
    expect(escaping, 'verified icons must stay inside their card').toEqual([]);
  });
});
