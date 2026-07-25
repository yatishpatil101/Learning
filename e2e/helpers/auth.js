// Authentication helpers.
//
// - Consumer sign-in is seeded directly into localStorage (fast, deterministic).
// - Staff / admin sign-in uses the real /staff-login "Demo quick access" buttons
//   (they skip OTP) so role/team/module scoping is exercised exactly as in prod.

import { USERS, seedUser } from './seed.js';

/** Seed a signed-in buyer and open the app. */
export async function loginAsBuyer(page, over = {}, opts) {
  await seedUser(page, { ...USERS.buyer, ...over }, opts);
}

/** Seed a signed-in owner and open the app. */
export async function loginAsOwner(page, over = {}, opts) {
  await seedUser(page, { ...USERS.owner, ...over }, opts);
}

/** Seed a signed-in tenant and open the app. */
export async function loginAsTenant(page, over = {}, opts) {
  await seedUser(page, { ...USERS.tenant, ...over }, opts);
}

/** Full-admin quick login via the staff console. Lands on /admin. */
export async function loginAsAdmin(page) {
  await page.goto('/staff-login');
  await page.getByRole('button', { name: 'Admin', exact: true }).click();
  await page.waitForURL('**/admin');
}

/** Service-team (ops) quick login. `team` ∈ Rental|Legal|Loans|Interior|Packers|Valuation. */
export async function loginAsStaff(page, team = 'Rental') {
  await page.goto('/staff-login');
  await page.getByRole('button', { name: team, exact: true }).click();
  await page.waitForURL('**/ops**');
}

/** Scoped-manager quick login. `label` ∈ Verifications|Requests Desk|Content. */
export async function loginAsManager(page, label = 'Verifications') {
  await page.goto('/staff-login');
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.waitForURL('**/admin');
}
