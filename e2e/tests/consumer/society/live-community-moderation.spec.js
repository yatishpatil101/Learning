import { ACTORS, expect, test } from '../../../fixtures/live.js';
import { API, apiLogin, authHeaders, signIn, signedInAsNew, uniqueMobile } from '../../../helpers/liveAuth.js';

/* Browser-only claims: the second-press UX and cross-console agreement; report rules are tested server-side. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const SOC_DUP = 'skyline-terraces-gera-aundh';
const SOC_MOD = 'skyline-woods-rohan-hadapsar';

async function shareTip(mobile, slug, body) {
  const res = await fetch(`${API}/societies/${slug}/contributions`, {
    method: 'POST',
    headers: await authHeaders(mobile),
    body: JSON.stringify({ kind: 'tip', body }),
  });
  const row = await res.json();
  expect(res.status, JSON.stringify(row)).toBe(201);
  return row.id;
}

async function gotoCommunity(page, slug) {
  await page.goto(`${BASE}/society/${slug}?tab=community`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
  return page.locator('section', { has: page.getByRole('heading', { name: /Community insights/i }) });
}

const cardFor = (feed, text) => feed.locator('div.glass.rounded-xl', { hasText: text });

/** Fill in and send the report dialog that is already open. The reason keeps its default: which
 *  code travels with a report filed through the page is `live-society-hub` L134's claim, and
 *  driving the portalled picker here would only add a way for this spec to fail for a reason that
 *  has nothing to do with moderation. */
async function fileReport(page, details) {
  const dialog = page.getByRole('dialog', { name: 'Submit report' });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.locator('textarea').fill(details);
  await dialog.getByRole('button', { name: 'Submit report', exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
}

test('the second complaint from the same person is answered, not silently swallowed', async ({ page }) => {
  const neighbour = uniqueMobile();
  await apiLogin(neighbour, { api: API });
  const body = `Buy discount water tankers, call me on this number ${Date.now().toString(36)}`;
  await shareTip(neighbour, SOC_DUP, body);

  const reporter = await signedInAsNew(page);
  expect(reporter).not.toBe(neighbour);

  const feed = await gotoCommunity(page, SOC_DUP);
  const card = cardFor(feed, body);
  await expect(card).toBeVisible({ timeout: 15_000 });

  /* First press. Its confirmation is the positive anchor for the second: without it, a dialog that
     silently failed both times would look exactly like a working duplicate guard. */
  await card.getByRole('button', { name: 'Report contribution' }).click();
  await fileReport(page, 'Advertising a paid service in the tips feed.');
  await expect(page.getByText(/our team will review it/i)).toBeVisible({ timeout: 15_000 });

  /* Second press, same reporter, same post. The person is told their complaint is already in hand
     rather than being thanked again for a report that was thrown away. */
  await card.getByRole('button', { name: 'Report contribution' }).click();
  await fileReport(page, 'Still here, still advertising.');
  await expect(page.getByText(/already reported this/i)).toBeVisible({ timeout: 15_000 });
});

test('a post removed from the reports queue is gone from the society page a neighbour is reading', async ({ page, request }) => {
  const author = uniqueMobile();
  await apiLogin(author, { api: API });
  const stamp = Date.now().toString(36);
  const offending = `Cash only, no agreement, pay me directly ${stamp}`;
  const bystander = `Guest parking is behind D-wing after 8pm ${stamp}`;
  await shareTip(author, SOC_MOD, offending);
  /* The row that must survive. "The reported post is gone" is not a claim on its own — a page that
     dropped the whole feed, or an ops action that emptied the society, would satisfy it. */
  await shareTip(author, SOC_MOD, bystander);

  const reporter = await signedInAsNew(page);
  expect(reporter).not.toBe(author);
  const feed = await gotoCommunity(page, SOC_MOD);
  await expect(cardFor(feed, offending)).toBeVisible({ timeout: 15_000 });

  const marker = `e2e-remove-${stamp}`;
  await cardFor(feed, offending).getByRole('button', { name: 'Report contribution' }).click();
  await fileReport(page, marker);
  await expect(page.getByText(/our team will review it/i)).toBeVisible({ timeout: 15_000 });

  /* The queue omits the offending text, so find the row by the reporter's note, unique to this test. */
  const ops = await page.context().browser().newContext();
  const opsPage = await ops.newPage();
  try {
    await signIn(opsPage, ACTORS.admin, { screen: 'staff', role: 'admin' });
    await opsPage.goto(`${BASE}/admin/reports?tab=society`);
    const row = opsPage.getByTestId('queue-row').filter({ hasText: marker });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(opsPage.getByRole('alert')).toContainText('Society post removed', { timeout: 20_000 });
    await expect(row.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(0, { timeout: 20_000 });
  } finally {
    await ops.close();
  }

  await page.reload();
  const after = await gotoCommunity(page, SOC_MOD);
  await expect(after.getByText(bystander)).toBeVisible({ timeout: 20_000 });
  await expect(cardFor(after, offending)).toHaveCount(0);
});
