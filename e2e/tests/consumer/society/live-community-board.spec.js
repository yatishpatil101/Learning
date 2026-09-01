import { expect, test } from '../../../fixtures/live.js';
import { API, apiLogin, authHeaders, signedInAs, signedInAsNew, uniqueMobile } from '../../../helpers/liveAuth.js';

/* The society noticeboard — events and notices — in a browser against the live API.
 *
 * Split out of the retired `community-v2.spec.js`, which seeded `pnSocietyResidents` and
 * `pnSocietyBoard` into localStorage and then read them back. That made "only a verified resident
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
