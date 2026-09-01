import { test, expect } from '../../fixtures/base.js';

// Admin Enquiries & Deals Funnel — /admin/enquiries
// Guarded by RoleRoute roles=['admin'] + ModuleRoute moduleKey="enquiries".
// Source: frontend/src/pages/admin/AdminEnquiries.jsx (+ enquiries/FunnelView.jsx).
// Seeded data: 60 enquiries (13 "new"), 23 visits, 16 deals.
//
// Bucket: keep, justified (D252).
//
// Every claim below is about the browser: which tabs render, that a `<Select>` narrows an
// already-fetched array, that a URL parameter survives a tab click, that the contact column is
// masked before anyone asks. None of it is a claim about server state.
//
// That last sentence used to be justified by "the board is read-only". It is not quite read-only:
// "Responded" writes a note against the listing, and this file used to assert it by watching for a
// toast. A toast is the client congratulating itself — `noteResponded` catches its own failure and
// only then renders different words, so the green path proved the call had not thrown and nothing
// else. That test has moved to `live-enquiries.spec.js`, where the note is demanded back out of
// Postgres, and demanded back under the listing's *slug* rather than the uuid the board writes with.
// The crossing matters: those were two different histories until `NoteEntityKey`, and a moderator
// opening the listing saw an empty panel over a lead someone had already answered. This file could
// not have caught that — the mock store is keyed by whatever string it is handed, so both ids agree
// with themselves and the bug is invisible here by construction.
//
// The other facts that are the server's live in that file too: that the masking is the API's rather
// than the client's, and that the awaiting-owner tile counts the word the server actually emits.
// That second one was wrong here for as long as this file existed and this file could never have
// caught it either — the mock store hands back the vocabulary the client gave it, so `new` and
// `open` are always present in mock mode and the tile always has something to count.

/* `admin loads the Enquiries & Deals desk with tabs, KPIs and table` and
   `Funnel tab renders the conversion funnel and syncs the URL` were retired here on 2026-08-25 into
   `live-consolidation.spec.js` :212 and :244, which assert the same headings, the same four tabs
   and the same KPI strip against a real server.

   Two assertions were ported before the deletion rather than after, because the live versions did
   not carry them:

     - the `Showing 1–N of M records` footer, which is the only line on that desk that cannot be
       drawn without rows. Every other assertion in the live test is satisfied by a board whose
       tiles read zero and whose table is empty — which is what a failed list call looks like.
     - the Funnel tab reached by *clicking* rather than by navigating to `?tab=funnel`, plus
       `Total Enquiries` and `Revenue per Enquiry`. The live test used to arrive at the query
       parameter, which made `toHaveURL(/tab=funnel/)` an assertion that Playwright had navigated
       where it was told; the URL is only an output when a click produces it. */

test('deep-linking ?tab=deals opens the Deals tab with deal columns', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/enquiries?tab=deals');

  // Deal-specific column headers (Value / Closed) are unique to the deals table.
  await expect(page.getByRole('columnheader', { name: 'Value', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Closed', exact: true })).toBeVisible();
  await expect(page.getByText(/Showing 1–\d+ of \d+ records/)).toBeVisible();
});

test('status filter narrows the enquiries table', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/enquiries');

  /* The counts are read off the screen rather than written down here. They used to be `60 shown`
     and `13 shown`, which are `db.json` magnitudes — so the test failed whenever anyone added a
     seed row, and the repair was always to edit the literal, which taught nobody anything. The
     behaviour worth pinning is that the filter *narrows*: fewer rows after than before, at least
     one left, and nothing outside the chosen status leaking through. All three survive a reseed. */
  const shown = page.getByText(/\d+ shown/);
  const count = async () => Number((await shown.innerText()).match(/\d+/)[0]);

  await expect(shown).toBeVisible();
  const before = await count();
  expect(before).toBeGreaterThan(0);

  // Open the custom status dropdown and pick "New".
  await page.getByLabel('Filter by status').click();
  await page.getByRole('option', { name: 'New', exact: true }).click();

  await expect(shown).not.toHaveText(`${before} shown`);
  const after = await count();
  expect(after).toBeGreaterThan(0);
  expect(after).toBeLessThan(before);
  // No responded/closed rows leak through the "new" filter.
  await expect(page.getByText('responded', { exact: true })).toHaveCount(0);
});

/* `marking an enquiry responded writes a note on the listing` was here. It is now
   `a lead marked responded is on the case file the moderator opens` in `live-enquiries.spec.js`,
   where the note is read back out of the database under the id the console holds. See the header. */

// D25 — the board masks contact numbers under both providers. The mock provider does its own
// masking rather than serving the store's raw numbers, so this pair of tests exercises the same
// screen behaviour the live desk has, and a regression that unmasked the list would fail here
// rather than only in the (much rarer) live run.
//
/* — except that both halves of that pair are now made live, so the pair is one test rather than
   three. `the enquiries board shows masked mobile numbers` went to `live-enquiries.spec.js:30` and
   `revealing a contact replaces the mask on that row only` to :57, both asserting the same masked
   and raw patterns. The reveal test's `role="alert"` toast was ported across first — the live
   version proved the audit row existed in the database but never checked that the operator is told
   their reveal was logged, and a desk that records silently lets staff unmask numbers without ever
   being shown that a trail exists.

   `unauthenticated visitor is redirected to staff-login` went to `live-enquiries.spec.js:202`
   unchanged. `a buyer cannot open the admin enquiries desk` had no live counterpart at all — the
   live file covered only the signed-out case — so it moved rather than being deleted. */
