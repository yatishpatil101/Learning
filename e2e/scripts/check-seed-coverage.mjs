// Fail unclassified empty tables so live specs never mistake missing fixtures for product failures.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const PSQL = process.env.PSQL || 'C:\\Program Files\\PostgreSQL\\13\\bin\\psql.exe';
const DB = process.env.E2E_DB_NAME || 'draazy_e2e';
const USER = process.env.E2E_DB_USER || 'postgres';

// Waive write-path tables: a seeded row would make the creation assertion unfalsifiable.
const WAIVED = new Map([
  ['otp_codes', 'every login writes one; a seeded code is a seeded credential'],
  ['refresh_tokens', 'issued at login, by the same flow every spec starts with'],
  ['audit_log', 'written BY the admin actions the ops specs assert on'],
  ['transactions', 'written by the payment flows; a seeded row would fake the thing under test'],
  ['outbound_message', 'the send queue - filled when a notification actually fires'],
  ['message_attachments', 'written by the chat upload spec'],
  ['erasure_requests', 'the DSR spec submits one'],
  ['city_waitlist', 'the waitlist form submits one'],
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
  // Rollup outputs may remain empty during a short suite; seeding them would fake the job's result.
  ['page_views', 'the collector writes one per navigation; every spec that opens a page fills it'],
  ['page_view_daily', 'output of the hourly `PageViewRollup`; seeding it would fake the job'],
  ['page_view_daily_paths', 'ditto - the per-path rollup'],
  ['page_view_daily_referrers', 'ditto - the per-channel rollup'],
  ['property_photo_hashes', 'derived on write; consumer/property/live-dedup.spec.js posts the hashes that fill it'],
  ['photo_requests', 'written by `POST /properties/{id}/photo-requests` from the property page; the owner answers it from their dashboard'],
  ['lead_notes', 'written by the owner from their leads list; `uq_lead_notes_owner_lead` scopes the row to its author'],
  ['managed_property_rent_receipts', 'minted by `POST /me/managed-properties/{id}/rent-receipts` when the owner marks a month received; `live-rent-receipts.spec.js` creates its own'],
  ['recent_searches', 'written by `PUT /me/recent-searches` as a signed-in seeker searches; `live-recent-searches.spec.js` fills its own rail'],
  ['listing_duplicate_dismissals', 'written by `POST /admin/properties/duplicates/dismiss`; `admin/live-duplicates.spec.js` dismisses clusters it created over the wire'],
  ['tenant_rentals', 'declared by the tenant via `POST /me/rentals`; `live-tenant-finances.spec.js` adds and removes its own'],
]);

// Pending tables need read fixtures; populated entries are reported stale.
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
  ['notification_preferences', 'settings: the preferences page has no stored row to read'],
  ['society_follows', 'society: no already-following state, so "unfollow" has no subject'],
  ['back_office_permissions', 'staff: empty, and the permission map seeds into `settings` instead - confirm which one the app reads before seeding'],
  ['ownership_basis', 'trust: confirm whether this is reference data that R__DML_seed_reference_data should own'],
]);

function psql(sql) {
  return execFileSync(
    PSQL,
    ['-U', USER, '-d', DB, '-P', 'pager=off', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } },
  );
}

export function checkSeedCoverage() {
  // Statistics can lag, so the once-per-suite guard counts rows directly.
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

  const unclassified = empty.filter((t) => !WAIVED.has(t) && !PENDING.has(t));

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

// `pathToFileURL` keeps the standalone guard valid for Windows absolute paths.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { unclassified, stillPending } = reportSeedCoverage({ throwOnFail: false });
  if (stillPending.length) {
    console.log(`\nKNOWN GAPS (${stillPending.length}) - warn only:`);
    for (const t of stillPending) console.log(`  ${t.padEnd(32)} ${PENDING.get(t)}`);
  }
  process.exitCode = unclassified.length ? 1 : 0;
}
