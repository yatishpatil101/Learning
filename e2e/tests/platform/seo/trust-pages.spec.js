import { test, expect } from '../../../fixtures/live.js';

const jsonLd = async (page) => {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocks.map((b) => JSON.parse(b)).flatMap((j) => j['@graph'] || [j]);
};

test('home leads with privacy and real owners, and the Organization names its profiles', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle('Draazy: Broker-free properties for rent & sale in Pune');

  const org = (await jsonLd(page)).find((n) => n['@type'] === 'Organization');
  expect(org.legalName).toBe('Draazy Technologies');
  expect(org.sameAs).toEqual([
    'https://www.facebook.com/profile.php?id=61594205514968',
    'https://www.instagram.com/draazyapp.homes',
    'https://x.com/draazyapp',
    'https://www.youtube.com/@draazy-x1u',
  ]);

  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest.description).toBe(org.description);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', org.description);
});

test('the home hero line and the Assured chip point visitors at how verification works', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('p.hero-sub').first()).toHaveText(/real owners\. Your number stays private\./);
  const chip = page.locator('.hero-trust:visible').getByRole('link', { name: 'Draazy Assured' });
  await expect(chip).toHaveAttribute('href', '/how-verification-works');
  await chip.click();
  await expect(page).toHaveURL(/\/how-verification-works$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('How verification works');
});

test('/about is a readable page that links the NoBroker comparison', async ({ page }) => {
  await page.goto('/about', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle(/^About Draazy \|/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://draazy.com/about');
  await expect(page.getByText(/Built in Pune by the Draazy team/).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'support@draazy.com' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Draazy vs NoBroker' })).toHaveAttribute('href', '/compare/nobroker');
});

test('/how-verification-works defines Draazy Assured and carries a real FAQ', async ({ page }) => {
  await page.goto('/how-verification-works', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle(/^How Draazy Verifies Owners and Listings/);
  await expect(page.getByRole('heading', { name: /Draazy Assured/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Frequently asked questions' })).toBeVisible();
  await expect(page.locator('main dl dt')).toHaveCount(6);
});

test('the footer links to both trust pages and shows no street address', async ({ page }) => {
  await page.goto('/');
  const footer = page.getByRole('contentinfo');
  await expect(footer.getByRole('link', { name: 'About Draazy' })).toHaveAttribute('href', '/about');
  await expect(footer.getByRole('link', { name: 'How verification works' })).toHaveAttribute('href', '/how-verification-works');
  await expect(footer).not.toContainText(/Business Bay|Baner|Pvt\. Ltd|Private Limited/);
  for (const host of ['facebook.com/profile.php?id=61594205514968', 'instagram.com/draazyapp.homes', 'x.com/draazyapp', 'youtube.com/@draazy-x1u']) {
    await expect(footer.locator(`a[href$="${host}"]`)).toHaveCount(1);
  }
});

test('Terms names the operator without an incorporation claim or address', async ({ page }) => {
  await page.goto('/terms');
  const body = page.locator('main');
  await expect(body).toContainText('operated by Draazy Technologies');
  await expect(body).not.toContainText(/Private Limited|Business Bay|Companies Act/);
});

test('a listing page links its Assured block to how verification works', async ({ page }) => {
  await page.goto('/listings');
  const card = page.locator('a[href^="/property/"]').first();
  await expect(card).toBeVisible();
  await card.click();
  await page.waitForURL(/\/property\//);
  await expect(page.getByRole('link', { name: 'How we verify' })).toHaveAttribute('href', '/how-verification-works');
});
