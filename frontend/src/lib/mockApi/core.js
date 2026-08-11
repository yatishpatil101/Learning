/* PuneNest mock API — shared core.
   - Seeds localStorage from the generated src/data/db.json on first run (versioned key).
   - All reads/writes go through here and return Promises (simulated latency) so the call
     sites already look like async API calls. Replace the bodies with fetch() later.
   - In dev mode, data is also persisted to JSON files on disk via the persist plugin,
     so it survives browser data clears and is shareable across browsers.
   This module holds the DB hydration/load/save primitives, the generic archive/restore
   helpers, the shared latency helper, and the current-staff lookup used across modules.
   Domain modules (./properties.js, ./team.js, …) import from here. */
import { persistSave, persistLoad, persistFlush } from '../persist.js';

export const KEY = 'puneNestDB_v5';
const LATENCY = 120;

/* D129 — `db.json` is a SEED, not the store.
   ------------------------------------------
   It was a static `import`, so 236 KB of demo rows were inlined into the entry chunk
   of every route. The register framed closing that as converting ~100 `rawLoad()`/
   `rawDb()` call sites to an async accessor, but that is not where the cost is: the
   live store is `localStorage[KEY]`, and after the first run these bytes are read by
   nothing except the five one-shot migrations below and `resetDb()`. Converting the
   call sites would have made a hundred synchronous reads async to defer a file that
   ninety-nine of them never touch.

   So the boundary is one `import()` behind `ensureMockDb()`, awaited **once at boot**
   before React renders (see main.jsx). Every accessor in the mockApi tree stays exactly
   as synchronous as it was, and stays correct, because the store is guaranteed populated
   before anything can read it. A returning visitor — storage already seeded, migrations
   already stamped — never fetches the chunk at all.

   The invariant is defended at the bottom rather than at the call sites: see `reseed()`. */
let seedDb = null;
let seedPromise = null;

/** Fetch the seed rows once. Resolves when `seedDb` is populated. */
function loadSeed() {
  if (!seedPromise) {
    seedPromise = import('../../data/db.json')
      .then((m) => { seedDb = m.default; })
      .catch((err) => {
        // A rejected promise is still truthy, so caching it would make `if (!seedPromise)`
        // false forever: one flaky chunk fetch would leave the app permanently unable to
        // seed, with no retry. Clear the cache so the next caller tries again.
        seedPromise = null;
        throw err;
      });
  }
  return seedPromise;
}

/* Called only when localStorage has no usable copy of the store.
   Returning an empty object here would be worse than failing. `mutateDb()` is
   read-then-write, so an empty read becomes an empty *write* — the store would be
   permanently blank with nothing anywhere to say why, which is exactly the silent,
   unrecoverable class of bug the societies half of D129 turned up. Nothing can be
   fetched synchronously at this point, so the honest move is to fail loudly and
   start the recovery for the next attempt. Unreachable in normal operation: the
   boot gate has already guaranteed the store exists. */
function reseed() {
  if (!seedDb) {
    loadSeed().catch(() => {});
    throw new Error(
      `[mockApi] localStorage["${KEY}"] is missing and the seed is not loaded. `
      + 'Reads must happen after `ensureMockDb()` resolves — main.jsx awaits it before '
      + 'rendering. The seed is being fetched now; reload to recover.',
    );
  }
  const fresh = structuredClone(seedDb);
  localStorage.setItem(KEY, JSON.stringify(fresh));
  return fresh;
}

export function rawLoad() {
  try {
    const v = localStorage.getItem(KEY);
    if (v) return JSON.parse(v);
  } catch {
    /* fall through to reseed */
  }
  return reseed();
}

export function rawSave(db) {
  localStorage.setItem(KEY, JSON.stringify(db));
  // Also persist to disk (debounced, dev-only)
  persistSave(KEY, db);
}

// On app start, try to hydrate localStorage from the persisted file.
// This restores data after a browser clear. Awaited by `ensureMockDb()`: fired and
// forgotten it raced the seed, and whichever landed second silently won.
async function hydrateFromDisk() {
  const existing = localStorage.getItem(KEY);
  if (existing) return; // localStorage has data, nothing to restore
  const fileData = await persistLoad(KEY);
  if (fileData) {
    localStorage.setItem(KEY, JSON.stringify(fileData));
  }
}

// Flush pending writes on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    try {
      const db = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (db) persistFlush(KEY, db);
    } catch { /* ignore */ }
  });
}

export function delay(value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY));
}

// Seed demo concierge listings for the follow-up pipeline (runs once)
function seedConciergeDemo() {
  const SEED_KEY = 'puneNest_conciergeSeeded_v1';
  if (localStorage.getItem(SEED_KEY)) return;
  const db = rawLoad();
  const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
  const demos = [
    { id: 'PRC001', title: '2 BHK Flat in Baner', type: 'Apartment', bhk: '2 BHK', bhkNum: 2, locality: 'Baner', localitySlug: 'baner', area: 950, price: 25000, deal: 'rent', owner: 'Amit Patil', ownerMobile: '9823456789', status: 'pending', postedByAdmin: true, postedByStaff: 'Administrator', pipelineStage: 'listed', claimLinkSent: true, claimLinkOpened: false, photosUploaded: false, aadhaarVerified: false, reminderCount: 0, lastReminderAt: null, createdAt: daysAgo(5), image: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=600&q=80', gallery: ['https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=600&q=80'] },
    { id: 'PRC002', title: '3 BHK Villa in Wakad', type: 'Villa', bhk: '3 BHK', bhkNum: 3, locality: 'Wakad', localitySlug: 'wakad', area: 1800, price: 45000, deal: 'rent', owner: 'Priya Sharma', ownerMobile: '9876512340', status: 'pending', postedByAdmin: true, postedByStaff: 'Administrator', pipelineStage: 'listed', claimLinkSent: true, claimLinkOpened: true, photosUploaded: false, aadhaarVerified: false, reminderCount: 1, lastReminderAt: daysAgo(2), createdAt: daysAgo(4), image: 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=600&q=80', gallery: ['https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=600&q=80'] },
    { id: 'PRC003', title: '1 BHK in Hinjawadi', type: 'Apartment', bhk: '1 BHK', bhkNum: 1, locality: 'Hinjawadi', localitySlug: 'hinjawadi', area: 650, price: 15000, deal: 'rent', owner: 'Rajesh Deshmukh', ownerMobile: '9765432100', status: 'pending', postedByAdmin: true, postedByStaff: 'Administrator', pipelineStage: 'docs_submitted', claimLinkSent: true, claimLinkOpened: true, photosUploaded: true, aadhaarVerified: false, reminderCount: 0, lastReminderAt: null, createdAt: daysAgo(3), image: 'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=600&q=80', gallery: ['https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=600&q=80'] },
    { id: 'PRC004', title: '2 BHK in Kharadi', type: 'Apartment', bhk: '2 BHK', bhkNum: 2, locality: 'Kharadi', localitySlug: 'kharadi', area: 1050, price: 85000000, deal: 'buy', owner: 'Suresh Joshi', ownerMobile: '9812345670', status: 'pending', postedByAdmin: true, postedByStaff: 'Administrator', pipelineStage: 'listed', claimLinkSent: true, claimLinkOpened: true, photosUploaded: true, aadhaarVerified: true, reminderCount: 2, lastReminderAt: daysAgo(1), createdAt: daysAgo(6), image: 'https://images.unsplash.com/photo-1600573472550-8090b5e0745e?w=600&q=80', gallery: ['https://images.unsplash.com/photo-1600573472550-8090b5e0745e?w=600&q=80'] },
  ];
  demos.forEach((d) => {
    d.featured = false; d.views = 0; d.enquiries = 0; d.real = true; d.amenities = []; d.ownerVerified = false; d.ownershipVerified = false; d.docsCount = d.docsCount || 0;
  });
  db.listings.unshift(...demos);
  rawSave(db);
  localStorage.setItem(SEED_KEY, '1');
}

// Seed flatmates data for the admin moderation page (runs once)
function seedFlatmatesDemo() {
  const SEED_KEY = 'puneNest_flatmatesSeeded_v1';
  if (localStorage.getItem(SEED_KEY)) return;
  const db = rawLoad();
  if (!db.flatmateSeekers || db.flatmateSeekers.length === 0) {
    db.flatmateSeekers = seedDb.flatmateSeekers || [];
    db.flatmateGroups = seedDb.flatmateGroups || [];
    db.groupApplications = seedDb.groupApplications || [];
    rawSave(db);
  }
  localStorage.setItem(SEED_KEY, '1');
}

// One-time refresh of the FAQ content: the original seed shipped with mojibake
// (double-encoded — / ₹) and was split by topic. Overwrite the cached copy once
// so existing browsers pick up the corrected, expanded list.
// ponytail: blanket overwrite; wipes admin FAQ edits made before this ran — fine
// for a prototype, revisit if FAQs become genuinely admin-managed in prod.
function refreshFaqsV2() {
  const SEED_KEY = 'puneNest_faqsSeed_v2';
  if (localStorage.getItem(SEED_KEY)) return;
  const db = rawLoad();
  db.faqs = structuredClone(seedDb.faqs);
  rawSave(db);
  localStorage.setItem(SEED_KEY, '1');
}

// Inject the admin-controlled Move-in Pack config into existing localStorage DBs
// that predate it, so the Services "coming soon" section and the admin Fees panel
// have prices to read/edit. Runs once; touches only settings.movePack.
function seedMovePackV1() {
  const SEED_KEY = 'puneNest_movePackSeed_v1';
  if (localStorage.getItem(SEED_KEY)) return;
  const db = rawLoad();
  if (!db.settings.movePack) {
    db.settings.movePack = structuredClone(seedDb.settings.movePack);
    rawSave(db);
  }
  localStorage.setItem(SEED_KEY, '1');
}

// Inject the dedicated Home Loans team's loan officers into existing localStorage
// DBs that predate the team, so admin auto-assignment and the assign dropdown have
// loan staff for new loan tickets. Runs once; only adds missing loans-team staff.
function seedLoansTeamV1() {
  const SEED_KEY = 'puneNest_loansTeamSeed_v1';
  if (localStorage.getItem(SEED_KEY)) return;
  const db = rawLoad();
  db.users = db.users || [];
  const hasLoans = db.users.some((u) => u.role === 'staff' && u.team === 'loans');
  if (!hasLoans) {
    const loanStaff = (seedDb.users || []).filter((u) => u.role === 'staff' && u.team === 'loans');
    if (loanStaff.length) {
      db.users.push(...structuredClone(loanStaff));
      rawSave(db);
    }
  }
  localStorage.setItem(SEED_KEY, '1');
}

/* D129: the disk hydration and the five one-shot migrations above used to run as
   IIFEs at module scope. That made *importing* this module do the work — five
   localStorage reads and, on a cold profile, five parse/clone/write cycles over a
   236 KB seed — on the critical path of every route, whether or not the page ever
   read a row. They now run once, inside `ensureMockDb()`.

   The guard is set before the body runs, not after: each migration calls back into
   `rawLoad()`, so without that they would recurse. Ordering is unchanged (hydrate
   first, then the migrations in their original sequence), and `resetDb()` runs them
   too so a reset still lands on a DB whose one-shot keys are already stamped —
   which is what stopped the concierge demos reappearing after every reset. */
let seeded = false;
function runMigrations() {
  if (seeded) return;
  seeded = true;
  seedConciergeDemo();
  seedFlatmatesDemo();
  refreshFaqsV2();
  seedMovePackV1();
  seedLoansTeamV1();
}

/* The one-shot keys stamped by the five migrations above. Each is set unconditionally
   once its migration has run, so "all five present" is a complete proof that nothing
   in this module still needs the seed bytes. */
const ONE_SHOT_KEYS = [
  'puneNest_conciergeSeeded_v1',
  'puneNest_flatmatesSeeded_v1',
  'puneNest_faqsSeed_v2',
  'puneNest_movePackSeed_v1',
  'puneNest_loansTeamSeed_v1',
];

function seedNeeded() {
  try {
    if (!localStorage.getItem(KEY)) return true;
    return ONE_SHOT_KEYS.some((k) => !localStorage.getItem(k));
  } catch {
    return true;
  }
}

let bootPromise = null;

/**
 * Prepare the mock store. **Await this before rendering** — `main.jsx` does.
 *
 * Everything downstream (`rawLoad`, `rawDb`, `mutateDb`, and the ~100 call sites over
 * them) stays synchronous and keeps reading `localStorage[KEY]`; this is the single
 * point where the 236 KB seed can enter, and it is an `import()` so those bytes are a
 * lazy chunk rather than part of the entry.
 *
 * It resolves without fetching anything when the store is already seeded and all five
 * one-shot migrations are stamped — i.e. for every visit after the first.
 */
export function ensureMockDb() {
  if (!bootPromise) {
    bootPromise = (async () => {
      /* Both I/O legs start on this tick, before the first `await`.
         `hydrateFromDisk()` used to be awaited *first*, with the seed `import()` issued
         only afterwards. That serialises two independent fetches, and the gap between
         them is a window where the page has no request in flight — long enough for
         Playwright's `networkidle` to fire, and for anything keyed off "the page has
         settled" to observe a store that has not been written yet. It is the same class
         of bug as the fire-and-forget hydration this gate replaced, just moved: the
         store is populated a beat after everyone has been told the app is ready.

         `seedNeeded()` is a synchronous localStorage probe, so the warm path still
         decides *not* to fetch before anything is requested — a returning visitor
         downloads zero seed bytes exactly as before. */
      const seeding = seedNeeded() ? loadSeed() : null;
      await hydrateFromDisk();
      // Re-probed rather than reusing the value above: a disk restore can land between
      // the two, and only the second answer accounts for it.
      if (!seedNeeded()) return;
      await (seeding ?? loadSeed());
      runMigrations();
      rawLoad(); // guarantees localStorage[KEY] exists from here on
    })().catch((err) => {
      bootPromise = null; // never cache a rejection — the next caller retries
      throw err;
    });
  }
  return bootPromise;
}

export async function resetDb() {
  await loadSeed();
  runMigrations();
  const fresh = structuredClone(seedDb);
  rawSave(fresh);
  return delay(fresh);
}

export function rawDb() {
  return rawLoad();
}

/* Low-level escape hatch for page-specific data modules (src/lib/data/*).
   Load the mock DB, mutate the returned object, then persist with saveDb().
   Lets new feature modules read/write the same localStorage-backed store
   without every operation living in this file. */
export function saveDb(db) {
  rawSave(db);
  return db;
}

export function mutateDb(fn) {
  const db = rawLoad();
  const result = fn(db);
  rawSave(db);
  return result === undefined ? db : result;
}

// ---------------- Generic archive/restore ----------------
export function archiveRecord(collection, id, reason) {
  return mutateDb((db) => {
    const item = (db[collection] || []).find((x) => x.id === id);
    if (!item) return false;
    item.archived = true;
    item.archivedAt = new Date().toISOString();
    item.archiveReason = reason || 'Archived';
    return item;
  });
}

export function restoreRecord(collection, id, statusOverride) {
  return mutateDb((db) => {
    const item = (db[collection] || []).find((x) => x.id === id);
    if (!item) return false;
    item.archived = false;
    item.restoredAt = new Date().toISOString();
    if (statusOverride) item.status = statusOverride;
    return item;
  });
}

// ---------------- Current staff/session helper ----------------
/* Reads the signed-in user out of localStorage. Shared by staff-activity logging,
   WhatsApp template interpolation, and the audit log's author stamp. */
export function currentStaffInfo() {
  try {
    const u = JSON.parse(localStorage.getItem('puneNestUser'));
    if (u) return { name: u.name || 'Staff', mobile: u.mobile || '', role: u.role || 'staff', team: u.team || null };
  } catch { /* ignore */ }
  return { name: 'Staff', mobile: '', role: 'staff', team: null };
}
