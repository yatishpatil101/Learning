// No identity badge is granted: the wizard has no identity gate, so granting one would quietly
// assert the opposite of what the sibling `no-gate` spec proves.
import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';
import { pickFloors, LIST_PROPERTY_DRAFT_KEY, readListPropertyDraft } from '../../../helpers/listingForm.helper.js';

async function gotoFlow(page) {
  const mobile = await signedInAsNew(page);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
  return mobile;
}

// The portalled menu is `opacity: 0; pointer-events: none` for one frame after opening, so waiting
// on `.is-portal-open` is what makes it genuinely interactive.
async function menuOpen(page) {
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
}

async function pickType(page, label) {
  await page.locator('[data-err="propertyType"]').click();
  await menuOpen(page);
  const opt = page.locator('.dz-dropdown__option', { hasText: label });
  // `count()` does not retry, so assert the option exists before clicking rather than guarding on it.
  await expect(opt).toHaveCount(1);
  await opt.first().click();
}

async function gotoLocationStep(page) {
  await page.locator('.radio-pill', { hasText: 'Sale' }).first().click();
  await page.locator('input[data-err="carpetArea"]').fill('1050');
  await pickType(page, 'Flat / Apartment');
  await page.locator('[data-err="bhk"]').getByRole('button', { name: '2', exact: true }).click();
  await pickFloors(page);
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });
}

const pctOf = async (page) => {
  const raw = await page.locator('.lp-meter__pct').innerText();
  return parseInt(raw.replace(/\D/g, ''), 10);
};

// Design rule (DESIGN_SYSTEM.md → Control Width): a standalone dropdown with a
// short option set must not stretch the full form width on desktop.
const soloRatio = (page, labelText) => page.evaluate((text) => {
  const label = [...document.querySelectorAll('.lp-step label')].find((l) => l.textContent.trim().startsWith(text));
  const cell = label && label.parentElement;
  const control = cell && cell.querySelector('.dz-dropdown__trigger, input, textarea, select');
  const card = control && control.closest('.lp-step');
  if (!control || !card) return 1;
  return control.getBoundingClientRect().width / card.getBoundingClientRect().width;
}, labelText);

test('a fresh Details step: unselected deal and BHK, strength meter, StepNav and compact layout', async ({ page }) => {
  test.slow();
  await gotoFlow(page);
  const meter = page.locator('.lp-meter');

  await test.step('deal and BHK are not pre-filled', async () => {
    await expect(page.locator('[data-err="deal"] .radio-pill.selected')).toHaveCount(0);
    await expect(page.locator('[data-err="bhk"] .radio-pill.selected')).toHaveCount(0);
  });

  await test.step('BHK pills read as numbers, consistent with Bathrooms/Balconies', async () => {
    // 1 RK is the one pill that cannot be a number: it is a room count of zero bedrooms.
    const labels = await page.locator('[data-err="bhk"] .radio-pill').allInnerTexts();
    expect(labels.map((t) => t.trim())).toEqual(['1 RK', '1', '2', '3', '4', '5+']);
  });

  await test.step('a fresh form opens above zero and well below 100% (smart defaults count as filled)', async () => {
    await expect(meter).toBeVisible();
    const start = await pctOf(page);
    expect(start).toBeGreaterThan(0);
    expect(start).toBeLessThan(50);
  });

  await test.step('StepNav shows the four labelled phases, and upcoming steps are not interactive', async () => {
    const items = page.locator('.lp-steps__item');
    await expect(items).toHaveCount(4);
    await expect(items.nth(0)).toContainText('Details');
    await expect(items.nth(1)).toContainText('Location');
    await expect(items.nth(2)).toContainText('Price');
    await expect(items.nth(3)).toContainText('Photos');
    await expect(page.locator('.lp-steps__item.is-active')).toContainText('Details');
    await expect(page.locator('.lp-steps__item.is-todo', { hasText: 'Photos' })).toHaveJSProperty('tagName', 'DIV');
  });

  await test.step('Property Type and BHK share one compact row (dropdown is not full-width)', async () => {
    const paired = await page.evaluate(() => {
      const pt = document.querySelector('[data-err="propertyType"]');
      const bhk = document.querySelector('[data-err="bhk"]');
      const grid = pt && pt.closest('.grid');
      return !!(grid && bhk && grid.contains(bhk));
    });
    expect(paired).toBe(true);

    const ratio = await page.evaluate(() => {
      const trigger = document.querySelector('[data-err="propertyType"] .dz-dropdown__trigger');
      const card = trigger && trigger.closest('.lp-step');
      if (!trigger || !card) return 1;
      return trigger.getBoundingClientRect().width / card.getBoundingClientRect().width;
    });
    expect(ratio).toBeLessThan(0.7);
  });

  await test.step('full strength needs optional enrichment and five photos, not documents', async () => {
    const scores = await page.evaluate(async () => {
      const { computeProgress } = await import('/src/pages/consumer/list-property/progress.js');
      const form = {
        deal: 'buy', propertyType: 'flat', bhk: '2', bathrooms: '2', balconies: '1',
        carpetArea: '900', builtUp: '1100', superBuiltUp: '1250', floor: '4', totalFloors: '12',
        facing: 'east', age: '5-10', furnishing: 'semi', furniture: ['wardrobe'],
        locality: 'Baner', flatNumber: 'A-401', tower: 'A', society: 'Example Homes',
        street: 'High Street', landmark: 'Near park', pincode: '411045', price: '9500000',
        monthlyMaintenance: '2500', ownership: 'freehold', construction: 'new',
        availableFrom: '2027-01-01', reraId: 'P52100000001', description: 'A bright home with a quiet outlook and practical room layout for a family.',
        amenities: ['lift'],
      };
      return {
        fourPhotos: computeProgress({ form, photos: Array(4).fill('photo') }),
        full: computeProgress({ form, photos: Array(5).fill('photo') }),
      };
    });
    expect(scores.fourPhotos.pct).toBeLessThan(100);
    expect(scores.full.pct).toBe(100);
    expect(scores.full.nudge).toBeNull();
  });

  await test.step('listing strength gives one truthful priority nudge, and the percentage climbs as real fields are filled', async () => {
    await expect(meter.getByText('listing strength', { exact: true })).toBeVisible();
    const start = await pctOf(page);

    await page.locator('input[data-err="carpetArea"]').fill('1050');
    await expect(meter.locator('[data-nudge="photos"]')).toHaveText('Add 5 photos so buyers can see more of the home.');
    /* `pctOf` reads through `innerText()`, which does not retry. Waiting for the meter to stop reading its
       old value is the same claim as the `toBeGreaterThan` below, except that it retries. */
    await expect(page.locator('.lp-meter__pct')).not.toHaveText(`${start}%`);
    expect(await pctOf(page)).toBeGreaterThan(start);
  });

  await test.step('a flatmate post keeps the same four phases as any listing', async () => {
    await page.locator('.radio-pill', { hasText: 'Rent' }).first().click();
    await page.locator('.radio-pill', { hasText: 'Find a flatmate' }).first().click();
    await expect(page.locator('.lp-steps__item')).toHaveText([/Details/, /Location/, /Price/, /Photos/]);
  });
});

test('Start over asks for confirmation, can be cancelled, and then clears the form and the saved draft', async ({ page, consoleErrors }) => {
  await gotoFlow(page);
  await page.locator('input[data-err="carpetArea"]').fill('1050');
  await expect(page.locator('input[data-err="carpetArea"]')).toHaveValue('1050');

  await test.step('cancelling keeps the data', async () => {
    await expect(page.locator('.lp-reset')).toHaveText(/Start over/);
    await page.locator('.lp-reset').click();
    await expect(page.getByText('Start over?', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.getByText('Start over?', { exact: true })).toHaveCount(0);
    await expect(page.locator('input[data-err="carpetArea"]')).toHaveValue('1050');
  });

  await test.step('confirming clears the form and the saved draft', async () => {
    /* The autosave is debounced and the read below goes through `page.evaluate`, which does not retry. Polling
       the draft waits for the write itself rather than for a duration somebody timed the debounce at once. */
    await expect
      .poll(async () => readListPropertyDraft(page))
      .toContain('1050');

    await page.locator('.lp-reset').click();
    await page.locator('.dz-modal-panel').getByRole('button', { name: 'Start over', exact: true }).click();

    await page.waitForSelector('.lp-steps', { timeout: 20000 });
    await expect(page.locator('input[data-err="carpetArea"]')).toHaveValue('');

    // A fresh blank draft may be re-persisted — that's the expected "hold on refresh" behaviour — but
    // it must not carry old data.
    const draftAfter = await readListPropertyDraft(page);
    expect(draftAfter ?? '').not.toContain('1050');
  });
  expect(consoleErrors).toHaveLength(0);
});

test('the Location step: a bare map, a branded pin, the compact address grid, and completed steps navigate back', async ({ page, consoleErrors }) => {
  test.slow();
  await gotoFlow(page);
  await gotoLocationStep(page);

  await test.step('the map renders and its tiles load', async () => {
    await expect(page.locator('.gm-style').first()).toBeVisible();
    await page.waitForFunction(() => document.querySelectorAll('.gm-style img').length > 0, null, { timeout: 15000 });
  });

  await test.step('a branded location pin, with no zoom / view / street-view chrome', async () => {
    await expect(page.locator('.lp-pin')).toHaveCount(1);
    await expect(page.locator('gmp-advanced-marker')).toHaveCount(1);
    await expect(page.locator('button[aria-label="Zoom in"]')).toHaveCount(0);
    await expect(page.locator('button[aria-label="Zoom out"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Show satellite imagery|Map|Satellite/i })).toHaveCount(0);
    await expect(page.locator('.gm-fullscreen-control')).toHaveCount(0);
  });

  await test.step('Start over is on the Location step header too', async () => {
    await expect(page.getByRole('heading', { name: 'Location', exact: true })).toBeVisible();
    await expect(page.locator('.lp-reset')).toBeVisible();
  });

  await test.step('the Locality dropdown is folded into the compact address grid', async () => {
    const paired = await page.evaluate(() => {
      const loc = document.querySelector('[data-err="locality"]');
      const flat = document.querySelector('[data-err="flatNumber"]');
      const grid = loc && loc.closest('.grid');
      return !!(grid && flat && grid.contains(flat));
    });
    expect(paired).toBe(true);

    await page.locator('[data-err="locality"] .dz-dropdown__trigger').click();
    await menuOpen(page);
    const first = page.locator('.dz-dropdown__option').first();
    const chosen = (await first.innerText()).trim();
    await first.click();
    await expect(page.locator('[data-err="locality"] .dz-dropdown__value')).toHaveText(chosen);
  });

  /* Unit and wing are halves of one address line. Geometry rather than structure, because the two widths reach
     the same result by different means and only the rendered row is the promise to the owner. */
  for (const [name, width] of [['desktop', 1280], ['mobile', 390]]) {
    await test.step(`Flat/Unit No and Wing/Block share one line on ${name}`, async () => {
      await page.setViewportSize({ width, height: 900 });
      const box = await page.evaluate(() => {
        const r = (sel) => document.querySelector(sel).getBoundingClientRect();
        const flat = r('input[data-err="flatNumber"]');
        const wing = r('input[data-err="tower"]');
        return { flatTop: flat.top, wingTop: wing.top, flatRight: flat.right, wingLeft: wing.left };
      });
      expect(Math.abs(box.flatTop - box.wingTop)).toBeLessThan(2);
      expect(box.flatRight).toBeLessThanOrEqual(box.wingLeft);
    });
  }

  await test.step('completed steps are clickable and navigate back', async () => {
    const done = page.locator('.lp-steps__item.is-done');
    await expect(done).toContainText('Details');
    await expect(done).toHaveJSProperty('tagName', 'BUTTON');
    await expect(page.locator('.lp-steps__item.is-active')).toContainText('Location');

    await done.click();
    await expect(page.getByText('Property details', { exact: true })).toBeVisible();
    await expect(page.locator('.lp-steps__item.is-active')).toContainText('Details');
  });
  expect(consoleErrors).toHaveLength(0);
});

/* 'Kharadi' is matched offline by `runMapSearch` against the locality table, so the placement needs
   no geocoder stub and the restored coordinates name their own source. */
test('a locality search places the pin, and the pin is still placed after a reload', async ({ page }) => {
  await gotoFlow(page);
  await gotoLocationStep(page);
  // The pin is not treated as "set" until the owner acts, so no confirmation shows yet.
  await expect(page.getByText(/Location set:/)).toHaveCount(0);
  await page.locator('input[placeholder*="Search a locality"]').fill('Kharadi');
  await page.getByRole('button', { name: /Search location/i }).click();
  const confirmation = page.getByText(/Location set: /);
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText('73.94');
  const placed = await confirmation.textContent();
  // The autosave is debounced and `evaluate` does not retry, so poll for the write itself.
  await expect
    .poll(async () => page.evaluate((key) => localStorage.getItem(key), LIST_PROPERTY_DRAFT_KEY))
    .toContain('"pinPlaced":true');

  await page.reload();
  /* `useFormDraft` restores in a mount effect, so clicking straight through races the re-render and
     fails the button as "not stable". Wait on a restored value. */
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
  await page.waitForSelector('.gm-style', { timeout: 30000 });
  await expect(page.getByText(/Location set: /)).toHaveText(placed);

  await page.getByRole('button', { name: /Next Step/i }).click();
  await expect(page.getByText('Enter the flat / unit number.')).toBeVisible();
  await expect(page.getByText(/never appears in their results/)).toHaveCount(0);
});

test('width-capped standalone dropdowns: land (Water Source, Zoning) and commercial (Suitable For, Frontage)', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await gotoFlow(page);

  await test.step('standalone land dropdowns are width-capped, not full-page', async () => {
    await pickType(page, 'Farm Land');
    expect(await soloRatio(page, 'Water Source')).toBeLessThan(0.7);

    await pickType(page, 'Open Plot');
    expect(await soloRatio(page, 'Zoning')).toBeLessThan(0.7);
  });

  await test.step('Commercial "Suitable For" pairs with the profile\'s own measurement and is width-capped', async () => {
    await pickType(page, 'Commercial');
    await page.locator('[data-err="commercialType"]').click();
    await menuOpen(page);
    await page.locator('.dz-dropdown__option', { hasText: 'Shop / Showroom' }).first().click();

    const paired = await page.evaluate(() => {
      const labels = [...document.querySelectorAll('.lp-step label')];
      const suitable = labels.find((l) => l.textContent.trim().startsWith('Suitable For'));
      const grid = suitable && suitable.closest('.grid');
      return !!(grid && grid.querySelector('[data-err="frontage"]'));
    });
    expect(paired).toBe(true);

    await expect(page.getByText('Maintenance / CAM')).toHaveCount(0);
    expect(await soloRatio(page, 'Suitable For')).toBeLessThan(0.7);
    expect(await soloRatio(page, 'Frontage')).toBeLessThan(0.7);
  });
});

test('filling only the mandatory fields keeps the meter above where it started and under 100%', async ({ page }) => {
  test.slow();
  await gotoFlow(page);
  const start = await pctOf(page);
  await page.locator('.radio-pill', { hasText: 'Sale' }).first().click();
  await pickType(page, 'Flat / Apartment');
  await page.locator('[data-err="bhk"]').getByRole('button', { name: '2', exact: true }).click();

  // Every mandatory Details + Location field, but no optional ones.
  await page.locator('input[data-err="carpetArea"]').fill('1200');
  // Floor and total floors are mandatory — an unanswered floor drops a flat out of every floor-bounded
  // search — so step 1 will not advance without them.
  for (const dataErr of ['floor', 'totalFloors']) {
    await page.locator(`[data-err="${dataErr}"] .dz-dropdown__trigger`).click();
    await menuOpen(page);
    await page.locator('.dz-dropdown__option').first().click();
  }
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.getByRole('heading', { name: 'Location', exact: true }).waitFor({ timeout: 10000 });

  await page.locator('[data-err="locality"]').click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option').first().click();
  await page.locator('input[data-err="flatNumber"]').fill('B-1204');
  await page.locator('input[data-err="society"]').fill('Skyline Heights');
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Price & terms/i', { timeout: 15000 });
  await page.locator('input[data-err="price"]').fill('9500000');
  await page.locator('[data-err="ownership"]').click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option').first().click();
  // Possession is mandatory and not pre-selected, so leaving it blank would make this a test about an
  // incomplete form rather than about a complete-but-minimal one.
  await page.getByRole('button', { name: 'Ready to Move', exact: true }).click();
  /* The final `pctOf` read does not retry, so the meter has to be known-settled first. `Select.jsx` drops
     `is-placeholder` only once a value is selected, the closest thing to a commit signal this control has. */
  await expect(page.locator('[data-err="ownership"] .dz-dropdown__value')).not.toHaveClass(/is-placeholder/);
  // Optional fields (built-up, facing, video, description, amenities, supporting documents…) are still
  // blank, so the meter must have moved up from a fresh form yet stay short of 100%.
  const end = await pctOf(page);
  expect(end).toBeGreaterThan(start);
  expect(end).toBeLessThan(100);
});
