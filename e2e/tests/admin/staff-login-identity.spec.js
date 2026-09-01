/* Who the demo console signs you in as, on the mock build.
 *
 * `/staff-login` used to answer that question itself: it imported `lib/mockApi`, looked the mobile
 * up in the seeded team registry, and fell back to its own radio group when the lookup missed. Both
 * halves are demo affordances and both were behind `isHttpDomain('auth')`, so nothing leaked — but
 * the guarantee was a condition somebody had to keep getting right rather than a property of the
 * module graph, and it left a product page reading a build-mode flag whose only job was to switch
 * itself off. The lookup now lives in `providers/mock/authProvider.js`, which the live build never
 * loads.
 *
 * That move is only safe if the resolution still happens, and the live half of this pair cannot see
 * that: `live-rbac.spec.js` asserts the session carries *nothing* the server did not send, which is
 * exactly what a mock provider that had quietly stopped resolving would also produce. So the
 * assertions here are about the fields that only the registry can supply, and they are exact —
 * `roleId` and `moduleAccess` are what the picker cannot invent, and the seeded role has to beat the
 * radio rather than merely differ from it.
 */
import { test, expect } from '../../fixtures/base.js';

/** Sneha Patil — a seeded scoped manager, reachable from the "Requests Desk" quick button. */
const SNEHA = { mobile: '9800000002', name: 'Sneha Patil', roleId: 'CR_requests', moduleAccess: ['users'] };

/** The session the app actually holds, read from whichever tier `remember` put it in. */
const session = (page) => page.evaluate(() => {
  const raw = localStorage.getItem('puneNestUser') || sessionStorage.getItem('puneNestUser');
  return raw ? JSON.parse(raw) : null;
});

test('the quick button mints the seeded account, not the label on the button', async ({ page, consoleErrors }) => {
  await page.goto('/staff-login');
  await page.getByRole('button', { name: 'Requests Desk', exact: true }).click();
  /* Where a scoped manager lands is not what this asserts — `homeFor` sends anyone who is not an
     administrator to their team's desk, and a manager holds no team — so this only waits for the
     sign-in to have happened at all. */
  await expect(page).not.toHaveURL(/staff-login/);

  const who = await session(page);
  expect(who).not.toBeNull();
  /* The button sends a bare mobile and nothing else, so every field below came from the registry.
     A provider that stopped resolving would still sign somebody in — `staffLoginUser` defaults the
     role to `staff` — and would still land on a console, which is why none of this is asserted by
     navigation. */
  expect(who.name).toBe(SNEHA.name);
  expect(who.role).toBe('manager');
  expect(who.roleId).toBe(SNEHA.roleId);
  expect(who.moduleAccess).toEqual(SNEHA.moduleAccess);
  expect(consoleErrors).toHaveLength(0);
});

test('a seeded account outranks the role the radios asked for', async ({ page, consoleErrors }) => {
  /* The OTP path, with the picker left on its default. Administrator is the strongest thing this
     screen can ask for, so a resolution that had degraded into "believe the browser" would hand
     back `admin` — a strictly *wider* account than the one that signed in. Asserting the narrower
     answer is what makes this fail in the direction that matters. */
  await page.goto('/staff-login');
  await expect(page.getByRole('radio', { name: /Administrator/ })).toHaveAttribute('aria-checked', 'true');

  await page.locator('#staff-mobile').fill(SNEHA.mobile);
  await page.getByRole('button', { name: /Send OTP/i }).click();
  await page.getByLabel('OTP digit 1').waitFor();
  await page.getByLabel('OTP digit 1').click();
  for (const digit of '123456') await page.keyboard.type(digit);
  await page.getByRole('button', { name: /Verify & sign in/ }).click();
  await page.waitForURL(/\/(admin|ops)/);

  const who = await session(page);
  expect(who).not.toBeNull();
  expect(who.role).toBe('manager');
  expect(who.roleId).toBe(SNEHA.roleId);
  expect(who.moduleAccess).toEqual(SNEHA.moduleAccess);
  expect(consoleErrors).toHaveLength(0);
});
