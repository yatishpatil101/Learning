import { test, expect } from '@playwright/test';
import { approveFlatmates, switchToTeamUp } from '../../../helpers/app.js';

/* Moderate before public (tech-debt D72).

   Every other public-facing thing a user writes on this platform — a listing, a
   review — passes a moderator before a stranger can read it. The flatmate board
   did not: a post went live the instant it was saved. The board is free text plus
   a locality, which is precisely where a broker puts a phone number to route
   around the contact rules, so it was the one surface that most needed the queue.

   A new post, room or group now starts at `mod_status = 'pending'` and the public
   feeds filter on a WHITELIST (`live | approved`), not a blacklist. That direction
   matters: with a blacklist `pending` would have been public until somebody
   remembered to add the word, which is the same class of bug the change is fixing.

   These tests assert the two halves of that promise from the browser:
     1. a stranger cannot see a freshly written post;
     2. the author can — and is told, in plain words, that it is waiting.

   The second half is not cosmetic. Without it a save shows a success toast and
   then a board the author cannot find themselves on, which reads as a bug and
   invites them to post the same thing again. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const AUTHOR = { name: 'Review Tester', mobile: '9812340001' };
const STRANGER = { name: 'Passer By', mobile: '9812340002' };

function signIn({ name, mobile }) {
  return (u) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: u.name, mobile: u.mobile, role: 'buyer', loginAt: Date.now() }));
    localStorage.setItem('pn_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }));
  };
}

/** Fill and submit the seeker request form. The poster's name comes from the
 *  signed-in user, so the card (if it ever renders) carries AUTHOR.name. */
async function postRequest(page) {
  await page.goto(`${BASE}/flatmates?post=1`);
  await expect(page.getByRole('heading', { name: /Post your flatmate request/i })).toBeVisible({ timeout: 10000 });
  await page.locator('input[placeholder="₹ e.g. 15000"]').fill('16000');
  await page.getByRole('button', { name: 'Preferred localities' }).click();
  await page.locator('.pn-dropdown__option', { hasText: 'Baner' }).first().click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Post request/i }).click();
}

test('a new request is held for review, and says so', async ({ page }) => {
  await page.addInitScript(signIn(AUTHOR), AUTHOR);
  await postRequest(page);
  await switchToTeamUp(page);

  // The author's own banner is the ONLY place the post appears, and it names the
  // state rather than claiming the post is live.
  await expect(page.getByText(/in review/i).first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Your live request')).toHaveCount(0);
  await expect(page.getByText(/checks every new post before it goes on the board/i)).toBeVisible();

  // Editing and taking it down must still work while it waits — a post trapped in
  // a queue the author cannot withdraw from is worse than no queue.
  await expect(page.getByRole('button', { name: /^Edit$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Delete$/ })).toBeVisible();
});

test('nobody else can see it until a moderator acts', async ({ page }) => {
  await page.addInitScript(signIn(AUTHOR), AUTHOR);
  await postRequest(page);

  // Confirm the write actually landed before asserting an absence — otherwise a
  // form that silently failed would pass this test for the wrong reason.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('puneNestFlatmatePosts') || '[]'));
  expect(stored.some((p) => p.modStatus === 'pending')).toBe(true);

  // Now arrive as somebody else. The pending row is in the same store, so if the
  // board rendered it the card would be here.
  await page.addInitScript(signIn(STRANGER), STRANGER);
  await page.goto(`${BASE}/flatmates`);
  await switchToTeamUp(page);
  await expect(page.locator('.sf-card').first()).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.sf-card', { hasText: AUTHOR.name })).toHaveCount(0);
});

test('an approved post reaches the board unchanged', async ({ page }) => {
  // The gate has to be a gate, not a wall: approval is what makes it public, and
  // this is the test that fails if the whitelist forgets a legitimate state.
  await page.addInitScript(signIn(AUTHOR), AUTHOR);
  await postRequest(page);
  await approveFlatmates(page, 'posts');

  await page.addInitScript(signIn(STRANGER), STRANGER);
  await page.goto(`${BASE}/flatmates`);
  await switchToTeamUp(page);
  await expect(page.locator('.sf-card', { hasText: AUTHOR.name }).first()).toBeVisible({ timeout: 10000 });
});
