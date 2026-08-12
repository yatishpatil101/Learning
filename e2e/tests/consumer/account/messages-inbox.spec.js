import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';

/* End-to-end coverage of the buyer↔owner messaging inbox and its cross-surface
   wiring (navbar badge, dashboard preview, contact-gated header actions). Seeds
   come from lib/chat.js; a logged-in buyer is required (the route is protected). */

const BASE = 'http://localhost:5173';

async function login(page) {
  await page.addInitScript(() => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Test User', mobile: '9876543210', role: 'buyer', loginAt: Date.now() }));
  });
}

test('inbox loads seed conversations with a clean console', async ({ page }) => {
  const errors = trackErrors(page);
  await login(page);
  await page.goto(`${BASE}/messages`);
  await expect(page.locator('.pc-list-head h2')).toHaveText('Messages');
  await expect(page.locator('.pc-conv')).not.toHaveCount(0);
  const meaningful = errors.filter((e) => !/favicon|leaflet|googleapis|gstatic|maps|ERR_/i.test(e));
  expect(meaningful, meaningful.join('\n')).toHaveLength(0);
});

test('send message shows in thread, gets an auto-reply, and persists on reload', async ({ page }) => {
  await login(page);
  await page.goto(`${BASE}/messages?c=c1`);
  await expect(page.locator('input.pc-input')).toBeVisible();
  await page.locator('input.pc-input').fill('Hello there test message');
  await page.locator('.pc-send').click();
  await expect(page.locator('.pc-bubble.me', { hasText: 'Hello there test message' })).toBeVisible();
  await expect(page.locator('.pc-bubble.them', { hasText: 'Got it' })).toBeVisible({ timeout: 4000 });
  await page.reload();
  await expect(page.locator('.pc-bubble.me', { hasText: 'Hello there test message' })).toBeVisible();
});

test('quick-reply chips appear on the buyers turn and send instantly', async ({ page }) => {
  await login(page);
  await page.goto(`${BASE}/messages?c=c1`); // c1: owner spoke last → buyer's turn
  const chip = page.locator('.pc-quick-chip', { hasText: 'Is it still available?' });
  await expect(chip).toBeVisible();
  await expect(page.locator('.pc-bubble.me')).toHaveCount(1); // seed has one buyer message
  await chip.click();
  await expect(page.locator('.pc-bubble.me')).toHaveCount(2); // quick reply added
});

test('buyer thread hides the owner number until contact is approved', async ({ page }) => {
  await login(page);
  await page.goto(`${BASE}/messages?c=c1`); // youAre=buyer, no approved contact
  await expect(page.locator('.pc-head-actions a[href^="tel:"]')).toHaveCount(0);
  await expect(page.locator('.pc-head-actions button[disabled]')).toBeVisible();
});

test('owner-side thread exposes the buyer number (they reached out)', async ({ page }) => {
  await login(page);
  await page.goto(`${BASE}/messages?c=c2`); // youAre=owner
  await expect(page.locator('.pc-head-actions a[href^="tel:"]')).toBeVisible();
});

test('attach → share location posts a card into the thread', async ({ page }) => {
  await login(page);
  await page.goto(`${BASE}/messages?c=c1`);
  await page.locator('.pc-icon-btn').click();
  await expect(page.locator('.pc-attach-pop')).toBeVisible();
  await page.getByRole('button', { name: /Share location/ }).click();
  await expect(page.locator('.pc-bubble.me .pc-card', { hasText: 'Shared location' })).toBeVisible();
});

test('report action opens the moderation modal', async ({ page }) => {
  await login(page);
  await page.goto(`${BASE}/messages?c=c1`);
  await page.locator('.pc-head-actions button[aria-label="Report this user"]').click();
  await expect(page.getByRole('dialog', { name: /Report/ })).toBeVisible();
});

test('staged request shows waiting state, not a composer', async ({ page }) => {
  await login(page);
  await page.goto(`${BASE}/messages?c=c4`);
  await expect(page.getByText(/Waiting for the owner/)).toBeVisible();
  await expect(page.locator('input.pc-input')).toHaveCount(0);
});

/* Re-scoped for D52 (was: "accepting an incoming request moves it into chats with a composer").
   The `incoming` state, and the Accept/Decline panel that acted on it, were the frontend's own
   invention — the contract has no field for them, and on the server a conversation cannot exist
   before an approved contact request, so the accepting happens one layer up in the contact gate.
   `c3` is now what the server would actually hold at that point: a real owner-side thread carrying
   the buyer's unread opening message. This asserts the successor behaviour — it opens ready to
   reply — and that the retired panel is gone rather than merely unreachable. */
test('an owner-side thread with an unread message opens ready to reply, with no accept panel', async ({ page }) => {
  await login(page);
  await page.goto(`${BASE}/messages?c=c3`);
  await expect(page.locator('.pc-bubble.them', { hasText: /interested in your 4 BHK Villa/i })).toBeVisible();
  await expect(page.locator('input.pc-input')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept chat' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Decline' })).toHaveCount(0);
});

test('search filters the conversation list', async ({ page }) => {
  await login(page);
  await page.goto(`${BASE}/messages`);
  await page.locator('.pc-search input').fill('zzz-no-match');
  await expect(page.locator('.pc-empty-list')).toBeVisible();
});

test('navbar shows the chat unread badge', async ({ page }) => {
  await login(page);
  await page.goto(`${BASE}/`);
  const badge = page.locator('a[href="/messages"]').first().locator('span').first();
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText(/\d+/);
});

test('dashboard Messages tab opens the canonical /messages inbox (no divergent preview)', async ({ page }) => {
  await login(page);
  await page.goto(`${BASE}/dashboard#messages`);
  // The dashboard entry is a link-out: it redirects to the single full inbox
  // rather than rendering a second, cut-down layout.
  await page.waitForURL(/\/messages/);
  await expect(page.locator('.pc-list-head h2')).toHaveText('Messages');
  await expect(page.locator('.pc-conv')).not.toHaveCount(0);
});
