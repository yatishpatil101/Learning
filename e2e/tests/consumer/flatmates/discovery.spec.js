import { test, expect } from '@playwright/test';
import { openFlatmates, cardIds, seed, SEEKER } from '../../../helpers/app.js';

/* What is left of the Flatmates discovery suite, and why it is still here.
   ─────────────────────────────────────────────────────────────────────────
   Nine of this file's ten tests were converted to `live-discovery.spec.js` and deleted from here.
   This one **cannot be**, and the reason is a missing capability rather than a difficult port, so
   deleting it would drop the behaviour rather than move it.

   `useFlatmates:142` derives `myPost` from `getMyRequest`, which reads `puneNestFlatmatePosts` in
   `lib/data/flatmates.js` — the mock store, which is empty in http mode. There is nowhere to
   repoint it: `Routes.Flatmates` publishes no "my seeker posts" route (`/me/flatmate-requests` is
   the host's interest inbox, a different entity), and the public posts feed masks `mobile` to
   null, so a live client cannot recognise its own row on the board at all.

   That gap is wider than this banner. The own-post exclusion at `useFlatmateDiscovery:112` is
   `!(myPost && r.id === myPost.id)`, so on the live board a seeker also sees their own request as
   a card they may express interest in. The endpoint that would close both is written up in
   `tasks/todo.md`; when it lands, this test moves to `live-discovery.spec.js` and this file goes.

   Until then it runs mock-side, which is honest: it is the only cover for the banner, and the mock
   is the only build where the banner can render. */

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

