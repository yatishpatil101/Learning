import { expect, test } from '../../../fixtures/live.js';
import { API, apiLogin, authHeaders, signedInAs, signedInAsNew, uniqueMobile } from '../../../helpers/liveAuth.js';

/* The residents-only WhatsApp group, in a browser against the live API.
 *
 * Split out of the retired `community-v2.spec.js`. The invite is the one piece of society data
 * that is deliberately not public: ops screen it for scam links, and then it is shown to verified
 * residents only. A mock twin held the whole thing in localStorage, so "the invite is withheld"
 * was a claim about which branch of a component ran, not about what the browser was ever given.
 *
 * The server owns the withholding and is tested where it is decided, in
 * `tests/live-society-proposals.spec.js`: the invite is withheld from a stranger whether or not it
 * is approved (L138), a stranger cannot post one at all (L171), a link that is not a
 * chat.whatsapp.com URL is refused (L179), the ops queue shows the invite it exists to screen and
 * carries no mobile numbers (L286), and that queue is staff-only (L307). None of that is repeated
 * here through a browser.
 *
 * What is left is the three states of one card, which only a browser has: a resident who has just
 * proposed a link sees it is under review and no join button yet; a signed-in non-resident is told
 * a private group exists and how to reach it, and is given no URL; a verified resident gets the
 * link, and it is safe to click.
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const OPS = '9000000000';
const SOC_PENDING = 'skyline-crest-godrej-pimple-saudagar';
const SOC_LIVE = 'skyline-gardens-godrej-wakad';
const INVITE = 'https://chat.whatsapp.com/E2ELiveGroupInviteAbc123';

async function makeResident(request, mobile, slug, flat) {
  const applied = await request.post(`${API}/societies/${slug}/residents`, {
    headers: await authHeaders(mobile),
    data: { flat, relation: 'owner' },
  });
  expect(applied.status(), await applied.text()).toBe(200);
  const { id } = await applied.json();
  const decided = await request.patch(`${API}/societies/${slug}/residents/${id}`, {
    headers: await authHeaders(OPS),
    data: { status: 'verified' },
  });
  expect(decided.status(), await decided.text()).toBe(200);
}

async function gotoHub(page, slug) {
  await page.goto(`${BASE}/society/${slug}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
  return waCard(page);
}

/* `.reveal` is what separates the sidebar card from the modal, which carries the same title and
   the same `glass rounded-2xl` classes — without it the locator matches both while the dialog is
   open and every assertion dies of strict mode rather than of the thing under test. */
const waCard = (page) => page.locator('div.glass.rounded-2xl.reveal', { hasText: 'Resident WhatsApp group' });

test('a resident who has just posted the group link is told it is under review, and is given no join button yet', async ({ page, request }) => {
  const resident = uniqueMobile();
  await apiLogin(resident, { api: API });
  await makeResident(request, resident, SOC_PENDING, 'C-701');
  await signedInAs(page, resident);

  const card = await gotoHub(page, SOC_PENDING);
  await expect(card.getByRole('button', { name: 'Add the group link' })).toBeVisible({ timeout: 15_000 });

  await card.getByRole('button', { name: 'Add the group link' }).click();
  const dialog = page.getByRole('dialog', { name: 'Resident WhatsApp group' });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.getByPlaceholder(/chat\.whatsapp\.com/i).fill(INVITE);
  await dialog.getByRole('button', { name: 'Submit for review' }).click();

  /* The pending line is the positive anchor for the absence beneath it: without it a card that
     failed to render at all would satisfy "there is no join button" perfectly. */
  await expect(card.getByText(/residents can join once our team approves it/i)).toBeVisible({ timeout: 15_000 });
  await expect(card.getByRole('link', { name: /Join WhatsApp group/i })).toHaveCount(0);

  /* And it is the server's answer, not the submitting tab's memory of what it just typed. */
  await page.reload();
  const after = waCard(page);
  await expect(after.getByText(/residents can join once our team approves it/i)).toBeVisible({ timeout: 20_000 });
  await expect(after.getByRole('link', { name: /Join WhatsApp group/i })).toHaveCount(0);
});

test('an approved invite reaches a verified resident as a link that is safe to click', async ({ page, request }) => {
  const author = uniqueMobile();
  await apiLogin(author, { api: API });
  await makeResident(request, author, SOC_LIVE, 'D-102');

  const lodged = await request.post(`${API}/societies/${SOC_LIVE}/proposals`, {
    headers: await authHeaders(author),
    data: { kind: 'whatsapp', inviteUrl: INVITE },
  });
  expect(lodged.status(), await lodged.text()).toBe(201);
  const { id } = await lodged.json();
  const decided = await request.patch(`${API}/admin/society-proposals/${id}`, {
    headers: await authHeaders(OPS),
    data: { status: 'approved' },
  });
  expect(decided.status(), await decided.text()).toBe(200);

  /* A second resident, not the author — the author would see their own link back either way, so
     proving the invite reaches *residents* needs somebody who never held it. */
  const neighbour = uniqueMobile();
  await apiLogin(neighbour, { api: API });
  await makeResident(request, neighbour, SOC_LIVE, 'D-806');
  expect(neighbour).not.toBe(author);
  await signedInAs(page, neighbour);

  const card = await gotoHub(page, SOC_LIVE);
  const join = card.getByRole('link', { name: /Join WhatsApp group/i });
  await expect(join).toBeVisible({ timeout: 15_000 });

  /* The href is the invite itself, not a redirect the page invented; and the tab it opens cannot
     reach back into this one, which for a link nobody in the group vetted is the whole point. */
  await expect(join).toHaveAttribute('href', INVITE);
  await expect(join).toHaveAttribute('target', '_blank');
  await expect(join).toHaveAttribute('rel', /noopener/);
});

test('a signed-in non-resident is told the private group exists, and the invite is nowhere on the page', async ({ page }) => {
  await signedInAsNew(page);
  const card = await gotoHub(page, SOC_LIVE);

  /* Positive anchor first: the card rendered, and rendered the teaser branch. */
  await expect(card.getByText(/residents-only WhatsApp group/i)).toBeVisible({ timeout: 20_000 });
  await expect(card.getByRole('button', { name: 'Verify you live here to join' })).toBeVisible();

  await expect(card.getByRole('link', { name: /Join WhatsApp group/i })).toHaveCount(0);

  /* Not merely un-clickable — the invite must not be in the delivered document at all, since a
     link withheld from the eye but present in the HTML is not withheld from anybody who looks. */
  expect(await page.content()).not.toContain(INVITE);
});
