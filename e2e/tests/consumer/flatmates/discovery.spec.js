import { test, expect } from '@playwright/test';
import { openFlatmates, cardIds, setBudget, seed, SEEKER } from '../../../helpers/app.js';
import { trackErrors } from '../../../helpers/console.js';

/* Demand side: how a seeker finds a home or a flatmate.

   The page is split by one question — "is there an address yet?" — so these
   specs mostly assert that the split holds: places on one side, people on the
   other, and no way to end up staring at a dead end. */

test.describe('Flatmates discovery', () => {
  test('shows two intent tabs with visible counts', async ({ page }) => {
    await openFlatmates(page);
    const moveIn = page.getByRole('button', { name: /Move in now/i });
    const teamUp = page.getByRole('button', { name: /Team up/i });
    await expect(moveIn).toBeVisible();
    await expect(teamUp).toBeVisible();

    // Counts are rendered, not just announced — stock a seeker cannot see is
    // stock they never switch tabs for.
    await expect(moveIn).toContainText(/\d/);
    await expect(teamUp).toContainText(/\d/);
    await expect(moveIn).toHaveAttribute('aria-label', /\d+ homes/);
  });

  test('Move in now holds only places; Team up holds only people', async ({ page }) => {
    await openFlatmates(page);
    const places = await cardIds(page);
    expect(places.length).toBeGreaterThan(0);
    expect(places.every((id) => id.startsWith('r:') || id.startsWith('g:'))).toBe(true);

    await page.getByRole('button', { name: /Team up/i }).click();
    const people = await cardIds(page);
    expect(people.length).toBeGreaterThan(0);
    expect(people.every((id) => id.startsWith('s:') || id.startsWith('g:'))).toBe(true);
    // A seeker only ever belongs with people.
    expect(people.some((id) => id.startsWith('s:'))).toBe(true);
  });

  test('groups without an address sort into Team up', async ({ page }) => {
    await openFlatmates(page);
    const placeGroups = (await cardIds(page)).filter((id) => id.startsWith('g:'));
    await page.getByRole('button', { name: /Team up/i }).click();
    const peopleGroups = (await cardIds(page)).filter((id) => id.startsWith('g:'));

    // Seed groups carry no propertyId/society, so every one of them is a set of
    // people still hunting rather than a flat you can move into.
    expect(peopleGroups.length).toBeGreaterThan(0);
    expect(placeGroups.length).toBe(0);
  });

  test.describe('legacy ?view= deep links still resolve', () => {
    const cases = [
      ['rooms', /Move in now/],
      ['groups', /Team up/],
      ['flatmates', /Team up/],
      ['move-in', /Move in now/],
      ['team-up', /Team up/],
    ];
    for (const [value, expected] of cases) {
      test(`?view=${value}`, async ({ page }) => {
        await openFlatmates(page, `?view=${value}`);
        await expect(page.locator('button[aria-current="page"]')).toHaveText(expected);
      });
    }
  });

  test('a shareable room stays visible to a budget only its split price fits', async ({ page }) => {
    await openFlatmates(page, '?view=move-in');
    await setBudget(page, 10000);

    // The seeded master bedroom is ₹18,000 for the room. It must still be
    // offered at a ₹10,000 budget because two people can split it — otherwise
    // the cheapest genuine way into a good society is hidden from exactly the
    // budgets it exists for.
    const ids = await cardIds(page);
    expect(ids.length).toBeGreaterThan(0);
    await expect(page.getByText(/each if \d share/i).first()).toBeVisible();
  });

  test('an empty tab offers the other tab instead of a dead end', async ({ page }) => {
    // Aundh has seekers but no rooms, so Move in now empties while Team up does not.
    await openFlatmates(page, '?view=move-in&loc=Aundh');
    expect(await cardIds(page)).toHaveLength(0);

    const rescue = page.getByText(/match these same filters/i);
    await expect(rescue).toBeVisible();
    await page.getByRole('button', { name: /^Team up$/ }).first().click();

    // Switching must carry the filter over — the rescue promised these results.
    await expect(page.locator('button[aria-current="page"]')).toHaveText(/Team up/);
    expect((await cardIds(page)).length).toBeGreaterThan(0);
  });

  test('discloses that a vacant flat has no flatmates yet', async ({ page }) => {
    await openFlatmates(page, '?view=move-in');

    // An owner letting an empty flat room by room is a different bet from a
    // spare room in an occupied household: nobody vets you, and your flatmates
    // are undecided. That has to be stated, not implied.
    await expect(page.getByText('No flatmates yet').first()).toBeVisible();
    await expect(page.getByText(/One rent agreement covers/i).first()).toBeVisible();
  });

  test('labels each room by kind', async ({ page }) => {
    await openFlatmates(page, '?view=move-in');
    await expect(page.getByText('Master bedroom', { exact: true }).first()).toBeVisible();
  });

  test('renders no console errors on either tab', async ({ page }) => {
    const errors = trackErrors(page);

    await openFlatmates(page);
    await page.getByRole('button', { name: /Team up/i }).click();
    // A tab that never rendered raises no console errors either. The cards are what makes the
    // empty-errors claim below a statement about this tab rather than about a blank screen.
    await expect(page.locator('.sf-card').first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a signed-in seeker sees their own live request banner', async ({ page }) => {
    await seed(page, {
      user: SEEKER,
      posts: [{
        id: 's-e2e-1', name: SEEKER.name, mobile: SEEKER.mobile, gender: 'female',
        budget: 15000, localities: ['Baner'], moveIn: 'now', tags: [],
        note: 'E2E request', time: 'Just now', createdAt: Date.now(),
      }],
    });
    await openFlatmates(page, '?view=team-up');

    await expect(page.getByText(/Your live request/i)).toBeVisible();
    // Your own post is a thing you manage, never a card you can apply to.
    expect(await cardIds(page)).not.toContain('s:s-e2e-1');
  });
});
