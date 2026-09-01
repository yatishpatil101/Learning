import { expect, test } from '../../../fixtures/live.js';
import { API, apiLogin, authHeaders, signedInAsNew, uniqueMobile } from '../../../helpers/liveAuth.js';

/* The society hub's community tab, in a browser, against the live API.
 *
 * The retired mock twin wrote `puneNestUser` and `pnSocietyContributions` into localStorage and
 * then read them back — a community of exactly one person, which is the very thing D240 slice 3
 * moved to the server. Its assertions could not distinguish a working feature from a broken one;
 * `live-contribution-photo.spec.js` opens with the proof, on a photo bug every mock spec passed.
 *
 * The **rules** now belong to the server and are proved where they are decided, over HTTP, in
 * `tests/live-society-contributions.spec.js`: one vote per person however many times you press,
 * most-helpful outranking newest, each kind's own minimum fields, a recommended tradesman's number
 * withheld from a reader with no account, and — the one this file leans on hardest — that a
 * neighbour cannot remove your tip while you and staff can. None of that is re-proved through a
 * browser, which would only be a slower door onto the same decision.
 *
 * What is left is the half a browser is the only witness to:
 *
 *  - each Add button opens *its own* form, and what that form files comes back on the feed;
 *  - a signed-in member who has verified nothing is let straight through (ADR-019 badge-not-gate),
 *    which is a claim about a dialog that must *not* appear;
 *  - the filter chips narrow the feed and their counts add up;
 *  - the remove control is rendered exactly where the server says it may be. The mock computed
 *    that from mobile equality in the browser; the row now arrives carrying `canRemove`, so what
 *    is under test is whether the page honours it. A page that draws the control anyway hands a
 *    neighbour a button that 403s — the server holds, but the UI has lied.
 *
 * One claim changed meaning twice, and now ends in an absence. The mock counted three "Verified"
 * badges and read them as *identity-verified authors*. The page then rendered one badge or the
 * other — `authorIsResident ? Resident : Verified` — and this file re-stated "Verified" as meaning
 * only "not a resident of this society", which is a sentence no reader of a teal check-mark labelled
 * *Verified* has ever construed. Nothing named `verified` exists in this domain on either side of
 * the seam: `authorIsResident` is the whole of what the server states, so the false arm was a trust
 * mark awarded on the strength of the one thing known to be false about the author. The badge is
 * gone, and what is asserted now is that a stranger's tip wears no mark of any kind.
 *
 * Photos are `live-contribution-photo.spec.js`'s subject entirely, including the upload ordering
 * that made it necessary, so this file files tips and picks only.
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

/* A slug per test. The database resets once per run, not once per test, and `workers:1` means
   every spec in the run shares it — so a test that counts what is on a society needs one nobody
   else writes to. These are catalogue rows: the hub resolves its name, pin and tabs from the
   bundled catalogue (see `useSocietyHub.js`), so a society minted through the API renders as
   `_generic` with half its tabs missing and cannot stand in for one. */
const SOC_ADD = 'aster-woods-majestique-pashan';
const SOC_GATE = 'blue-avenue-nyati-hinjawadi';
const SOC_COUNTS = 'aster-greens-pethkar-kharadi';
const SOC_REMOVE = 'aster-vista-montvert-kondhwa';

/** File a contribution over HTTP, for arranging a state the test is not itself about. */
async function share(mobile, slug, payload) {
  const res = await fetch(`${API}/societies/${slug}/contributions`, {
    method: 'POST',
    headers: await authHeaders(mobile),
    body: JSON.stringify(payload),
  });
  expect(res.status, `POST ${slug}/contributions: ${await res.clone().text()}`).toBe(201);
  return (await res.json()).id;
}

/** The community tab, open and painted. */
async function gotoCommunity(page, slug) {
  await page.goto(`${BASE}/society/${slug}?tab=community`);
  /* The tab strip only paints once the society read resolves; asserting on the feed before the
     heading is there races the fetch and fails as a timeout on the wrong element. */
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
  return page.locator('section', { has: page.getByRole('heading', { name: 'Community insights' }) });
}

const cardFor = (feed, text) => feed.locator('div.glass.rounded-xl', { hasText: text });

test('each Add button opens its own form, and what that form files comes back on the feed', async ({ page }) => {
  await signedInAsNew(page);
  const feed = await gotoCommunity(page, SOC_ADD);

  /* Unique per run so the assertion is about this test's row and not one left behind. */
  const stamp = Date.now().toString(36);
  const tip = `Guest parking is behind D-wing, first come first served ${stamp}`;
  const pick = `Sunita the maid ${stamp}`;

  /* Each dialog is named after the button that opened it. Asserting the *specific* name is what
     makes "Add local pick opened the local-pick form" a claim at all — a shared generic title
     would pass even if all three buttons opened the tip form, which is what they used to do. */
  await page.getByRole('button', { name: 'Add tip', exact: true }).click();
  const tipDialog = page.getByRole('dialog', { name: 'Add tip' });
  await expect(tipDialog).toBeVisible();
  await tipDialog.getByPlaceholder(/Water tanker fills/i).fill(tip);
  await tipDialog.getByRole('button', { name: 'Post to community' }).click();
  await expect(feed.getByText(tip)).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Add local pick', exact: true }).click();
  const pickDialog = page.getByRole('dialog', { name: 'Add local pick' });
  await expect(pickDialog).toBeVisible();
  await pickDialog.getByPlaceholder(/Person \/ service name/i).fill(pick);
  await pickDialog.getByPlaceholder(/^Phone/i).fill('9812345678');
  await pickDialog.getByRole('button', { name: 'Post to community' }).click();
  await expect(feed.getByText(pick)).toBeVisible({ timeout: 15_000 });

  /* Filed, not merely rendered: a reload re-reads the feed from the server. */
  await page.reload();
  const after = page.locator('section', { has: page.getByRole('heading', { name: 'Community insights' }) });
  await expect(after.getByText(tip)).toBeVisible({ timeout: 20_000 });
  await expect(after.getByText(pick)).toBeVisible();

  /* Both rows are the author's, and the author lives somewhere else — so neither carries a badge.
     Asserted in both directions, because the interesting regression is a *present* mark, and the
     resident one is only half of that: the row used to fall through to a teal "Verified" check-mark
     whenever `authorIsResident` was false, which decorated every stranger on the site. Pinning the
     absence of both is what keeps either from creeping back under the other's name. */
  /* Anti-vacuity first: the card locator resolves to exactly one row. Without this the two
     absences below are also what a mistyped locator returns, and the test would go green over a
     feed that had stopped rendering entirely. */
  await expect(cardFor(after, tip)).toHaveCount(1);
  await expect(cardFor(after, tip).getByText('Verified', { exact: true })).toHaveCount(0);
  await expect(cardFor(after, tip).getByText('Resident', { exact: true })).toHaveCount(0);
});

test('a member who has verified nothing contributes directly — signing in is the only floor', async ({ page }) => {
  await signedInAsNew(page);
  await gotoCommunity(page, SOC_GATE);

  await page.getByRole('button', { name: 'Add tip', exact: true }).click();

  /* ADR-019, badge-not-gate. The load-bearing half of this test is an absence, so it is gated on
     the dialog that must be there: if the contribute form never opened, the Aadhaar wall being
     absent too would prove nothing at all. */
  await expect(page.getByRole('dialog', { name: 'Add tip' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('dialog', { name: /Verify your identity with Aadhaar/i })).toHaveCount(0);
});

test('the filter chips narrow the feed, and their counts add up', async ({ page }) => {
  const author = uniqueMobile();
  await apiLogin(author, { api: API });

  const stamp = Date.now().toString(36);
  const water = `Water timings are 6am and 7pm ${stamp}`;
  const parking = `Visitor parking fills by 8pm ${stamp}`;
  const cook = `Meera the cook ${stamp}`;

  /* Arranged over HTTP rather than through three dialogs: what this test is about is the chips,
     and the filing is proved by the test above. Posted in order so "newest first" is known. */
  await share(author, SOC_COUNTS, { kind: 'tip', body: water });
  await share(author, SOC_COUNTS, { kind: 'tip', body: parking });
  await share(author, SOC_COUNTS, { kind: 'pick', referralName: cook });

  await signedInAsNew(page);
  const feed = await gotoCommunity(page, SOC_COUNTS);

  /* The counts are the assertion, not decoration: a chip that says "Tips (2)" and then shows one
     is the bug, and it is invisible to a test that only checks what is on screen. This society is
     written to by nothing else, so the numbers are exact rather than "at least". */
  await expect(feed.getByRole('button', { name: 'All (3)', exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(feed.getByRole('button', { name: 'Tips (2)', exact: true })).toBeVisible();
  await expect(feed.getByRole('button', { name: 'Local picks (1)', exact: true })).toBeVisible();

  await expect(feed.getByText(water)).toBeVisible();
  await expect(feed.getByText(cook)).toBeVisible();

  await feed.getByRole('button', { name: 'Tips (2)', exact: true }).click();
  /* Paired: the pick is gone AND both tips are still there. "Tips" filtering down to nothing
     would satisfy the absence on its own. */
  await expect(feed.getByText(cook)).toHaveCount(0);
  await expect(feed.getByText(water)).toBeVisible();
  await expect(feed.getByText(parking)).toBeVisible();

  await feed.getByRole('button', { name: 'Local picks (1)', exact: true }).click();
  await expect(feed.getByText(cook)).toBeVisible();
  await expect(feed.getByText(water)).toHaveCount(0);
  await expect(feed.getByText(parking)).toHaveCount(0);

  await feed.getByRole('button', { name: 'All (3)', exact: true }).click();
  await expect(feed.getByText(water)).toBeVisible();
  await expect(feed.getByText(cook)).toBeVisible();
});

test('the remove control is drawn only where the server says it may be', async ({ page }) => {
  const neighbour = uniqueMobile();
  await apiLogin(neighbour, { api: API });

  const stamp = Date.now().toString(36);
  const theirs = `THEIRS clubhouse booking is on the app ${stamp}`;
  await share(neighbour, SOC_REMOVE, { kind: 'tip', body: theirs });

  const me = await signedInAsNew(page);
  /* `uniqueMobile()` is clock-derived, so two calls close together can collide and the second
     silently signs in as the first — which would turn this into a test of one account agreeing
     with itself. */
  expect(me).not.toBe(neighbour);

  const feed = await gotoCommunity(page, SOC_REMOVE);

  const mine = `MINE the gate closes at 11pm sharp ${stamp}`;
  await page.getByRole('button', { name: 'Add tip', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add tip' });
  await dialog.getByPlaceholder(/Water tanker fills/i).fill(mine);
  await dialog.getByRole('button', { name: 'Post to community' }).click();
  await expect(feed.getByText(mine)).toBeVisible({ timeout: 15_000 });

  /* The neighbour's tip is the adversarial row this whole test exists for: it clears every other
     condition — same society, same tab, same feed, rendered right there — and the only reason it
     must not carry a remove control is that it is not mine. Its presence is asserted first so the
     absence below cannot pass by the card simply not being on the page. */
  await expect(feed.getByText(theirs)).toBeVisible();
  await expect(cardFor(feed, mine).getByRole('button', { name: 'Remove contribution' })).toBeVisible();
  await expect(cardFor(feed, theirs).getByRole('button', { name: 'Remove contribution' })).toHaveCount(0);

  await cardFor(feed, mine).getByRole('button', { name: 'Remove contribution' }).click();
  await expect(feed.getByText(mine)).toHaveCount(0, { timeout: 15_000 });
  /* And it went from the server, not just from React state. */
  await page.reload();
  const after = page.locator('section', { has: page.getByRole('heading', { name: 'Community insights' }) });
  await expect(after.getByText(theirs)).toBeVisible({ timeout: 20_000 });
  await expect(after.getByText(mine)).toHaveCount(0);
});
