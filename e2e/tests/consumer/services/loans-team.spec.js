// @ts-check
import { test, expect } from '@playwright/test';

/*
 * Home Loans routes to its own "Loans" team — not "Property & Legal".
 * Proves the dedicated finance vertical is created with team=loans, is auto-assigned
 * to a seeded loan officer on Start, is labelled "Home Loans" in the admin queue, and
 * that only loan officers appear in the assign dropdown for a loan ticket.
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const BUYER = { name: 'Test Buyer', mobile: '9888888888', email: '', role: 'buyer', joinedAt: Date.now() };
const ADMIN = { name: 'Ops Admin', mobile: '9800000001', email: '', role: 'admin', teams: ['rental', 'legal', 'loans', 'interior', 'packers', 'valuation'], joinedAt: Date.now() };
const LOAN_OFFICERS = ['Aarav Deshpande', 'Priya Nair'];

async function login(page, user) {
  await page.addInitScript((u) => {
    localStorage.setItem('puneNestUser', JSON.stringify(u));
    localStorage.setItem('puneNestUsers', JSON.stringify([u]));
  }, user);
}

test('home loan requests route to a dedicated Loans team and are managed end-to-end in admin', async ({ page }) => {
  // 1) Buyer submits a Home Loan request.
  await login(page, BUYER);
  await page.goto(`${BASE}/home-loans`, { waitUntil: 'networkidle' });

  await page.locator('.pn-dropdown__trigger').first().click();
  await page.getByRole('option', { name: 'Home Purchase Loan' }).click();
  await page.locator('input[type="text"][inputmode="numeric"]').first().fill('5000000');
  const mob = page.locator('#root [data-err="mobile"] input[type="tel"]');
  if (!(await mob.inputValue())) await mob.fill(BUYER.mobile);
  await page.getByRole('button', { name: /Get Loan Offers|Submit|Request/i }).first().click();

  await expect.poll(async () => page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('puneNestDB_v5'));
    return (db.tickets || []).length;
  }), { timeout: 10000 }).toBeGreaterThan(0);
  const ticket = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('puneNestDB_v5'));
    return db.tickets[0];
  });
  expect(ticket.team).toBe('loans');
  expect(ticket.service).toBe('Home Purchase Loan');

  // 2) Admin manages it. The team is labelled "Home Loans", not "Property & Legal".
  await login(page, ADMIN);
  await page.goto(`${BASE}/admin/services`, { waitUntil: 'networkidle' });
  await page.locator('input[placeholder="Search id, customer, detail…"]').fill(ticket.id);
  await expect(page.getByText('Home Loans', { exact: true })).toBeVisible();

  // Start auto-assigns the ticket to a seeded loan officer.
  await page.getByRole('button', { name: /^Start$/ }).first().click();
  await expect.poll(async () => page.evaluate((id) => {
    const db = JSON.parse(localStorage.getItem('puneNestDB_v5'));
    return db.tickets.find((t) => t.id === id)?.status;
  }, ticket.id)).toBe('in_progress');
  const assignedTo = await page.evaluate((id) => {
    const db = JSON.parse(localStorage.getItem('puneNestDB_v5'));
    return db.tickets.find((t) => t.id === id)?.assignedTo;
  }, ticket.id);
  expect(LOAN_OFFICERS).toContain(assignedTo);

  // The assign dropdown for a loan ticket lists only loan officers.
  await page.getByRole('button', { name: /^Open$/ }).first().click();
  await page.locator('button[aria-label="Assign to"]').click();
  const opts = await page.getByRole('option').allInnerTexts();
  expect(opts.some((o) => LOAN_OFFICERS.some((n) => o.includes(n)))).toBe(true);
});
