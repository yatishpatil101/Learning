import { test, expect } from '../../fixtures/base.js';

/* Ops → Support queue — **truncated (wave 2d).**

   Everything this file used to assert about the queue now lives in `ops/live-support-queue.spec.js`,
   against the real `GET /admin/support-tickets`. What is left here is the one property that is a
   property of the *router* rather than of the API: `/ops/support` sits under
   `RoleRoute roles=['staff','admin']`, matching the endpoint's own `x-roles`, so a signed-out
   visitor is bounced to `/staff-login` before any provider is consulted. That check is worth
   keeping in the mock suite because it must hold whichever store answers.

   The six tests removed were: the empty-queue statement, the awaiting-reply row and its summary
   fields, the no-mobile check, the reply-moves-it-to-Answered loop, and the admin's access. All six
   are reproduced live, and two of them are now stronger there — the live suite can assert the
   *two-sided* read model (D50), which one mock store and one flag could not express, and it reads
   a queue row shape (`AdminSupportTicket`) that carries no thread and no mobile by contract rather
   than by the mock's convention.

   This file dies with the mock provider at P5c. */

test.describe('Ops → Support queue (routing)', () => {
  test('an unauthenticated visitor is redirected from /ops/support to staff-login', async ({ page }) => {
    await page.goto('/ops/support');

    await expect(page).toHaveURL(/\/staff-login/);
    await expect(page.getByRole('heading', { name: 'Support queue' })).toHaveCount(0);
  });
});
