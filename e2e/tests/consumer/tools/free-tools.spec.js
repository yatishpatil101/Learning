import { test, expect } from '../../../fixtures/live.js';

const TOOLS = [
  { path: '/tools/rent-receipt-generator', title: 'Free Rent Receipt Generator for HRA | Draazy', h1: /rent receipt generator/i },
  { path: '/tools/stamp-duty-calculator-maharashtra', h1: /stamp duty/i },
  { path: '/tools/rent-agreement-cost-pune', h1: /rent agreement/i },
  { path: '/tools/rental-yield-calculator', h1: /rental yield/i },
];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthsAgo = (n) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n, 1);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

async function pick(page, trigger, option) {
  await page.locator(`[aria-label="${trigger}"]`).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

// Page JSON-LD is prerendered at build time only (frontend/scripts/vite-plugin-route-heads.test.mjs asserts it).
test('the hub lists the four tools and the footer links to it', async ({ page, consoleErrors }) => {
  await page.goto('/tools', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://draazy.com/tools');
  for (const { path } of TOOLS) await expect(page.locator(`main a[href="${path}"]`).first()).toBeVisible();

  await page.getByRole('contentinfo').getByRole('link', { name: 'Free tools', exact: true }).click();
  await expect(page).toHaveURL(/\/tools$/);
  expect(consoleErrors).toEqual([]);
});

test('every tool shows its source date and FAQs, and ends with one soft link', async ({ page, consoleErrors }) => {
  for (const tool of TOOLS) {
    await page.goto(tool.path, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(tool.h1);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://draazy.com${tool.path}`);
    if (tool.title) await expect(page).toHaveTitle(tool.title);
    await expect(page.getByTestId('tool-as-of')).toContainText('as of');
    await expect(page.locator('main dl dt')).not.toHaveCount(0);
    await expect(page.locator('main a[href^="/listings"], main a[href="/list-property"]')).toHaveCount(1);
  }
  expect(consoleErrors).toEqual([]);
});

test('stamp duty uses the higher of the two values and caps the registration fee', async ({ page, consoleErrors }) => {
  await page.goto('/tools/stamp-duty-calculator-maharashtra', { waitUntil: 'domcontentloaded' });
  const result = page.getByTestId('tool-result');
  await expect(result).toContainText('₹5,55,000');
  await expect(result).toContainText('₹5,25,000');
  await expect(result).toContainText('₹30,000');

  await page.getByLabel('Ready reckoner value (optional)').fill('10000000');
  await expect(result).toContainText('₹7,30,000');

  await page.getByLabel('Agreement value').fill('2000000');
  await page.getByLabel('Ready reckoner value (optional)').fill('');
  await expect(result).toContainText('₹1,40,000');
  await expect(result).toContainText('₹20,000');
  expect(consoleErrors).toEqual([]);
});

test('rent agreement cost follows the leave and licence formula', async ({ page, consoleErrors }) => {
  await page.goto('/tools/rent-agreement-cost-pune', { waitUntil: 'domcontentloaded' });
  const result = page.getByTestId('tool-result');
  await expect(result).toContainText('₹2,75,000');
  await expect(result).toContainText('₹800');
  await expect(result).toContainText('₹1,000');
  await expect(result).toContainText('₹300');
  await expect(result).toContainText('₹2,100');

  await page.getByLabel(/Term in months/).fill('61');
  await expect(page.getByRole('alert')).toContainText('60');
  expect(consoleErrors).toEqual([]);
});

test('rental yield gives gross and net yield and says so when the property loses money', async ({ page, consoleErrors }) => {
  await page.goto('/tools/rental-yield-calculator', { waitUntil: 'domcontentloaded' });
  const result = page.getByTestId('tool-result');
  await expect(result).toContainText('3.27%');
  await expect(result).toContainText('4.00%');

  await page.getByLabel('Property tax a year').fill('400000');
  await expect(result).toContainText('loses money');
  expect(consoleErrors).toEqual([]);
});

test('rent receipts: one per month, PAN checked, cash stamp box, and only receipts print', async ({ page, consoleErrors }) => {
  await page.goto('/tools/rent-receipt-generator', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('rent-receipt')).toHaveCount(0);

  await page.getByLabel('Tenant name').fill('Asha Kulkarni');
  await page.getByLabel('Landlord name').fill('Ravi Deshmukh');
  await page.getByLabel('Property address').fill('Flat 402, Sunrise Heights, Baner, Pune 411045');
  await page.getByLabel('Monthly rent').fill('25000');
  await pick(page, 'From month', monthsAgo(2));
  await expect(page.getByTestId('receipt-preview').getByTestId('rent-receipt')).toHaveCount(3);

  await page.getByLabel(/Landlord PAN/).fill('ABC');
  await expect(page.getByText('A PAN has 5 letters')).toBeVisible();
  await expect(page.getByRole('button', { name: /Print or save as PDF/ })).toBeDisabled();
  await page.getByLabel(/Landlord PAN/).fill('abcde1234f');
  await expect(page.getByText('A PAN has 5 letters')).toHaveCount(0);
  await expect(page.getByTestId('receipt-preview')).toContainText('PAN: ABCDE1234F');

  await expect(page.getByTestId('receipt-preview')).not.toContainText('revenue stamp');
  await pick(page, 'Payment mode', 'Cash');
  await expect(page.getByTestId('receipt-preview')).toContainText('revenue stamp');

  await expect(page.getByTestId('receipt-print')).toBeHidden();
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByTestId('receipt-print')).toBeVisible();
  await expect(page.getByTestId('receipt-print').getByTestId('rent-receipt')).toHaveCount(3);
  await expect(page.locator('#root')).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await expect(page.locator('#root')).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('a PAN is asked for once yearly rent passes ₹1,00,000', async ({ page }) => {
  await page.goto('/tools/rent-receipt-generator', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Monthly rent').fill('8000');
  await expect(page.getByText('Your employer needs it')).toHaveCount(0);
  await page.getByLabel('Monthly rent').fill('9000');
  await expect(page.getByText('Your employer needs it')).toBeVisible();
});
