import { expect, test } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';
import { mintSociety } from '../../../helpers/liveSociety.js';

/* What the hub says about a building nobody has confirmed — live.
 *
 * Split out of the retired `onboarding-p2.spec.js`, which kept the whole society-onboarding
 * lifecycle in localStorage: candidates in `dzCommunitySocieties`, promotions in
 * `dzSocietyOverlay`, merges in `dzSocietyMerges`, suggestions in `dzSocietySuggestions`. Six of
 * its eight tests are now owned elsewhere and are deleted rather than ported:
 *
 *   RERA import fills the catalogue      -> admin/live-societies-directory ("the desk counts the
 *                                          whole catalogue, not the page it is showing", L80) for
 *                                          the count, consumer/society/live-rera-catalogue for a
 *                                          named RERA row's exact values
 *   admin Candidates verifies a society  -> admin/live-societies L131, L156, L179
 *   admin Merge folds a duplicate        -> admin/live-societies L197, L233
 *   a searcher mints a missing society   -> consumer/society/live-follows L99
 *   a thin hub stays honest              -> consumer/society/live-rera-catalogue ("an unknown slug
 *                                          renders an honest placeholder, not a confident society")
 *   ops apply a suggestion and the hub
 *   shows community-provided details     -> live-society-proposals L100 owns the server half. The
 *                                          browser half cannot hold yet: `useSocietyHub` still
 *                                          resolves `soc` out of the bundled catalogue, so an
 *                                          approved suggestion changes the database and nothing on
 *                                          the page. Tracked as an unmigrated gap; a test written
 *                                          against it today would be red about the wire, not a bug.
 *
 * What is left needs a browser and a server at once, and is below. `live-society-proposals` L100
 * and L127 own the rules — an approved detail suggestion reaches the catalogue, and anyone signed
 * in may file one; L322 owns the refusal of an empty one.
 *
 * These two tests are the one place a minted society is the right fixture rather than the wrong
 * one. Everywhere else a browser-level society test must use a catalogue slug, because the hub
 * reads `resolveSociety` out of the bundle and a minted row renders `genericSociety`. Here that IS
 * the subject: a society the server knows about and the catalogue does not is exactly the state
 * the honest-placeholder branch exists for.
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

/** A MahaRERA row that carries registration, conveyance and a full specification block. */
const CONFIRMED = 'horizon-woods-aditya-tathawade';

const statLabel = (page, label) => page.locator('.rd-lbl', { hasText: label });

async function openHub(page, slug) {
  await page.goto(`${BASE}/society/${slug}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
}

test('details offered for an unconfirmed society are held for review, not printed as fact', async ({ page, request }) => {
  const me = await signedInAsNew(page);
  const slug = await mintSociety(request, me, 'suggest');

  await openHub(page, slug);

  /* The honest state, asserted before anything is submitted — it is the anchor for everything
     after it, and it is also the branch the whole test depends on being reachable. */
  await expect(page.getByText('Details not confirmed yet')).toBeVisible();
  const helpVerify = page.getByRole('button', { name: /Help verify/i });
  await expect(helpVerify).toBeVisible();

  const BUILDER = 'Zz Suggested Builders';
  await helpVerify.click();
  const dialog = page.getByRole('dialog', { name: 'Add society details' });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.getByPlaceholder('e.g. Kolte-Patil').fill(BUILDER);
  await dialog.getByPlaceholder('e.g. 420').fill('312');
  await dialog.getByRole('button', { name: /Submit for review/i }).click();

  /* Pending replaces the invitation, so the same visitor is not asked twice for what they have
     already given us. */
  await expect(page.getByText('Details submitted — pending review')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /Help verify/i })).toHaveCount(0);

  /* And the page does not start repeating them. Held for review means held: a hub that printed
     "312 units" the moment somebody typed it would be making the same unbacked claim the
     fabricated-row bug made, only with a stranger's numbers instead of invented ones. */
  await expect(statLabel(page, 'Total units')).toHaveCount(0);
  await expect(page.getByText(BUILDER)).toHaveCount(0);

  /* The reload is the live half. The retired spec read `dzSocietySuggestions` back out of the tab
     that had just written it, which is true of any value a page holds in memory. Coming back after
     a reload means the proposal is on the server, attributed to this account, and that a second
     visit edits it rather than filing a duplicate the server would refuse. */
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Details submitted — pending review')).toBeVisible({ timeout: 15_000 });
  await expect(statLabel(page, 'Total units')).toHaveCount(0);
  await expect(page.getByText(BUILDER)).toHaveCount(0);
});

test('the verified badge is a catalogue fact, and a society nobody has confirmed does not wear one', async ({ page, request }) => {
  /* A confirmed society, first. `live-rera-catalogue` proves the absence of this badge on a slug
     the catalogue has never heard of; on its own that passes against a page that stopped drawing
     the badge at all. This is the row it has to keep drawing it for. */
  await openHub(page, CONFIRMED);
  await expect(page.getByText('Society Verified').first()).toBeVisible();
  await expect(statLabel(page, 'Total units')).toBeVisible();
  await expect(page.getByText('Details not confirmed yet')).toHaveCount(0);

  /* And a society that exists — a real server row with a real hub, reachable, followable, open for
     questions — but that nobody has confirmed anything about. Same page, same components, and the
     only difference is what we actually know. */
  const author = await signedInAsNew(page);
  const minted = await mintSociety(request, author, 'badge');
  await openHub(page, minted);
  await expect(page.getByText('Details not confirmed yet')).toBeVisible();
  await expect(page.getByText('Society Verified')).toHaveCount(0);
  await expect(statLabel(page, 'Total units')).toHaveCount(0);
});
