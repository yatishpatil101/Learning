/* The demand console's own shell, against the live API — the half `live-enquiries.spec.js` does not own.
 *
 * `admin/live-enquiries.spec.js` is the authority on everything this board *guards*: that no
 * readable mobile reaches the page, that every tab masks its own contact column, that revealing one
 * is a separate request on a stricter role and lands an audit row. None of that is repeated here.
 *
 * What is here came off `admin/enquiries.spec.js`, whose docblock declared itself "keep, justified
 * (D252)" on the grounds that «every claim below is about the browser» — which tab renders, and
 * that a `<Select>` narrows an array already in hand. That is true and it is not a reason. The
 * component is the same component under either provider, so a live-config spec drives exactly the
 * same code and asserts exactly the same browser claims, over rows a server actually sent. The
 * argument was redundancy, and redundancy is what this migration is removing.
 *
 * ## The word the port could not keep
 *
 * The mock spec filtered on **New**, and that option is a mock-store word. `enquiries/constants.js`
 * says so in as many words: the server's contact requests are `pending | approved | declined`, and
 * the browser store's are `new | open | responded | closed`; the dropdown offers the union while
 * both exist. So porting the click verbatim would have selected a value no live row can hold, left
 * an empty table, and passed — the mock spec's companion assertion is that `responded` is absent,
 * and everything is absent from an empty table. That is the shape of a test that cannot fail.
 *
 * Hence `Pending`, and hence the counts below are asserted as numbers rather than as an inequality
 * alone: the seed carries 8 contact requests — 4 approved, 1 declined, 3 pending — so the filtered
 * set is provably *smaller than* the unfiltered one and provably *not empty*, which is the only
 * shape in which a filter assertion means anything (a one-row table makes any filter look correct,
 * and Spring ignores a query param it does not recognise rather than refusing it).
 */
import { test, expect } from '../../fixtures/live.js';

/** `AdminEnquiries.jsx` renders the post-filter row count as "<n> shown", from `rows.length`. */
async function shown(page) {
  const text = await page.getByText(/^\d+ shown$/).innerText();
  return Number(text.match(/^(\d+)/)[1]);
}

async function openBoard(page, tab) {
  await page.goto(tab ? `/admin/enquiries?tab=${tab}` : '/admin/enquiries');
  await expect(page.getByRole('heading', { name: 'Enquiries & Deals' })).toBeVisible();
  // The first row landing is the signal that the list call answered; the heading renders before it.
  await expect(page.locator('table tbody tr').first()).toBeVisible();
}

/** The themed `<Select>` is not a native one — `selectOption` does not apply to it. */
async function pickStatus(page, label) {
  await page.locator('[aria-label="Filter by status"]').click();
  const option = page.locator('.pn-dropdown__option', { hasText: label }).first();
  await expect(option).toBeVisible();
  await option.click();
  await expect(page.locator('.pn-dropdown__option')).toHaveCount(0);
}

test('deep-linking ?tab=deals opens the Deals tab with the deal columns, not the enquiry ones', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await openBoard(page, 'deals');

  /* Asserted as a *swap* rather than as two presences. `dealCols` and `enquiryCols` share Listing
     and Status, so "Value is on screen" is satisfied by a page that rendered both tables, or by a
     deep link that silently fell back to the default tab in a build where Value happened to appear
     elsewhere. The columns that can only belong to one of the two are the evidence: Value/Closed
     for deals, Customer/Locality for enquiries. */
  const head = page.locator('table thead');
  await expect(head.getByRole('columnheader', { name: 'Value' })).toBeVisible();
  await expect(head.getByRole('columnheader', { name: 'Closed' })).toBeVisible();
  await expect(head.getByRole('columnheader', { name: 'Locality' })).toHaveCount(0);

  // And the tab control itself agrees, so a URL the router ignored cannot pass by rendering a table.
  await expect(page.getByRole('button', { name: /^Deals \(\d+\)/ })).toHaveClass(/bg-brand-teal/);

  expect(consoleErrors).toHaveLength(0);
});

test('the status filter narrows the board to the server vocabulary, and Pending is not everything', async ({ page, login }) => {
  await login.asAdmin();
  await openBoard(page);

  /* The seed's eight contact requests, stated as a number. "More than zero" would be satisfied by a
     list call that returned a single row, and a filter over one row cannot be told from no filter
     at all. */
  const before = await shown(page);
  expect(before, 'the seed carries eight contact requests; the board should be holding all of them')
    .toBe(8);

  /* The adversarial row: one the filter must drop. Named before filtering and asserted present, so
     its later absence is evidence rather than a coincidence of an empty table. `approved` is the
     largest of the three groups, so it is also the one a filter that silently widened would keep. */
  const approved = page.locator('table tbody tr').filter({ hasText: /approved/i });
  await expect(approved.first()).toBeVisible();
  const approvedRows = await approved.count();
  expect(approvedRows).toBeGreaterThan(0);

  await pickStatus(page, 'Pending');

  const after = await shown(page);
  expect(after, 'Pending must not be empty, or the absence assertions below prove nothing').toBeGreaterThan(0);
  expect(after, 'Pending must be a strict subset, or the filter is not filtering').toBeLessThan(before);
  expect(after, 'the seed carries three pending contact requests').toBe(3);

  // The positive anchor and the negative, together: three rows are on screen and none is approved.
  await expect(page.locator('table tbody tr')).toHaveCount(after);
  await expect(page.locator('table tbody tr').filter({ hasText: /approved/i })).toHaveCount(0);
  await expect(page.locator('table tbody tr').filter({ hasText: /declined/i })).toHaveCount(0);
});
