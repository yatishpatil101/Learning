/* No identity badge is granted: the wizard has no identity gate, and granting one here would
   quietly assert the opposite of what `no-gate` proves. */
import { test, expect } from '../../../fixtures/live.js';
import { pickDate } from '../../../helpers/datePicker.helper.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';
import { uploadPublishablePhotos } from '../../../helpers/listingPhotos.helper.js';
import { fillSociety } from '../../../helpers/places.js';
import { pickLocality } from '../../../helpers/locality.js';

const RERA_BOX = 'e.g. P52100012345';

async function menuOpen(page) {
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
}

async function pickOption(page, dataErr, label) {
  await page.locator(`[data-err="${dataErr}"]`).click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option', { hasText: label }).first().click();
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// `pickDate` opens the calendar itself; this drives one already opened, so its title can be asserted first.
async function pickInOpenCalendar(page, iso) {
  const [y, m] = iso.split('-').map(Number);
  const cal = page.locator('.dz-cal.is-open');
  await cal.locator('.dz-cal__dd--year .dz-dropdown__trigger').click();
  await page.locator('.dz-dropdown__menu--portal [role="option"]', { hasText: new RegExp(`^${y}$`) }).first().click();
  await cal.locator('.dz-cal__dd:not(.dz-cal__dd--year) .dz-dropdown__trigger').click();
  await page.locator('.dz-dropdown__menu--portal [role="option"]', { hasText: new RegExp(`^${MONTHS[m - 1]}$`) }).first().click();
  await cal.locator(`.dz-cal__day[aria-label="${iso}"]:not(.is-muted)`).click();
  await cal.waitFor({ state: 'detached' });
}

async function gotoForm(page) {
  await signedInAsNew(page);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
}

async function pickFloorOptions(page) {
  for (const [dataErr, value] of [['floor', '9'], ['totalFloors', '14']]) {
    await page.locator(`[data-err="${dataErr}"] .dz-dropdown__trigger`).click();
    await menuOpen(page);
    await page.getByRole('option', { name: value, exact: true }).click();
  }
}

async function fillFlatAddress(page) {
  await page.waitForSelector('.gm-style', { timeout: 30000 });
  await pickLocality(page, 'Baner');
  await page.locator('input[data-err="flatNumber"]').fill('B-1204');
  await fillSociety(page, 'Skyline Heights');
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Price & terms/i', { timeout: 15000 });
}

async function flatToPricing(page, deal) {
  await gotoForm(page);
  const pill = page.locator('.radio-pill', { hasText: deal === 'rent' ? 'Rent' : 'Sale' }).first();
  await pill.click();
  // The pill's own `selected` class is the render signal, so the re-render is waited on rather than slept through.
  await expect(pill).toHaveClass(/selected/);
  await page.locator('input[data-err="carpetArea"]').fill('1000');
  await pickOption(page, 'propertyType', 'Flat / Apartment');
  await page.locator('[data-err="bhk"]').getByRole('button', { name: '2', exact: true }).click();
  await pickFloorOptions(page);
  await page.getByRole('button', { name: /Next Step/i }).click();
  await fillFlatAddress(page);
}

async function landToPricing(page, type, deal = 'buy') {
  await gotoForm(page);
  await page.locator('.lp-step').getByText(deal === 'rent' ? 'Rent' : 'Sale', { exact: true }).first().click();
  await pickOption(page, 'propertyType', type);
  await page.locator('input[data-err="carpetArea"]').fill(type === 'Farm Land' ? '12' : '2400');
  await pickOption(page, 'naStatus', type === 'Farm Land' ? 'Still agricultural' : 'Deemed NA');
  await pickOption(page, 'otherRights', type === 'Farm Land' ? 'Not checked yet' : 'Clear');
  if (type === 'Farm Land' && deal === 'buy') {
    await pickOption(page, 'buyerEligibility', 'Agriculturist buyer only');
  }
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });
  await pickLocality(page, 'Baner');
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Price & terms/i', { timeout: 15000 });
}

test('a flat sale: the pricing step (possession, price, RERA, handover date) and then the photo step', async ({ page, consoleErrors }) => {
  test.slow();
  await flatToPricing(page, 'buy');

  await test.step('Possession Status offers the three construction states the search facet knows', async () => {
    const group = page.locator('[data-err="possession"]');
    for (const option of ['Ready to Move', 'New Launch', 'Under Construction']) {
      await expect(group.getByText(option, { exact: true })).toBeVisible();
    }
    await expect(group.getByText('Available From', { exact: true })).toHaveCount(0);
  });

  await test.step('sale flow omits Sale Type while keeping ownership and possession', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('[data-err="ownership"]')).toBeVisible();
    await expect(page.locator('[data-err="possession"]')).toBeVisible();
    await expect(page.getByText('Sale Type', { exact: true })).toHaveCount(0);
    await expect(page.getByText('New/under-construction sale, or a resale by the current owner?')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New Property', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Resale', exact: true })).toHaveCount(0);
    await expect(page.getByText('Transaction Type')).toHaveCount(0);
    await expect(page.getByText('New Booking')).toHaveCount(0);
    const progress = await page.evaluate(async () => {
      const { computeProgress } = await import('/src/pages/consumer/list-property/progress.js');
      const { initialForm } = await import('/src/pages/consumer/list-property/initialForm.js');
      return ['', 'new', 'resale'].map((transactionType) => computeProgress({
        form: { ...initialForm, deal: 'buy', transactionType },
      }));
    });
    expect(progress[1]).toEqual(progress[0]);
    expect(progress[2]).toEqual(progress[0]);
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  await test.step('Negotiable sits beside Expected Price; the amount is echoed in words with the ₹/sq.ft caption', async () => {
    const priceRow = page.locator('div.grid', { has: page.locator('input[data-err="price"]') }).first();
    await expect(priceRow.locator('.toggle-track')).toHaveCount(1);
    await expect(priceRow.getByText('Negotiable')).toBeVisible();
    const split = await page.evaluate(() => {
      const price = document.querySelector('input[data-err="price"]');
      const row = price.closest('.grid');
      const toggle = row.querySelector('.toggle-track').closest('.min-w-0');
      return toggle.getBoundingClientRect().width / row.getBoundingClientRect().width;
    });
    expect(split).toBeGreaterThan(0.2);
    expect(split).toBeLessThan(0.4);
    // The amount is echoed in words under the input, so a stray zero is visible before Next.
    await page.locator('input[data-err="price"]').fill('12500000');
    await expect(priceRow.getByText('≈ ₹ 1.25 Crore')).toBeVisible();
    await expect(priceRow.getByText(/\/\s*sq\.ft/)).toBeVisible();
    await expect(page.getByText(/₹\s*12,500\s*\/\s*sq\.ft/)).toBeVisible();
    /* Both boxes come from one layout read: two sequential boundingBox() calls are two measurements, and the
       row shifts while the ₹/sq.ft caption settles, reporting an overlap that never existed on screen. */
    const [wordsBox, rateBox] = await page.evaluate(() => {
      const p = document.querySelector('input[data-err="price"]').closest('.min-w-0').querySelector('p');
      return [...p.children].map((c) => c.getBoundingClientRect().toJSON());
    });
    expect(Math.abs(wordsBox.y - rateBox.y)).toBeLessThan(2);
    expect(wordsBox.right).toBeLessThanOrEqual(rateBox.left);
    await expect(page.getByText('Allow buyers to negotiate the price')).toHaveCount(0);
    await expect(page.getByText('Possession Status *')).toBeVisible();
    await expect(page.getByText(/Monthly Maintenance/i)).toBeVisible();
  });

  await test.step('MahaRERA field is shown for a flat sale and accepts an ID', async () => {
    const rera = page.getByPlaceholder(RERA_BOX);
    await expect(rera).toBeVisible();
    await rera.fill('p52100012345');
    await expect(rera).toHaveValue('P52100012345');
  });

  await test.step('a pre-completion choice reveals a date picker; the step needs a handover date, shown as DD/MM/YYYY', async () => {
    // A completed home with a future handover is still ready to move, so it is asked no date.
    await page.getByRole('button', { name: 'Ready to Move', exact: true }).click();
    await expect(page.locator('[data-err="availableFrom"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'New Launch', exact: true }).click();
    const dateField = page.locator('[data-err="availableFrom"]');
    await expect(dateField).toBeVisible();

    await page.getByRole('button', { name: 'Under Construction', exact: true }).click();
    await page.getByRole('button', { name: /Next Step/i }).click();
    await expect(dateField).toHaveClass(/dz-invalid/);
    await expect(page.getByText('Photos & description')).toHaveCount(0);

    await dateField.click();
    await expect(page.locator('.dz-cal')).toBeVisible();
    await expect(page.locator('.dz-cal__title')).toHaveText('Select Date');
    await pickInOpenCalendar(page, '2027-03-14');
    await expect(dateField.locator('.dz-datefield__text')).toHaveText('14/03/2027');
  });

  await test.step('the photo step asks for no ownership papers, and photos are compulsory until uploaded', async () => {
    await page.getByRole('button', { name: 'Ready to Move', exact: true }).click();
    await pickOption(page, 'ownership', 'Freehold');
    await page.getByRole('button', { name: /Next Step/i }).click();
    await page.waitForSelector('text=/Photos & description/i', { timeout: 15000 });

    await expect(page.getByText(/Verified property badge/i)).toHaveCount(0);
    await expect(page.locator('.doc-upload')).toHaveCount(0);

    await page.getByRole('button', { name: /Submit Property/i }).click();
    const zone = page.locator('[data-err="photos"]');
    await expect(zone).toHaveCount(1);
    await expect(zone.locator('label.upload-zone').first()).toHaveClass(/dz-invalid/);
    await expect(zone.locator('p.dz-field-error')).toBeVisible();
    await expect(zone.getByText('Property Photos *')).toBeVisible();
    await expect(page.locator('[data-err="documents"]')).toHaveCount(0);

    await uploadPublishablePhotos(page);
    // Thumbnails prove the files reached state; absence of an error alone would pass without an upload.
    await expect(zone.locator('.grid img')).toHaveCount(3);
    await expect(zone.locator('p.dz-field-error')).toHaveCount(0);
  });
  expect(consoleErrors).toHaveLength(0);
});

test('MahaRERA field is hidden for a flat rental', async ({ page }) => {
  await flatToPricing(page, 'rent');
  await page.locator('input[data-err="monthlyRent"]').fill('25000');
  await page.locator('input[data-err="deposit"]').fill('75000');
  await pickDate(page, '[data-err="availableFrom"]', '2027-08-01');
  await expect(page.getByPlaceholder(RERA_BOX)).toHaveCount(0);
});

test('farmland sale has no MahaRERA field, and neither farmland nor plot rentals ask the plotted-project question', async ({ page }) => {
  test.slow();
  await landToPricing(page, 'Farm Land');
  await expect(page.getByPlaceholder(RERA_BOX)).toHaveCount(0);
  await expect(page.locator('[data-err="plottedProject"]')).toHaveCount(0);

  await landToPricing(page, 'Open Plot', 'rent');
  await expect(page.locator('[data-err="plottedProject"]')).toHaveCount(0);
});

test('plot sale asks whether it is part of a plotted project while RERA stays optional', async ({ page }) => {
  test.slow();
  await landToPricing(page, 'Open Plot');
  await expect(page.getByText('Is this plot part of a layout or plotted project?')).toBeVisible();
  await page.locator('input[data-err="price"]').fill('9500000');
  await pickOption(page, 'ownership', 'Freehold');

  await page.getByRole('button', { name: /Next Step/i }).click();
  await expect(page.locator('[data-err="plottedProject"] .radio-pill.selected')).toHaveCount(0);
  await expect(page.getByText('Say whether this plot belongs to a layout or plotted project.')).toBeVisible();

  await test.step('an owner who says it is a plotted project can proceed without MahaRERA', async () => {
    await page.locator('[data-err="plottedProject"]').getByRole('button', { name: 'Yes', exact: true }).click();
    await page.getByRole('button', { name: /Next Step/i }).click();
    await page.waitForSelector('text=/Photos & description/i', { timeout: 15000 });
  });

  await test.step('answering No proceeds as well', async () => {
    await page.locator('.lp-steps__item.is-done', { hasText: 'Price' }).click();
    await page.waitForSelector('text=/Price & terms/i', { timeout: 15000 });
    await page.locator('[data-err="plottedProject"]').getByRole('button', { name: 'No', exact: true }).click();
    await page.getByRole('button', { name: /Next Step/i }).click();
    await page.waitForSelector('text=/Photos & description/i', { timeout: 15000 });
  });
});
