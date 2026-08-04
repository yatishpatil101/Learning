import { test, expect } from '@playwright/test';
import { ownerMobileOf } from '../../../helpers/app.js';

const BASE = 'http://localhost:5173';
const PROP = 'P5000';                 // approved seed listing
const OWNER_MOBILE = ownerMobileOf(PROP);   // read from properties.json, never copied
/* Derived, not spelled out, so a change to the seed data can't leave these three
   describing a different number than the app renders. Mirrors maskPhone(): first
   two and last two digits kept, the rest bulleted as `99••• •••55`. */
const OWNER_MASK = new RegExp(`${OWNER_MOBILE.slice(0, 2)}••• •••${OWNER_MOBILE.slice(-2)}`);
const OWNER_PLAIN = [OWNER_MOBILE, `+91 ${OWNER_MOBILE.slice(0, 5)} ${OWNER_MOBILE.slice(5)}`];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Test', mobile: '9876500000', role: 'buyer', loginAt: Date.now() }));
  });
});

// The generic /contact page is a support page — it must NOT invent a phantom owner
// or expose any owner's personal number. Only genuine PuneNest support channels appear.
test('/contact (generic) shows no owner card and leaks no owner number', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${BASE}/contact`);

  // No phantom "owner" card, no fake owner identity.
  await expect(page.locator('.glass-card', { hasText: 'Contact owner directly' })).toHaveCount(0);
  await expect(page.getByText('Aarav Sharma')).toHaveCount(0);

  // The support card offers genuine PuneNest channels (not an owner's personal contact).
  const support = page.locator('.glass-card', { hasText: 'Need help?' });
  await expect(support).toBeVisible();
  await expect(support.locator('a[href="tel:18002000000"]')).toBeVisible();
  await expect(support.locator('a[href^="mailto:hello@punenest.com"]')).toBeVisible();
  await expect(support.locator('a[href^="https://wa.me/"]')).toBeVisible();

  // The enquiry form is the primary CTA.
  await expect(page.getByRole('button', { name: 'Send enquiry', exact: true })).toBeVisible();

  expect(errors).toEqual([]);
});

// With a property reference the owner card appears, but the number stays gated:
// masked, no plaintext, and no direct WhatsApp / tel / email escape hatch to the owner.
test('/contact?ref keeps the owner number gated behind the enquiry request', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${BASE}/contact?ref=${PROP}`);

  const card = page.locator('.glass-card', { hasText: 'Contact owner directly' });
  await expect(card).toBeVisible();

  // Masked, not plaintext, inside the owner card.
  await expect(card.getByText(OWNER_MASK)).toBeVisible();
  for (const plain of OWNER_PLAIN) await expect(card.getByText(plain)).toHaveCount(0);

  // No direct escape hatches to the owner from the owner card.
  await expect(card.getByRole('link', { name: /WhatsApp/i })).toHaveCount(0);
  await expect(card.locator('a[href^="mailto:"]')).toHaveCount(0);
  await expect(card.locator('a[href^="tel:"]')).toHaveCount(0);
  await expect(card.locator('a[href^="https://wa.me/"]')).toHaveCount(0);

  // The enquiry gate is offered instead.
  await expect(card.getByRole('button', { name: /Send an enquiry to request it/i })).toBeVisible();

  expect(errors).toEqual([]);
});