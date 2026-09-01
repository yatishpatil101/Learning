import { test, expect } from '@playwright/test';
import { ownerMobileOf } from '../../../helpers/app.js';

/* In-app chat with the owner from a listing.
   - Before the owner approves: the sidebar keeps the "Contact Owner" button.
   - After approval: it becomes "Chat with Owner", routing into /messages and opening
     an active conversation tied to that property. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const PROP = 'P5000';                 // approved seed listing
const OWNER_MOBILE = ownerMobileOf('P5000'); // read from properties.json, never copied
const BUYER = '9876543210';           // a different number → a buyer, not the owner
const REQ_KEY = 'puneNestContactReq:' + OWNER_MOBILE;

async function seedBuyer(page, { approved = false } = {}) {
  await page.addInitScript(({ buyer, owner, reqKey, approved }) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Test Buyer', mobile: buyer, role: 'buyer', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + buyer, JSON.stringify({ verified: true, aadhaarMobile: buyer, at: Date.now() }));
    if (approved) {
      localStorage.setItem(reqKey, JSON.stringify([{ id: 'c1', propId: 'P5000', buyerName: 'Test Buyer', buyerMobile: buyer, status: 'approved', requestedAt: Date.now() }]));
    }
  }, { buyer: BUYER, owner: OWNER_MOBILE, reqKey: REQ_KEY, approved });
}

test('unapproved buyer sees "Contact Owner" (not the chat route)', async ({ page }) => {
  await seedBuyer(page, { approved: false });
  await page.goto(`${BASE}/property/${PROP}`);
  const btn = page.getByRole('button', { name: /Contact Owner/i }).first();
  await btn.waitFor({ timeout: 10000 });
  await expect(btn).toBeVisible();
  await expect(page.getByRole('link', { name: /Chat with Owner/i })).toHaveCount(0);
});

test('verified buyer clicking "Contact Owner" opens the owner chat with a pending request', async ({ page }) => {
  await seedBuyer(page, { approved: false });   // verified (seedBuyer sets Aadhaar) but not yet contact-approved
  await page.goto(`${BASE}/property/${PROP}`);

  const btn = page.getByRole('button', { name: /Contact Owner/i }).first();
  await btn.waitFor({ timeout: 10000 });
  await btn.click();

  // Straight into the in-app thread for this listing — no number-reveal popup.
  await expect(page).toHaveURL(/\/messages\?openProp=P5000/);
  await expect(page.locator('.pc-propchip').getByText(/View listing/i)).toBeVisible({ timeout: 10000 });
  // The first message is already sent and the thread is awaiting the owner's acceptance.
  await expect(page.getByText(/interested in/i).first()).toBeVisible();
  await expect(page.getByText(/Waiting for the owner to accept/i)).toBeVisible();
});

test('approved buyer gets "Chat with Owner" that opens the owner chat in Messages', async ({ page }) => {
  await seedBuyer(page, { approved: true });
  await page.goto(`${BASE}/property/${PROP}`);

  const chat = page.getByRole('link', { name: /Chat with Owner/i }).first();
  await chat.waitFor({ timeout: 10000 });
  await expect(chat).toHaveAttribute('href', /\/messages\?openProp=P5000/);

  await chat.click();
  await expect(page).toHaveURL(/\/messages\?openProp=P5000/);

  // The conversation for this property opens with a usable composer (active state).
  await expect(page.locator('.pc-propchip').getByText(/View listing/i)).toBeVisible({ timeout: 10000 });
  await expect(page.locator('input.pc-input')).toBeVisible();
});
