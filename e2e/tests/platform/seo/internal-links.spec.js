import { expect, test } from '../../../fixtures/live.js';

const BANER_SALE = '/property/p5013';
const MAGARPATTA_RENT = '/property/p5000';
const UNDRI_SALE = '/property/p5010';
const SOCIETY = '/society/skyline-heights-baner';

const SERVICES = [
  ['/services/rent-agreement', 'Rent Agreement'],
  ['/services/property-legal', 'Property & Legal'],
  ['/services/packers-movers', 'Packers & Movers'],
  ['/home-loans', 'Home Loans & EMI'],
  ['/services/interior-renovation', 'Interior & Renovation'],
  ['/services/property-valuation', 'Property Valuation'],
];

const crumbs = (page) => page.getByRole('navigation', { name: 'Breadcrumb' });

test.describe('property page → locality guide and posts', () => {
  for (const [label, path, locality] of [['for sale', BANER_SALE, 'Baner'], ['for rent', MAGARPATTA_RENT, 'Magarpatta']]) {
    test(`a ${locality} home ${label} links its guide and two or three posts`, async ({ page }) => {
      await page.goto(path);
      const card = page.getByTestId('property-guide');
      await expect(card.getByRole('link', { name: new RegExp(`^Know ${locality}`) })).toHaveAttribute('href', `/locality/${locality.toLowerCase()}`);
      const posts = card.locator('a[href^="/blog/"]');
      await expect.poll(() => posts.count()).toBeGreaterThanOrEqual(2);
      expect(await posts.count()).toBeLessThanOrEqual(3);
      for (const href of await posts.evaluateAll((els) => els.map((el) => el.getAttribute('href')))) expect(href).toMatch(/^\/blog\/[a-z0-9-]+$/);
    });
  }

  test('a locality without a guide shows no guide card', async ({ page }) => {
    await page.goto(UNDRI_SALE);
    await expect(crumbs(page).getByRole('link', { name: 'Home' })).toBeVisible();
    await expect(page.getByTestId('property-guide')).toHaveCount(0);
  });
});

test.describe('home → guide and blog strips', () => {
  test('the strips above the footer link every guide and the three newest posts', async ({ page }) => {
    await page.goto('/');
    const guides = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Pune locality guides' }) });
    await expect(guides.getByRole('link', { name: 'All guides' })).toHaveAttribute('href', '/locality');
    await expect(guides.locator('a[href^="/locality/"]')).toHaveCount(12);
    await expect(guides.getByRole('link', { name: 'Baner', exact: true })).toHaveAttribute('href', '/locality/baner');

    const blog = page.locator('section').filter({ has: page.getByRole('heading', { name: 'From the blog' }) });
    await expect(blog.getByRole('link', { name: 'All posts' })).toHaveAttribute('href', '/blog');
    const posts = blog.locator('a[href^="/blog/"]');
    await expect(posts).toHaveCount(3);
    for (const post of await posts.all()) await expect(post).toHaveText(/(Renting|Buying|For owners|Localities)$/);
  });
});

test.describe('visible breadcrumbs', () => {
  test('a property page shows Home › Rent/Buy › Locality › Title, the title being the current page', async ({ page }) => {
    await page.goto(BANER_SALE);
    const nav = crumbs(page);
    await expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    await expect(nav.getByRole('link', { name: 'Buy' })).toHaveAttribute('href', /deal=buy|\/listings/);
    await expect(nav.getByRole('link', { name: 'Baner', exact: true })).toHaveAttribute('href', '/locality/baner');
    const current = nav.locator('[aria-current="page"]');
    await expect(current).toHaveText(/Baner/);
    await expect(nav.locator('a[aria-current]')).toHaveCount(0);
  });

  test('a society page shows Home › Societies › Locality › Society', async ({ page }) => {
    await page.goto(SOCIETY);
    const nav = crumbs(page);
    await expect(nav.getByRole('link')).toHaveCount(3);
    await expect(nav.getByRole('link').nth(0)).toHaveAttribute('href', '/');
    await expect(nav.getByRole('link').nth(1)).toHaveAttribute('href', '/societies');
    await expect(nav.getByRole('link').nth(2)).toHaveAttribute('href', '/locality/baner');
    await expect(nav.locator('[aria-current="page"]')).toHaveText(await page.getByRole('heading', { level: 1 }).innerText());
  });

  for (const [path, name] of SERVICES) {
    test(`${path} shows Home › Services › ${name}`, async ({ page }) => {
      await page.goto(path);
      const nav = crumbs(page);
      await expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
      await expect(nav.getByRole('link', { name: 'Services' })).toHaveAttribute('href', '/services');
      await expect(nav.locator('[aria-current="page"]')).toHaveText(name);
    });
  }

  test.describe('on a 360px phone', () => {
    test.use({ viewport: { width: 360, height: 640 } });

    test('a long property trail stays one line and never widens the page', async ({ page }) => {
      await page.goto(BANER_SALE);
      const nav = crumbs(page);
      await expect(nav.locator('[aria-current="page"]')).toBeVisible();
      const ol = nav.locator('ol');
      expect((await ol.boundingBox()).height, 'one line of breadcrumbs').toBeLessThan(40);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal page scroll').toBe(true);
    });
  });
});
