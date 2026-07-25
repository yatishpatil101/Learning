/* PuneNest mock API — shared core.
   - Seeds localStorage from the generated src/data/db.json on first run (versioned key).
   - All reads/writes go through here and return Promises (simulated latency) so the call
     sites already look like async API calls. Replace the bodies with fetch() later.
   - In dev mode, data is also persisted to JSON files on disk via the persist plugin,
     so it survives browser data clears and is shareable across browsers.
   This module holds the DB hydration/load/save primitives, the generic archive/restore
   helpers, the shared latency helper, and the current-staff lookup used across modules.
   Domain modules (./properties.js, ./team.js, …) import from here. */
import seedDb from '../../data/db.json';
import { persistSave, persistLoad, persistFlush } from '../persist.js';

export const KEY = 'puneNestDB_v5';
const LATENCY = 120;
let _hydrated = false;

export function rawLoad() {
  try {
    const v = localStorage.getItem(KEY);
    if (v) return JSON.parse(v);
  } catch {
    /* fall through to reseed */
  }
  const fresh = structuredClone(seedDb);
  localStorage.setItem(KEY, JSON.stringify(fresh));
  return fresh;
}

export function rawSave(db) {
  localStorage.setItem(KEY, JSON.stringify(db));
  // Also persist to disk (debounced, dev-only)
  persistSave(KEY, db);
}

// On app start, try to hydrate localStorage from the persisted file.
// This restores data after a browser clear.
(async () => {
  if (_hydrated) return;
  _hydrated = true;
  const existing = localStorage.getItem(KEY);
  if (existing) return; // localStorage has data, nothing to restore
  const fileData = await persistLoad(KEY);
  if (fileData) {
    localStorage.setItem(KEY, JSON.stringify(fileData));
  }
})();

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
(function seedConciergeDemo() {
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
})();

// Seed flatmates data for the admin moderation page (runs once)
(function seedFlatmatesDemo() {
  const SEED_KEY = 'puneNest_flatmatesSeeded_v1';
  if (localStorage.getItem(SEED_KEY)) return;
  const db = rawLoad();
  if (!db.shareSeekers || db.shareSeekers.length === 0) {
    db.shareSeekers = seedDb.shareSeekers || [];
    db.shareGroups = seedDb.shareGroups || [];
    db.groupApplications = seedDb.groupApplications || [];
    rawSave(db);
  }
  localStorage.setItem(SEED_KEY, '1');
})();

// One-time refresh of the FAQ content: the original seed shipped with mojibake
// (double-encoded — / ₹) and was split by topic. Overwrite the cached copy once
// so existing browsers pick up the corrected, expanded list.
// ponytail: blanket overwrite; wipes admin FAQ edits made before this ran — fine
// for a prototype, revisit if FAQs become genuinely admin-managed in prod.
(function refreshFaqsV2() {
  const SEED_KEY = 'puneNest_faqsSeed_v2';
  if (localStorage.getItem(SEED_KEY)) return;
  const db = rawLoad();
  db.faqs = structuredClone(seedDb.faqs);
  rawSave(db);
  localStorage.setItem(SEED_KEY, '1');
})();

// Inject the admin-controlled Move-in Pack config into existing localStorage DBs
// that predate it, so the Services "coming soon" section and the admin Fees panel
// have prices to read/edit. Runs once; touches only settings.movePack.
(function seedMovePackV1() {
  const SEED_KEY = 'puneNest_movePackSeed_v1';
  if (localStorage.getItem(SEED_KEY)) return;
  const db = rawLoad();
  if (!db.settings.movePack) {
    db.settings.movePack = structuredClone(seedDb.settings.movePack);
    rawSave(db);
  }
  localStorage.setItem(SEED_KEY, '1');
})();

// Inject the dedicated Home Loans team's loan officers into existing localStorage
// DBs that predate the team, so admin auto-assignment and the assign dropdown have
// loan staff for new loan tickets. Runs once; only adds missing loans-team staff.
(function seedLoansTeamV1() {
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
})();

export function resetDb() {
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
