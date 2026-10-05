import { expect, test } from '../../../fixtures/live.js';
import { API, apiLogin, authHeaders, signedInAs, signedInAsNew, uniqueMobile } from '../../../helpers/liveAuth.js';

/* The society noticeboard — events and notices — in a browser against the live API.
 *
 * Split out of the retired `community-v2.spec.js`, which seeded `dzSocietyResidents` and
 * `dzSocietyBoard` into localStorage and then read them back. That made "only a verified resident
 * may post here" a claim about a JSON blob the browser had written about itself thirty
 * milliseconds earlier: any visitor could have declared themselves a resident and the test would
 * have agreed. Residency is now the server's answer (`iAmResident` comes off
 * `getSocietyMembership`), so here the badge is earned the way a real one is — an application, and
 * an ops decision on it.
 *
 * The server rules are proved over HTTP in `tests/live-society-community.spec.js`: a stranger is
 * refused and a verified resident is not, the board reads publicly, upcoming events sort ahead of
 * notices however recent the notice, an event needs a date and a notice that sends one has it
 * dropped, and a rejected resident's badge is retracted from everything they already wrote.
 *
 * What is left is the two things only a browser answers: that a resident's post travels from the
 * dialog to the right day of the calendar, and that a non-resident is shown why they cannot post
 * rather than simply being given nothing.
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const OPS = '9000000000';
const SOC_POST = 'blue-enclave-kumar-balewadi';
const SOC_LOCKED = 'blue-avenue-saarrthi-dhanori';

/** Apply to live here, and have ops say yes — the only way to become a resident. */
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

async function gotoCommunity(page, slug) {
  await page.goto(`${BASE}/society/${slug}?tab=community`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
  return page.locator('section', { has: page.getByRole('heading', { name: 'Events & notices' }) });
}

test('a verified resident posts an event onto the day it is dated, and a notice onto the board', async ({ page, request }) => {
  const resident = uniqueMobile();
  await apiLogin(resident, { api: API });
  await makeResident(request, resident, SOC_POST, 'A-1204');
  await signedInAs(page, resident);

  const board = await gotoCommunity(page, SOC_POST);

  /* The 20th of the month on screen, and the 21st as the day that must stay empty. A dot that
     appeared on every day, or on today regardless of what was typed, is the failure this pair
     exists to catch — asserting only that *a* dot exists somewhere would miss both. */
  const now = new Date();
  const monthName = now.toLocaleString('en', { month: 'long' });
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-20`;
  const stamp = Date.now().toString(36);
  const eventTitle = `Water tank cleaning, no supply 10am-2pm ${stamp}`;
  const noticeTitle = `Diwali decoration drive this weekend ${stamp}`;

  /* Event and notice have separate dialogs, named for the button that opened them, so each
     assertion is about the right form having opened rather than "a board form opened". */
  await board.getByRole('button', { name: 'Add event', exact: true }).click();
  const evDialog = page.getByRole('dialog', { name: 'Add event' });
  await expect(evDialog).toBeVisible({ timeout: 15_000 });
  await evDialog.getByPlaceholder(/Event title/i).fill(eventTitle);
  await evDialog.locator('input[type="date"]').fill(dateStr);
  await evDialog.getByRole('button', { name: 'Post', exact: true }).click();

  const day20 = board.getByRole('button', { name: new RegExp(`^20 ${monthName}, 1 event$`) });
  await expect(day20).toBeVisible({ timeout: 15_000 });
  await expect(board.getByRole('button', { name: new RegExp(`^21 ${monthName}, \\d+ event`) })).toHaveCount(0);

  /* The day list only ever shows the selected day, so the title is read after selecting the day
     the event was dated for — which is itself the claim. */
  await day20.click();
  await expect(board.getByText(eventTitle)).toBeVisible({ timeout: 15_000 });

  await board.getByRole('button', { name: 'Add notice', exact: true }).click();
  const ntDialog = page.getByRole('dialog', { name: 'Add notice' });
  await expect(ntDialog).toBeVisible({ timeout: 15_000 });
  await ntDialog.getByPlaceholder(/Notice title/i).fill(noticeTitle);
  await ntDialog.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(board.getByText(noticeTitle)).toBeVisible({ timeout: 15_000 });

  /* Both survive a reload, so they left the device; and the notice is attributed to a resident,
     which is the whole basis on which it was allowed. */
  await page.reload();
  const after = page.locator('section', { has: page.getByRole('heading', { name: 'Events & notices' }) });
  await expect(after.getByText(noticeTitle)).toBeVisible({ timeout: 20_000 });
  await expect(after.getByRole('button', { name: new RegExp(`^20 ${monthName}, 1 event$`) })).toBeVisible();
  /* The notice's byline is one concatenated line — "By <name> · Resident · 2m ago" — so this is
     matched inside the row rather than as an exact node. It is the basis on which the post was
     allowed, so a notice attributed to a non-resident would mean the gate and the label disagree. */
  await expect(after.locator('div.glass.rounded-xl', { hasText: noticeTitle }).getByText(/· Resident/))
    .toBeVisible();
});

test('a signed-in non-resident gets no Add controls, and is told why rather than shown an empty board', async ({ page }) => {
  await signedInAsNew(page);
  const board = await gotoCommunity(page, SOC_LOCKED);

  /* The positive anchor: the section is on the page and has finished rendering. Without it the two
     absences below pass on any page where the board never mounted at all — and a board that fails
     to render is exactly the bug that would produce "no Add event button". */
  await expect(board.getByRole('heading', { name: 'Events & notices' })).toBeVisible({ timeout: 20_000 });
  await expect(board.getByText('Only verified residents & the committee can post here.')).toBeVisible();

  await expect(board.getByRole('button', { name: 'Add event', exact: true })).toHaveCount(0);
  await expect(board.getByRole('button', { name: 'Add notice', exact: true })).toHaveCount(0);
});

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

const SOC_PENDING = 'skyline-crest-godrej-pimple-saudagar';
const SOC_LIVE = 'skyline-gardens-godrej-wakad';
const INVITE = 'https://chat.whatsapp.com/E2ELiveGroupInviteAbc123';


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
