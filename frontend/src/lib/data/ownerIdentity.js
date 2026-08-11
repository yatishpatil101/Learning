/**
 * Owner identity for the mock — the client-side stand-in for `users.id` and `properties.owner_id`.
 *
 * ## Why an id, and not the mobile the mock used to use
 *
 * The server names every owner-scoped row by `owner_id`: opaque, immutable, issued once. A mobile
 * number is none of those things, and each difference produces a behaviour the backend does not
 * have:
 *
 *   - **mutable** — an owner who changes their number walks away from their own deals and visits,
 *     because the bucket they were stored under is derived from the old number;
 *   - **maskable** — the contact gate hands third parties `98XXXXX210`, which strips to the
 *     five-digit `98210`, so every owner sharing a first-two/last-three pattern collapses onto one
 *     bucket and can read each other's rows (D5 meeting D30);
 *   - **not unique** — a shared household number, or one re-issued by the operator, is two people.
 *
 * A mock that keys differently from its server is not a cosmetic difference: it teaches the test
 * suite a data model the backend does not have, and a suite written against it goes green on
 * behaviour the real thing would reject (D97d).
 *
 * ## Where the id comes from
 *
 * The seeded catalogue already carries real ids — `users[].id` (`U1023`) and `listings[].ownerId`
 * — and they are internally consistent, so for every demo account there is a genuine id to key on
 * and it is the same one the API would return.
 *
 * Two gaps remain, and they are answered rather than papered over:
 *
 *   1. **A session written by hand** — an e2e fixture, or a `puneNestUser` saved before this module
 *      existed — carries no id. It is resolved once, through the directory below.
 *   2. **An account registered in this browser** exists nowhere in the catalogue, and the mock has
 *      no registration server to issue it an id. So this module *is* the mock's `users` table: it
 *      mints one id per account, records it, and from then on nothing is derived from the mobile
 *      again. The mobile is a column in that table, exactly as it is on the server; the only real
 *      difference is that the id is minted on first sight rather than at sign-up.
 *
 * A masked or partial number resolves to `null` and never to a bucket — callers read nothing and
 * write nothing for an identity they cannot establish. That is the same ruling `lib/contact.js`
 * already applies to the contact-request store, applied here to the rest of the owner-scoped data.
 */
import { readUser } from '../auth.js';
import { digits, isFullMobile } from '../contact.js';
import { rawDb } from '../mockApi.js';

/** The mock's `users` table for accounts the seeded catalogue has never heard of: mobile → id. */
const DIRECTORY_KEY = 'pnMockOwnerIds';

/** Prefix for a minted id, so a locally-registered account is never mistaken for a seeded one. */
const MINTED_PREFIX = 'U-local-';

function readDirectory() {
  try {
    const v = JSON.parse(localStorage.getItem(DIRECTORY_KEY));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function writeDirectory(map) {
  try {
    localStorage.setItem(DIRECTORY_KEY, JSON.stringify(map));
  } catch { /* storage unavailable — this session still agrees with itself in memory */ }
}

/** A seeded collection, or an empty one when the catalogue has not hydrated yet. */
function catalogue(name) {
  try {
    return rawDb()?.[name] || [];
  } catch {
    return [];
  }
}

/**
 * The account id for a mobile number, minting one if this is an account nobody has seen before.
 *
 * Returns `null` for anything that is not a full ten-digit number. That is the load-bearing guard:
 * a masked number strips to a short-but-plausible digit string, and accepting it would hand two
 * different owners the same identity — which is the whole of D30.
 */
/**
 * The id already recorded for a mobile, or `null`. Never mints.
 *
 * Split out so a read that merely *sweeps* accounts cannot create them: `catalogueOwnerIds()` runs
 * on every dashboard load, and minting from there would write to storage on a pure read.
 */
function lookupOwnerId(m) {
  // The signed-in session wins for its own number. Without this, a listing row that records only an
  // `ownerMobile` resolves to a *different* id than `myOwnerId()` returns, and the owner stops
  // recognising their own listing — the failure is silent, and it looks like missing data.
  const session = readUser();
  if (session?.id && digits(session.mobile) === m) return String(session.id);

  const seeded = catalogue('users').find((u) => digits(u.mobile) === m);
  if (seeded?.id) return String(seeded.id);

  const directory = readDirectory();
  return directory[m] ? String(directory[m]) : null;
}

export function ownerIdForMobile(mobile) {
  const m = digits(mobile);
  if (!isFullMobile(m)) return null;

  const known = lookupOwnerId(m);
  if (known) return known;

  // Random rather than derived: an id computed from the mobile would carry every property of the
  // mobile back into the key, which is the bug this module exists to remove.
  const minted = MINTED_PREFIX + Math.random().toString(36).slice(2, 10);
  writeDirectory({ ...readDirectory(), [m]: minted });
  return minted;
}

/**
 * The mobile behind an account id, for display and for the one thing an id cannot do — dial it.
 *
 * View models still carry the owner's mobile, because a "call the owner" affordance needs a number;
 * only the *storage key* moved to the id.
 */
export function mobileForOwnerId(ownerId) {
  const id = String(ownerId || '');
  if (!id) return '';

  const seeded = catalogue('users').find((u) => String(u.id) === id);
  if (seeded?.mobile) return digits(seeded.mobile);

  const listing = catalogue('listings').find((p) => String(p.ownerId || '') === id);
  if (listing?.ownerMobile) return digits(listing.ownerMobile);

  const directory = readDirectory();
  const hit = Object.keys(directory).find((m) => String(directory[m]) === id);
  if (hit) return hit;

  const me = readUser();
  return me && String(me.id || '') === id ? digits(me.mobile) : '';
}

/**
 * The signed-in caller's account id — the mock's stand-in for the bearer token's subject.
 *
 * Prefers the id already on the session, so an owner who changes their mobile keeps their rows.
 * Falls back to resolving the mobile for sessions written outside `authProvider` (e2e fixtures and
 * sessions saved before ids existed).
 */
export function myOwnerId() {
  const u = readUser();
  if (!u) return null;
  if (u.id) return String(u.id);
  return ownerIdForMobile(u.mobile);
}

/** The owner id recorded on a listing row, in either the catalogue's or the seam's vocabulary. */
export function ownerIdOfProperty(property) {
  if (!property) return null;
  if (property.ownerId) return String(property.ownerId);
  return ownerIdForMobile(property.ownerMobile || property.owner?.mobile);
}

/**
 * The owner id for a listing id, from the seeded catalogue.
 *
 * `rawDb()` rather than `getProperty()`: every ownership check that needs this is on a synchronous
 * path, and the async reader models a network delay the mock does not otherwise have.
 */
export function ownerIdOfListingId(propId) {
  const id = String(propId || '');
  if (!id) return null;
  const row = catalogue('listings').find((p) => String(p.id) === id);
  return row ? ownerIdOfProperty(row) : null;
}

/** Every owner id the seeded catalogue knows about. A read — it never mints new identities. */
export function catalogueOwnerIds() {
  const out = new Set();
  catalogue('listings').forEach((p) => {
    const m = digits(p.ownerMobile);
    const id = p.ownerId ? String(p.ownerId) : (isFullMobile(m) ? lookupOwnerId(m) : null);
    if (id) out.add(id);
  });
  return [...out];
}

/**
 * A user object guaranteed to carry an account id, for `authProvider` to persist at sign-in.
 *
 * Returned rather than written so the caller keeps control of which storage tier the session lands
 * in — writing here would silently promote a tab-scoped session to a remembered one.
 */
export function withOwnerId(user) {
  if (!user || user.id) return user;
  const id = ownerIdForMobile(user.mobile);
  return id ? { ...user, id } : user;
}
