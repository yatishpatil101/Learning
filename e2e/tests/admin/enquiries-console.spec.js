/* Seed has 4 approved, 1 declined, 3 pending: the filtered set is smaller than the full set and non-empty. */
import { test, expect } from '../../fixtures/live.js';

const rows = (page) => page.getByTestId('queue-row');

/** The pager reads "1–10 of N"; N is the post-filter row count. */
async function shown(page) {
  const text = await page.getByTestId('queue-range').first().innerText();
  return Number(text.match(/of (\d+)$/)[1]);
}

async function openBoard(page, tab) {
  await page.goto(tab ? `/admin/enquiries?tab=${tab}` : '/admin/enquiries');
  await expect(page.getByRole('heading', { name: 'Enquiries & Deals' })).toBeVisible();
  // The first row landing is the signal that the list call answered; the heading renders before it.
  await expect(rows(page).first()).toBeVisible();
}

async function pickStatus(page, label) {
  const chip = page.getByRole('group', { name: 'Status' }).getByRole('button', { name: new RegExp(`^${label} \\d`) });
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
}

test('deep-linking ?tab=deals opens the Deals tab with deal rows, not enquiry ones', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await openBoard(page, 'deals');

  /* Asserted as a *swap*: deal rows read "Closed <date>" and enquiry rows "Raised <date>", and only
     the Deals tab offers the Type filter. A deep link that fell back to the default tab fails both. */
  await expect(rows(page).first()).toContainText('Closed ');
  await expect(rows(page).filter({ hasText: 'Raised ' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Type' })).toBeVisible();

  // And the tab control itself agrees, so a URL the router ignored cannot pass by rendering rows.
  await expect(page.getByRole('tab', { name: /^Deals/ })).toHaveAttribute('aria-selected', 'true');

  expect(consoleErrors).toHaveLength(0);
});

test('the status filter narrows the board to the server vocabulary, and Awaiting owner is not everything', async ({ page, login }) => {
  await login.asAdmin();
  await openBoard(page);

  /* The seed's eight contact requests as a number: "more than zero" passes on a one-row list, where a filter cannot be told from no filter. */
  const before = await shown(page);
  expect(before, 'the seed carries eight contact requests; the board should be holding all of them')
    .toBe(8);

  /* The adversarial row a filter must drop: asserted present first so its later absence is evidence, and approved is the largest group, so a widened filter would keep it. */
  const approved = rows(page).filter({ hasText: /approved/i });
  await expect(approved.first()).toBeVisible();
  const approvedRows = await approved.count();
  expect(approvedRows).toBeGreaterThan(0);

  await pickStatus(page, 'Awaiting owner');

  const after = await shown(page);
  expect(after, 'Pending must not be empty, or the absence assertions below prove nothing').toBeGreaterThan(0);
  expect(after, 'Pending must be a strict subset, or the filter is not filtering').toBeLessThan(before);
  expect(after, 'the seed carries three pending contact requests').toBe(3);

  // The positive anchor and the negative, together: three rows are on screen and none is approved.
  await expect(rows(page)).toHaveCount(after);
  await expect(rows(page).filter({ hasText: /approved/i })).toHaveCount(0);
  await expect(rows(page).filter({ hasText: /declined/i })).toHaveCount(0);
});
