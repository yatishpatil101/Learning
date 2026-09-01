/**
 * Mock property-verification provider — the localStorage counterpart to
 * `providers/http/propertyReviewProvider.js`.
 *
 * Storage stays where it is (`db.propertyReviews` via `lib/data/properties-admin.js`), so the demo
 * desk and its seeded history keep working. What this adds is the provider *shape*: the same six
 * operations in the same argument order, returning the same view model the http mapper produces —
 * **and failing the same way**, which is the half a mock usually gets wrong. See "Errors" below.
 *
 * ## The mock is the richer one, and shedding that richness is the point
 *
 * Three things the store holds and the wire does not, all reported here the way the server reports
 * them rather than the way the store holds them — because a mock that emits fields the live API
 * cannot is a demo that breaks on the day the domain goes live:
 *
 * 1. **Per-document status and notes.** `docs[]` is `{ id, name, status, note }` with a four-value
 *    status; the wire is `{ item, pass }`. Mapped down to the boolean (`verified` → `true`). The
 *    tick itself *does* survive — `PATCH .../verification/checklist` shipped in D218 — but the
 *    per-document **note** does not: there is no column behind it, so `setDocStatus`'s fourth
 *    argument is not reachable through this provider, and neither is the three-state
 *    pending/verified/rejected distinction. A rejected document and an un-inspected one are the
 *    same untick on the wire.
 * 2. **`in_review` and `clarification` statuses.** Both collapse to `pending` (see `toCaseFile`).
 * 3. **`title`, `locality`, `price`, `deal`** — a snapshot of the listing frozen when the case was
 *    opened. Dropped; every caller is already holding the live listing.
 *
 * ## Errors, and access: the store's tolerance is not the server's
 *
 * `lib/data/properties-admin.js` answers a missing case with `null`, accepts a blank message by
 * doing nothing and reporting success, and — the part that matters more — asks *nobody* who is
 * calling. Every one of these routes is guarded server-side: reads, messages and read-receipts by
 * `participantProperty` (owner or staff, and a stranger gets **404, not 403**, because a 403 would
 * confirm the listing exists and is under review), the queue by `PROPERTIES_READ`, and the decision
 * by `PROPERTIES_WRITE` *plus* an owner-cannot-decide-their-own check.
 *
 * All of that is reproduced here, and the guards are the reason this file is longer than the store
 * it wraps. A mock that is more permissive than production is not a harmless convenience:
 *
 * - it lets a buyer session in the demo publish a listing, because deciding also moves
 *   `properties.status`;
 * - it attributes a stranger's message to the listing **owner**, since `mySide()` resolves any
 *   non-internal session to `owner` — so the real owner opens their case file and finds
 *   correspondence with ops they never wrote;
 * - and it lets screens get built against permissive behaviour, so their forbidden and empty states
 *   are first exercised in production.
 *
 * Divergences are raised as the `ApiError` the http provider would have thrown, following
 * `mock/dealProvider.js` and `mock/contactProvider.js`.
 *
 * ## Identity
 *
 * The mock takes `from`/`who` as arguments; the server derives both from the session. So the seam
 * signature carries no side, and this provider resolves it from the logged-in role. That asymmetry
 * is the seam doing its job: it used to be possible for a screen to post the owner's reply as ops
 * by passing the wrong string.
 *
 * ## The decision writes the listing status too
 *
 * `decideReview` moves only the case file; the mock desk paired it with a separate
 * `setListingStatus` call. The server does both in one transaction, so this provider does too —
 * otherwise D218 removes the page's second call and the demo silently stops publishing approvals.
 */
import { rawDb, setListingStatus as _setListingStatus } from '../../../lib/mockApi.js';
import { readUser, isInternal } from '../../../lib/auth.js';
import { myOwnerId, ownerIdOfProperty } from '../../../lib/data/ownerIdentity.js';
import { ApiError } from '../../http.js';
import {
  getReview as _get,
  ensureReview as _ensure,
  addReviewMessage as _addMessage,
  markReviewRead as _markRead,
  decideReview as _decide,
  setDocStatus as _setDocStatus,
} from '../../../lib/data/properties-admin.js';

/* `ApiError` takes an options **object**, not positional arguments. */
const notFound = (message) => new ApiError({ code: 'not_found', status: 404, message });
const badRequest = (message) => new ApiError({ code: 'bad_request', status: 400, message });
const forbidden = (message) => new ApiError({ code: 'forbidden', status: 403, message });

/**
 * Which side of the two-sided thread the session is on, in the mock store's vocabulary.
 *
 * `isInternal` rather than a hand-written role list: it is the same predicate the rest of the app
 * uses, and it includes `manager`, which a literal `['staff','admin']` check silently posts as the
 * owner.
 */
const mySide = () => (isInternal(readUser()) ? 'admin' : 'owner');

/** Epoch millis (what the store writes) → ISO-8601 (what the wire sends). `null` stays `null`. */
const iso = (ms) => (ms ? new Date(ms).toISOString() : null);

/**
 * Store status → wire status. The store's `in_review` and `clarification` have no server-side
 * counterpart, so both read as `pending`; see `toCaseFile` for why nothing is lost.
 */
const toStatus = (s) => (s === 'approved' || s === 'rejected' ? s : 'pending');

const findListing = (propertyId) =>
  (rawDb().listings || []).find((l) => String(l.id) === String(propertyId)) || null;

/**
 * Whether the session resolves to this listing's owner. Both the participant test and the
 * owner-cannot-decide-their-own guard are this same question.
 *
 * Both helpers answer `null` when they cannot resolve an identity, and `null === null` would make
 * an anonymous session the owner of every unattributed listing — and, at the decision guard, would
 * 403 a staff member over two unknowns. Only a resolved match counts.
 */
function isOwnerOf(listing) {
  const mine = myOwnerId();
  return Boolean(mine && ownerIdOfProperty(listing) === mine);
}

/** The server's participant test: the listing's owner, or staff. */
function isParticipant(listing) {
  return isInternal(readUser()) || isOwnerOf(listing);
}

/**
 * The server's `participantProperty`, reproduced: load the listing and assert the caller is its
 * owner or staff, else 404.
 *
 * **404, not 403, and deliberately.** Telling a stranger "forbidden" confirms that the listing
 * exists and is under review. Answering 403 here would also teach a screen to render an error state
 * the live API never sends.
 */
function participantListing(propertyId) {
  const listing = findListing(propertyId);
  if (!listing || !isParticipant(listing)) throw notFound('Property not found');
  return listing;
}

/** The queue's `PROPERTIES_READ` and the decision's `PROPERTIES_WRITE`, both of which are staff. */
function staffOnly(what) {
  if (!isInternal(readUser())) throw forbidden(`Only staff can ${what}`);
}

/**
 * Store record → the same case-file view model `propertyReviewMapper.toCaseFile` builds.
 *
 * `in_review` and `clarification` are the mock's own inventions — the first set on open, the second
 * derived whenever ops posted a message — and neither exists server-side, so both read as `pending`
 * here. The fact behind `clarification` is not lost: it was always "the last message is from ops
 * and unread", which the thread still states directly.
 */
function toCaseFile(t) {
  if (!t) return null;
  const decided = t.decision || null;
  return {
    propertyId: t.propId ?? '',
    status: toStatus(t.status),
    // The store has no reviewer field at all — it never recorded who took the case. Live this is a
    // user **id**, not a display name (see the http mapper), so neither value is renderable as-is
    // and a "Reviewed by" column has to resolve it.
    reviewer: null,
    checklist: (t.docs || []).map((d) => ({ item: d.name, pass: d.status === 'verified' })),
    messages: (t.messages || []).map((m) => ({
      id: String(m.id ?? ''),
      from: m.from === 'owner' ? 'owner' : 'ops',
      body: m.text ?? '',
      at: iso(m.at),
      read: Boolean(m.read),
      // Always false here, and that is the honest answer rather than a stub. Nothing in the mock
      // store writes a staff-only message — the duplicate probe that produces them is a server-side
      // rule with no browser equivalent — so a mock case file genuinely contains none. Emitting the
      // field keeps the record shape identical to the http provider's, so a screen that branches on
      // it takes the same branch in both modes instead of reading undefined in one of them. What
      // mock mode cannot prove is the filtering itself; that is API-tested (ListingNoticesTest) and
      // is why the live e2e config exists.
      internal: false,
    })),
    // `?? null`, not `|| null`: the store writes `String(reason || '')`, so an approval with no note
    // holds `''` — which the server also returns as `''`. Collapsing it here would make the two
    // providers disagree about a value a caller may well be testing for emptiness.
    notes: decided?.reason ?? null,
    decidedAt: iso(decided?.at),
  };
}

/**
 * The case file, or `null` if this listing has never been submitted.
 *
 * A listing the caller may not see reads as `null` too, not as a throw — the server answers a
 * non-participant with 404 and the http provider collapses that 404 to `null`, because "no case
 * yet" and "not yours" are the same empty state from a screen's side. Concealment is the point of
 * the 404 and it survives here: nothing distinguishes the two.
 */
export async function getPropertyReview(propertyId) {
  const listing = findListing(propertyId);
  if (!listing || !isParticipant(listing)) return null;
  return toCaseFile(_get(propertyId));
}

/**
 * Open the case file, or return the existing one.
 *
 * `ensureReview` needs the *listing* — it seeds the checklist from the deal type and snapshots the
 * title — where the live endpoint needs only an id, because the server already has the listing. The
 * lookup happens here rather than in the seam signature so the two providers stay call-compatible.
 *
 * An unknown id throws 404 rather than answering `null`: this is a create, and the absence of the
 * thing you are creating against is an error on both sides. Only `getPropertyReview` collapses its
 * 404, because there "no case yet" is the normal answer.
 */
export async function startPropertyReview(propertyId) {
  return toCaseFile(_ensure(participantListing(propertyId)));
}

/**
 * Post to the thread.
 *
 * Both guards mirror the server and neither is inherited from the store: `MessageRequest.body` is
 * `@NotBlank`, and posting to a listing with no case file is a 404. `addReviewMessage` instead
 * returns the *unchanged* case file for a blank body, which reads as a successful send.
 */
export async function addPropertyReviewMessage(propertyId, body) {
  participantListing(propertyId);
  if (!String(body ?? '').trim()) throw badRequest('body is required');
  const t = _addMessage(propertyId, mySide(), body);
  if (!t) throw notFound('No verification review for this listing');
  return toCaseFile(t);
}

export async function markPropertyReviewRead(propertyId) {
  participantListing(propertyId);
  // `void` on both sides, so a swallowed miss here is unobservable to the caller — which is exactly
  // why the 404 has to be raised rather than shrugged off.
  if (!_markRead(propertyId, mySide())) {
    throw notFound('No verification review for this listing');
  }
}

/**
 * Tick one checklist line, or untick it.
 *
 * The wire addresses a line by its **text**; the store addresses it by a local `d_index2`-style id
 * that exists on neither side of the live API. The translation is here rather than at the call
 * sites, which is the whole reason the ids do not appear in the seam's vocabulary — a screen that
 * knew them would be a screen that only works against the mock.
 *
 * An unknown item is a 404, matching the server. That is the case that matters: the rent and buy
 * checklists share no text at all, so sending `'Encumbrance certificate'` to a rental means the
 * caller is holding the wrong checklist — and answering "ok" to a tick that landed nowhere is how
 * a reviewer signs off on a document nobody looked at.
 *
 * Both server-side guards are reproduced, and for the same reasons as `decidePropertyReview`: staff
 * only, and never on the caller's own listing. The second one is not paranoia about a demo — the
 * ticks are what the colleague who *can* approve the listing reads before deciding, so an owner who
 * could tick their own would be marking their own homework in the record somebody else relies on.
 *
 * `pass: false` writes `pending`, not `rejected`. The store's four-value status has no wire
 * counterpart and `toCaseFile` maps everything that is not `verified` to `false`, so either choice
 * round-trips identically — `pending` is chosen because "not yet inspected" is what an untick
 * actually means, and leaving `rejected` behind would let the demo show a red pill the live API can
 * never produce.
 */
export async function setPropertyReviewChecklistItem(propertyId, item, pass) {
  staffOnly('update a verification checklist');
  const listing = findListing(propertyId);
  if (!listing) throw notFound('Property not found');
  if (isOwnerOf(listing)) {
    throw forbidden('You cannot check off the verification of your own listing');
  }
  const existing = _get(propertyId);
  if (!existing) throw notFound('No verification review for this listing');
  const doc = (existing.docs || []).find((d) => d.name === item);
  if (!doc) throw notFound('No such checklist item');
  return toCaseFile(_setDocStatus(propertyId, doc.id, pass ? 'verified' : 'pending'));
}

/**
 * Approve or reject.
 *
 * Accepts the verb the wire wants (`approve`/`reject`) and translates to the adjective the store
 * writes (`approved`/`rejected`), so the two providers take the same argument. Anything else throws
 * rather than defaulting, for the reason spelled out in the http provider: the default of a two-way
 * branch on a destructive action must not be the destructive side.
 *
 * Both halves of the server's guard are here. The staff check is the load-bearing one: deciding
 * also publishes the listing, so without it any signed-in — or signed-*out* — demo session can put
 * a property live. The owner check is the server's `ForbiddenException`, and it is second because
 * an anonymous caller resolves to no owner id at all and would otherwise walk straight past it.
 *
 * The owner-facing sentence posted into the thread is composed by `decideReview`; the server
 * composes the identical text, which is why the copy did not have to move.
 */
export async function decidePropertyReview(propertyId, decision, note) {
  staffOnly('decide a verification');
  const input = String(decision ?? '').toLowerCase();
  const approve = input.startsWith('approve');
  if (!approve && !input.startsWith('reject')) {
    throw badRequest('decision must be approve or reject');
  }
  const listing = findListing(propertyId);
  if (!listing) throw notFound('Property not found');
  // Only a resolved match is a self-decision — see `isOwnerOf`.
  if (isOwnerOf(listing)) {
    throw forbidden('You cannot decide the verification of your own listing');
  }
  const status = approve ? 'approved' : 'rejected';
  const t = _decide(propertyId, status, note);
  if (!t) throw notFound('No verification review for this listing');
  _setListingStatus(propertyId, status);
  return toCaseFile(t);
}

/**
 * One queue row, shaped exactly as `propertyReviewMapper.toQueueRow` shapes the wire's.
 *
 * @param forOps `true` to count the owner's unread messages (the ops desk's badge), `false` for
 *   ops' unread messages (the owner's). Same rule from opposite ends — a message is unread to the
 *   side that did not send it — which is also what `_markRead` writes.
 */
const toQueueRow = (t, forOps) => ({
  propertyId: t.propId ?? '',
  status: toStatus(t.status),
  reviewer: null,
  unread: (t.messages || []).filter((m) => !m.read && (m.from === 'owner') === forOps).length,
  decidedAt: iso(t.decision?.at),
  updatedAt: iso(t.updatedAt),
});

/**
 * The verification queue — every case file, newest touched first, paged in memory.
 *
 * The store keys reviews by listing id in an object, so there is no ordering to inherit and the
 * sort is applied here to match the server's `ORDER BY updated_at DESC`. `total` counts the whole
 * map, not the slice, for the same reason the http provider reads `totalElements`.
 *
 * Staff-gated, because the server gates it on `PROPERTIES_READ`. Without the check any session —
 * anonymous included — pages over every case file on the platform, and the only thing standing in
 * front of it is a client-side `RoleRoute`, which is a navigation affordance, not a control.
 */
export async function listPropertyReviewQueue({ page = 0, size = 20 } = {}) {
  staffOnly('read the verification queue');
  return pageOf(Object.values(rawDb().propertyReviews || {}), { page, size }, true);
}

/**
 * The same queue narrowed to the caller's own listings (D218).
 *
 * Ungated, exactly as the server is: the filter *is* the guard, so a caller with no listings gets
 * an empty page rather than a 403. `ownerIdOfProperty` is the same resolver `isOwnerOf` uses, so a
 * session that cannot be resolved to an owner sees nothing — which is the safe direction, and the
 * one that matches a signed-out visitor server-side.
 */
export async function listMyPropertyReviews({ page = 0, size = 20 } = {}) {
  const mine = myOwnerId();
  const own = mine
    ? Object.values(rawDb().propertyReviews || {}).filter((t) => {
        const listing = findListing(t.propId);
        return listing && ownerIdOfProperty(listing) === mine;
      })
    : [];
  return pageOf(own, { page, size }, false);
}

/** Sort newest-touched-first, slice, and map — shared by both queues. */
function pageOf(rows, { page, size }, forOps) {
  const all = rows.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const start = page * size;
  return {
    items: all.slice(start, start + size).map((t) => toQueueRow(t, forOps)),
    page,
    size,
    total: all.length,
    totalPages: Math.ceil(all.length / size),
  };
}
