/* Seed-coverage guard for `punenest_e2e`.
 *
 * ## The failure this exists to stop
 *
 * A live spec that reads a table the seed never filled does not fail with "the seed is thin". It
 * fails with `locator.waitFor: Timeout`, which reads as a broken selector or a product bug. On
 * 2026-08-18 a probe converted 20 consumer specs and 19 of the 92 tests failed that way; every one
 * traced back to the same cause - the e2e database had 0 commercial listings while `db.json` had
 * three - and none of the 19 messages said so. The cost of a thin seed is therefore not the gap
 * itself but that it is rediscovered, one confusing failure at a time, by whoever converts next.
 *
 * That measurement also showed the size of it: of 87 application tables, 54 were completely empty.
 *
 * ## The mirror of TestDatabaseIsolationTest
 *
 * The two databases have opposite invariants, and until now only one of them was enforced:
 *
 *   punenest_test  must be EMPTY      - guarded by TestDatabaseIsolationTest (126 exact counts)
 *   punenest_e2e   must be POPULATED  - guarded by this file
 *
 * ## Why the third state exists
 *
 * Two states (seeded / waived) would mean flipping this on turns the live suite red until all 54
 * tables are filled, so it would be switched off on day one and never switched back. `PENDING` is
 * the honest alternative: a known gap, listed by name, that warns but does not block.
 *
 * The load-bearing rule is what happens to a table in NO list: it FAILS. A new migration therefore
 * cannot add an unseeded table quietly - the next live run stops until someone either seeds it or
 * writes down why it does not need seeding. So PENDING can only ever shrink, and the 2026-08-18
 * situation - a gap nobody could see - cannot recur.
 *
 * Run standalone:  node scripts/check-seed-coverage.mjs
 * Runs automatically at the start of every live run, from global-setup.live.js.
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const PSQL = process.env.PSQL || 'C:\\Program Files\\PostgreSQL\\13\\bin\\psql.exe';
const DB = process.env.E2E_DB_NAME || 'punenest_e2e';
const USER = process.env.E2E_DB_USER || 'postgres';

/* WAIVED - a spec CREATES these rows, so seeding them would be seeding the thing under test.
 *
 * The distinction that decides this list: seed what a spec must READ, let a spec create what it
 * tests creating. A seeded row on a write path is worse than no row - it makes "the flow produced
 * this" indistinguishable from "the seed already had one", so the assertion stops falsifying
 * anything. Every entry names the flow that fills it, because a waiver with no named flow is
 * indistinguishable from an oversight. */
const WAIVED = new Map([
  ['otp_codes', 'every login writes one; a seeded code is a seeded credential'],
  ['refresh_tokens', 'issued at login, by the same flow every spec starts with'],
  ['audit_log', 'written BY the admin actions the ops specs assert on'],
  ['transactions', 'written by the payment flows; a seeded row would fake the thing under test'],
  ['outbound_message', 'the send queue - filled when a notification actually fires'],
  ['message_attachments', 'written by the chat upload spec'],
  ['erasure_requests', 'the DSR spec submits one'],
  ['city_waitlist', 'the waitlist form submits one'],
  // Caught by this guard on its first clean reset, not by inspection: the census that produced
  // these lists was taken on a database several live runs had already written to, so this table
  // looked seeded. `live-demand-signals` appends to it and asserts a delta, which is the correct
  // shape for an append-only table and also the reason it must not be seeded.
  ['demand_signals', 'append-only; `live-demand-signals` writes rows and asserts the delta'],
  ['society_leads', 'the society lead form submits one'],
  ['offer_history', 'append-only trail written when an offer changes state'],
  ['review_messages', 'written by the review-thread spec'],
  ['ticket_notes', 'written by staff inside the ticket spec'],
  ['internal_notes', 'written by staff on a listing or a user'],
  ['staff_invites', 'written by the invite flow'],
  ['staff_account_approvals', 'written by the approval flow'],
  ['document_requests', 'written when staff request a document'],
  ['finalization_requests', 'written by the finalisation flow'],
  ['tenancy_declarations', 'written by the declaration flow'],
  ['identity_verifications', 'written by the Aadhaar simulate flow'],
  ['flatmate_group_applications', 'consumer/flatmates/live-group-apply.spec.js creates one'],
  ['flatmate_requests', 'written by the flatmate request flow'],
  ['flatmate_saves', 'consumer/flatmates/live-flatmate-saves.spec.js creates every row it reads'],
  ['referrals', 'written on redemption - but referral_codes IS required, see below'],
  ['boosts', 'written when a boost is purchased'],
  ['service_orders', 'written when a service is ordered'],
  ['property_ownership_evidence', 'written by the evidence upload'],
  // The page-view stack, all four tables. `page_views` is written by the collector as any spec
  // drives a browser, so it is the ordinary append-only case. The three `page_view_daily*` tables
  // are different in kind and land here for a sharper reason: they are the OUTPUT of the hourly
  // rollup. Seeding them would not fake a fixture, it would fake the job — `PageViewRollup` would
  // have nothing left that could fail visibly, since the tables it exists to fill would already be
  // full before it ran.
  //
  // They can also be legitimately empty for a whole run: the rollup ticks a minute after startup
  // and hourly after that, so a suite that finishes quickly never sees one. `live-analytics.spec.js`
  // is written not to depend on their contents for exactly that reason, and says so.
  ['page_views', 'the collector writes one per navigation; every spec that opens a page fills it'],
  ['page_view_daily', 'output of the hourly `PageViewRollup`; seeding it would fake the job'],
  ['page_view_daily_paths', 'ditto - the per-path rollup'],
  ['page_view_daily_referrers', 'ditto - the per-channel rollup'],
  // V116. The row is derived: `ListingDuplicateProbe#reindexPhotos` writes one per photograph on
  // every create and on any edit that moves the hashes. Seeding it would be seeding the evidence
  // the duplicate arm exists to weigh - and worse than usual here, because the arm's whole history
  // is that it ran for a year against a store that could not hold another owner's row and nobody
  // noticed. A fixture that pre-fills the table would reproduce exactly that: a green suite over a
  // signal the write path never actually produced.
  ['property_photo_hashes', 'derived on write; consumer/property/live-dedup.spec.js posts the hashes that fill it'],
  // V117. Caught the same way `demand_signals` was - on a brand-new database rather than one
  // several live runs had already written to. A buyer's request IS the thing under test on both
  // sides (the owner's queue only means anything if a real request put the row there), so a
  // seeded row would make "the request reached the owner" unfalsifiable - which is the exact bug
  // the server move fixed.
  ['photo_requests', 'written by `POST /properties/{id}/photo-requests` from the property page; the owner answers it from their dashboard'],
  // V119, and caught on a brand-new database for the third time in a row - the tell is that a
  // table added by a migration is empty on a fresh reset and invisible on any database several
  // live runs have already written to. A note is owner-private by construction: the row is scoped
  // to the owner who wrote it, so a seeded one belongs to a seeded owner and proves nothing about
  // whether the writer's own note came back to the writer, which is the entire point of the table.
  ['lead_notes', 'written by the owner from their leads list; `uq_lead_notes_owner_lead` scopes the row to its author'],
  // V120 / V121, D248, and caught on a brand-new database for the fourth time running. Both are
  // write-path tables under the same rule as `lead_notes`: a seeded row belongs to a seeded
  // account, and the whole claim these features make is that what *this* person wrote comes back
  // to *this* person from a second browser. A fixture would make that unfalsifiable.
  //
  // The receipt is the sharper of the two: it is an immutable snapshot minted from the owned
  // property at the moment the owner marks the month received, so a pre-existing row would also
  // pre-empt the `409` that proves a month cannot be receipted twice.
  ['managed_property_rent_receipts', 'minted by `POST /me/managed-properties/{id}/rent-receipts` when the owner marks a month received; `live-rent-receipts.spec.js` creates its own'],
  ['recent_searches', 'written by `PUT /me/recent-searches` as a signed-in seeker searches; `live-recent-searches.spec.js` fills its own rail'],
  // V122 / D255, and caught on a brand-new database for the fifth time running - the tell is
  // unchanged: a table a migration added is empty on a fresh reset and invisible on a database
  // several live runs have already written to. A dismissal is keyed on a sha-256 of the sorted
  // member ids of a cluster the server DERIVES on demand, so a seeded row would have to guess a
  // signature over seeded properties - and every seeded property carries a null `address_key`,
  // because seed rows are raw SQL and never pass through `duplicates.reindex`. The fixture would
  // therefore key a cluster the desk cannot produce, and "the dismissed pair did not come back"
  // would be true of a pair that was never there.
  ['listing_duplicate_dismissals', 'written by `POST /admin/properties/duplicates/dismiss`; `admin/live-duplicates.spec.js` dismisses clusters it created over the wire'],
  // V128. Waived for the same reason as `recent_searches`, and one stronger one. A row here is a
  // tenant's own statement about a tenancy that happened entirely off the platform - nobody
  // verified it and nothing else in the schema corroborates it - so the only thing the wallet can
  // honestly claim is "this is what you told us". A seeded row would put a rental in front of a
  // tenant who never declared one, which is the single failure this feature must not have: the
  // figures would then read as the platform's record of the tenancy rather than the tenant's, and
  // the `wallet.selfDeclared` disclaimer would be describing something that is no longer true.
  ['tenant_rentals', 'declared by the tenant via `POST /me/rentals`; `live-tenant-finances.spec.js` adds and removes its own'],
]);

/* PENDING - a real gap. A spec must READ these, and today it cannot.
 *
 * Ordered by the product area that unblocks, because they are meant to be cleared in domain
 * batches rather than one at a time. Delete an entry the moment its rows land: an entry that is no
 * longer empty is reported as stale below, so this list cannot quietly outlive the gap. */
const PENDING = new Map([
  ['referral_codes', 'referrals: cannot redeem a code that does not exist'],
  ['banners', 'CMS: the banner surface has nothing to render'],
  ['announcements', 'CMS: ditto'],
  ['cms_services', 'CMS: the services landing reads this'],
  ['service_requests', 'ops: the whole service-request console is empty'],
  ['service_request_parties', 'ops: hangs off service_requests'],
  ['service_request_messages', 'ops: hangs off service_requests'],
  ['service_request_timeline', 'ops: hangs off service_requests'],
  ['service_request_identities', 'ops: hangs off service_requests'],
  ['tickets', 'ops: the ticket queue is empty (support_tickets is a different table and IS seeded)'],
  ['owner_kyc', 'trust: no KYC record'],
  ['documents', 'vault: the document vault is empty'],
  ['personal_documents', 'vault: ditto'],
  ['managed_properties', 'managed: the managed console is empty'],
  ['managed_property_documents', 'managed: hangs off managed_properties'],
  ['property_reviews', 'review queue: nothing queued'],
  ['property_review_checklist', 'review queue: hangs off property_reviews'],
  ['rent_agreements', 'rent: no agreement to read'],
  ['tenant_profiles', 'rent: no tenant profile'],
  ['flatmate_group_members', 'flatmates: the one seeded group has no members'],
  ['flatmate_owner_consents', 'flatmates: no consent state to read'],
  ['flatmate_reviews', 'flatmates: no reviews'],
  ['notification_preferences', 'settings: the preferences page has no stored row to read'],
  ['society_follows', 'society: no already-following state, so "unfollow" has no subject'],
  ['back_office_permissions', 'staff: empty, and the permission map seeds into `settings` instead - confirm which one the app reads before seeding'],
  ['ownership_basis', 'trust: confirm whether this is reference data that R__seed_reference_data should own'],
]);

function psql(sql) {
  return execFileSync(
    PSQL,
    ['-U', USER, '-d', DB, '-P', 'pager=off', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } },
  );
}

export function checkSeedCoverage() {
  /* n_live_tup is a planner estimate and can lag, so count for real. Cheap enough: these are
     fixture-sized tables, and it runs once per suite rather than once per spec. */
  const rows = psql(
    `select relname, (xpath('/row/c/text()', query_to_xml(
       format('select count(*) as c from public.%I', relname), false, true, '')))[1]::text::bigint as n
     from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relkind = 'r' and relname not like 'flyway%'
     order by relname;`,
  )
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name, n] = line.split('|');
      return { name, n: Number(n) };
    });

  const empty = rows.filter((r) => r.n === 0).map((r) => r.name);
  const populated = new Set(rows.filter((r) => r.n > 0).map((r) => r.name));
  const known = new Set(rows.map((r) => r.name));

  // A table in no list. This is the case the guard exists for.
  const unclassified = empty.filter((t) => !WAIVED.has(t) && !PENDING.has(t));

  // Bookkeeping: entries that have outlived their reason, so neither list rots.
  const stale = [
    ...[...PENDING.keys()].filter((t) => populated.has(t)).map((t) => `${t} (PENDING but now has rows - delete the entry)`),
    ...[...WAIVED.keys()].filter((t) => !known.has(t)).map((t) => `${t} (WAIVED but the table is gone)`),
    ...[...PENDING.keys()].filter((t) => !known.has(t)).map((t) => `${t} (PENDING but the table is gone)`),
  ];

  const stillPending = empty.filter((t) => PENDING.has(t));
  return { rows, empty, unclassified, stale, stillPending, populated: populated.size };
}

export function reportSeedCoverage({ throwOnFail = true } = {}) {
  const { rows, unclassified, stale, stillPending, populated } = checkSeedCoverage();

  console.log(
    `[seed-coverage] ${populated}/${rows.length} tables populated, ` +
      `${stillPending.length} known gaps, ${WAIVED.size} waived.`,
  );

  for (const s of stale) console.warn(`[seed-coverage] STALE: ${s}`);

  if (unclassified.length) {
    const detail = unclassified.map((t) => `  - ${t}`).join('\n');
    const message =
      `[seed-coverage] ${unclassified.length} table(s) are empty and in neither list:\n${detail}\n\n` +
      'A live spec that reads one of these fails as a timeout, not as a missing fixture, so this ' +
      'stops the run instead. Add rows to db/seed, or add the table to WAIVED in ' +
      'e2e/scripts/check-seed-coverage.mjs with the flow that fills it.';
    if (throwOnFail) throw new Error(message);
    console.error(message);
  }
  return { unclassified, stale, stillPending };
}

/* Standalone: report everything and exit non-zero only on an unclassified table.
   pathToFileURL rather than string-building the URL: on Windows an absolute path becomes
   `file:///C:/...` with three slashes, so the hand-rolled `file://${argv[1]}` comparison silently
   never matches and the script exits 0 having printed nothing - a green that means "did not run". */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { unclassified, stillPending } = reportSeedCoverage({ throwOnFail: false });
  if (stillPending.length) {
    console.log(`\nKNOWN GAPS (${stillPending.length}) - warn only:`);
    for (const t of stillPending) console.log(`  ${t.padEnd(32)} ${PENDING.get(t)}`);
  }
  process.exitCode = unclassified.length ? 1 : 0;
}
