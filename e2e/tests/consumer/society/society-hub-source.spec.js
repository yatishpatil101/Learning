/* What the society hub reads a society *out of*, on the mock build.
 *
 * The hub used to import `resolveSociety` from `lib/store` and call it during render. It now asks
 * `societyService.getSociety(slug)`, and the live half of that move is proven by
 * `consumer/society/live-society-identity.spec.js`, which opens societies the bundled catalogue has
 * never heard of and checks the page against the row the server hands back over HTTP.
 *
 * That live spec is structurally blind to this file's subject. It talks to a server that holds one
 * flat row per society and speaks its own vocabulary, so the mock provider's two jobs — merging the
 * per-browser buckets the demo build keeps ops edits in, and translating this store's words into
 * the server's — are both invisible from there. A provider that quietly downgraded to
 * `societyBySlug` (the raw bundled record, no merge) or that passed `source` through untranslated
 * would keep every live assertion green.
 *
 * So the assertions below are about what only the mock provider can get wrong, and they are chosen
 * so the bundled record *disagrees* with them rather than merely lacking them.
 */
import { test, expect } from '../../../fixtures/base.js';

/** A curated society that is definitely in the bundle, so any difference is the overlay's doing. */
const SLUG = 'skyline-heights-baner';

/**
 * Write a store bucket before the app boots.
 *
 * `addInitScript` rather than an `evaluate` after `goto`: the hub reads the society once, on mount,
 * so a bucket written after navigation would be read on the *next* render at best and not at all at
 * worst — and a test that then passed would be passing on a re-render, not on the read.
 */
const seedStore = (page, key, value) => page.addInitScript(
  ([k, v]) => localStorage.setItem(k, JSON.stringify(v)),
  [key, value],
);

test('the hub shows what ops edited, not the bundled record', async ({ page, consoleErrors }) => {
  /* `pnSocietyOverlay` is where this build keeps an ops edit — the admin console writes it through
     `setSocietyOverlay`, and `resolveSociety` lays it over the catalogue row. Live, the same edit is
     a column, so the server simply returns it and no merge is involved; that asymmetry is precisely
     why this cannot be checked from the live spec. */
  await seedStore(page, 'pnSocietyOverlay', {
    [SLUG]: { name: 'Zz Overlaid Heights', builder: 'Zz Overlaid Builders' },
  });

  await page.goto(`/society/${SLUG}`);

  /* The heading, not merely "the edited string appears somewhere": the bundled name is
     "Skyline Heights" and it must be *replaced*, not accompanied. */
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Zz Overlaid Heights');
  await expect(page.getByText('Skyline Heights')).toHaveCount(0);
  await expect(page.getByText('Zz Overlaid Builders').first()).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test('a member-added society does not inherit the verified badge from a paperwork edit', async ({ page, consoleErrors }) => {
  /* The second half of the merge, and the sharper one. Two different fields are spelled `source` on
     the two sides of the seam: this store's `source` is the *mint origin* (`'listing'` for a
     building typed into the listing wizard), while the thing the server calls `source` — the
     provenance that separates a curated row from a member-added one — is held here as `tier`. The
     provider therefore has to translate `tier`, not pass `source` through, and the majority of the
     record needs no translation at all, which is what makes the mistake invisible.
     `useSocietyHub` reads `soc.source !== 'community'` as one of the two conditions for the
     verified badge, so getting it wrong does not produce a cosmetic difference: a building one
     member typed in wears the same badge as a society ops confirmed the paperwork for.
     Seeded as a community society whose ops overlay supplies the registration and conveyance flags
     — the exact combination that arms the badge for every *other* provenance — so the assertion is
     that provenance alone withholds it. */
  const slug = 'zz-member-added-wakad';
  await seedStore(page, 'pnCommunitySocieties', [{
    id: 'SCzztest', slug, name: 'Zz Member Added', localitySlug: 'wakad',
    tier: 'community', source: 'listing',
  }]);
  /* `units` and `builder` only to get past the hub's `_thin` branch: a record with neither renders
     the "help us verify this" panel instead of the stats block, and the community notice lives in
     the other arm. The two paperwork flags are the subject. */
  await seedStore(page, 'pnSocietyOverlay', {
    [slug]: { builder: 'Zz Overlaid Builders', units: 120, registration: true, conveyance: true },
  });

  await page.goto(`/society/${slug}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Zz Member Added');

  await expect(page.getByText('Society Verified')).toHaveCount(0);
  await expect(
    page.getByText('Some details are community-provided and not officially verified.'),
  ).toBeVisible();

  expect(consoleErrors).toEqual([]);
});
