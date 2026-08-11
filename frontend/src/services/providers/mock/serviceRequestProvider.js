/**
 * Mock service-request provider — the localStorage counterpart to
 * `providers/http/serviceRequestProvider.js`.
 *
 * Storage stays exactly where it was (`puneNestServiceReq:<mobile>` via `lib/serviceFlow.js`), so
 * the ops back-office, the co-fill invite flow and the demo history keep working unchanged. What
 * this adds is the provider *shape*: the same operations the http provider exposes, in the same
 * argument order, returning the same view models — so `ServiceTracker.jsx` can no longer tell which
 * one is active.
 *
 * ## The mock is the richer one, and that is the slice
 *
 * It stores a structured `details{}` object, a per-request document checklist, inline base64 draft
 * `dataUrl`s, `changes_requested` as a distinct status, and co-fill party requests — none of which
 * survive the contract. They are emitted here and reported empty/absent by the http provider; the
 * tracker reads `isHttpDomain('serviceRequest')` to hide the mock-only "preview a sample draft"
 * affordance. Emitting the extras from only one provider is what makes the divergence show up in the
 * parity harness instead of in a customer's confusion.
 *
 * ## Identity and co-fill routing
 *
 * The mock keys requests on a typed mobile; the server keys on the session. The service signature no
 * longer carries identity — that asymmetry is the point of the seam — so operations on a co-filled
 * request (someone else's, visible to the caller as a party) resolve the owning mobile from the id
 * via `allRequests`, preserving the mock's cross-party behavior without leaking a mobile parameter
 * back into the contract.
 */
import { readUser } from '../../../lib/auth.js';
import {
  list as _list,
  get as _get,
  create as _create,
  assign as _assign,
  addMessage as _addMessage,
  decideDraft as _decideDraft,
  markRead as _markRead,
  listForParty as _listForParty,
  allRequests as _allRequests,
} from '../../../lib/serviceFlow.js';

/** The mobile the mock store keys on — the session's, passed raw the way the tracker passed it
 *  (`serviceFlow` normalises with `digits` internally, so no stripping here). */
const myMobile = () => readUser()?.mobile || '';

/** The mobile that owns a request id — the caller's own, or a co-fill counterparty's. */
const ownerOf = (id) => _allRequests().find((r) => r.id === id)?._mobile || myMobile();

export async function listServiceRequests(typeFilter) {
  const m = myMobile();
  if (!m) return [];
  return _list(m).filter((r) => !typeFilter || r.type === typeFilter);
}

export async function getServiceRequest(id) {
  return _get(myMobile(), id) ?? _allRequests().find((r) => r.id === id) ?? null;
}

export async function createServiceRequest(data) {
  const u = readUser();
  const customer = data?.customer || { name: u?.name || 'Customer' };
  // Identity keys on the session mobile (the asymmetry the seam exists for); the form's name is
  // preserved rather than overwritten.
  return _create(myMobile(), { ...data, customer: { ...customer, mobile: myMobile() } });
}

/**
 * Record the parties' identity numbers (D151) — <strong>deliberately dropped in mock mode</strong>.
 *
 * This is not an unimplemented stub. The mock store is `localStorage`: honouring this call would
 * write an owner's and every tenant's PAN and Aadhaar to plain JSON on the origin, readable by any
 * XSS and inherited by the next person on a shared or resold device — which is exactly what the
 * wizard's `redactIdentityNumbers` was added to stop, and stopping it in one place while a provider
 * re-created it in another would be worse than never having tried.
 *
 * The consequence is honest and small: a mock-mode demo shows the desk without the numbers, and the
 * ops runbook's "ask the customer" fallback is the mock's permanent answer.
 */
export async function recordServiceRequestIdentities() {}

/**
 * The desk's queue (D173) — every request in the mock store, newest activity first.
 *
 * `allRequests()` already sweeps every `puneNestServiceReq:<mobile>` key, which is the mock's
 * equivalent of the server deriving scope from a staff role. Filtering and windowing happen here
 * because there is no server to do them, and the return shape matches the http provider's envelope
 * so the desk cannot tell which one answered.
 */
export async function listServiceRequestQueue({ type, status, page = 0, size = 20 } = {}) {
  const all = _allRequests(type).filter((r) => !status || r.status === status);
  const from = Math.max(0, page) * size;
  return { items: all.slice(from, from + size), total: all.length, page, size };
}

/** Take a request for the signed-in operator. The mock's assignment is by display name. */
export async function takeServiceRequest(id) {
  const r = _allRequests().find((x) => x.id === id);
  if (!r) return null;
  return _assign(r._mobile, id, readUser()?.name || 'Me');
}

/**
 * Read the parties' identity numbers (D151/D173) — <strong>and the mock has none to give</strong>.
 *
 * This is the read half of `recordServiceRequestIdentities`, which drops the numbers on purpose:
 * the mock store is `localStorage`, and honouring the write would put an owner's and every tenant's
 * Aadhaar into plain JSON on the origin. So the numbers were never recorded, and the honest answer
 * is rows with names and empty numbers — exactly what the contract means by a null `pan` with no
 * `purgedAt`: *the customer left that field blank*. Inventing a demo Aadhaar to make the screen look
 * finished would re-create the threat the redaction closed, in the one place nobody would look for
 * it.
 *
 * **The refusal is modelled, though, because the refusal is the design.** An unassigned request, or
 * one held by somebody else, throws with the server's own sentence rather than returning an empty
 * list — a demo where the guard silently does nothing teaches the desk the wrong thing about what
 * this screen is.
 */
export async function readServiceRequestIdentities(id) {
  const r = _allRequests().find((x) => x.id === id);
  if (!r) throw new Error('No such request.');
  const me = readUser()?.name || 'Me';
  if (!r.assignedTo) {
    throw new Error(
      'This request is not assigned to anyone yet. Take it first — identity numbers are visible '
        + 'only to the person working the matter.',
    );
  }
  if (r.assignedTo !== me) {
    throw new Error(
      'This request is assigned to somebody else. Identity numbers are visible only to the person '
        + 'working the matter.',
    );
  }
  const d = r.details || {};
  const tenants = String(d.tenants || '')
    .split(/\s*,\s*/)
    .filter(Boolean);
  const party = (partyRole, partyIndex, partyName) => ({
    partyRole, partyIndex, partyName: partyName || '', pan: '', aadhaar: '', purged: false, purgedAt: 0,
  });
  return [
    party('owner', 0, d.ownerName),
    ...tenants.map((name, i) => party('tenant', i, name)),
  ];
}

export async function addServiceRequestMessage(id, text) {
  return _addMessage(ownerOf(id), id, 'user', text);
}

export async function decideServiceRequestDraft(id, decision, note) {
  return _decideDraft(ownerOf(id), id, decision, note);
}

export async function listPartyServiceRequests(typeFilter) {
  const m = myMobile();
  if (!m) return [];
  return _listForParty(m).filter((r) => !typeFilter || r.type === typeFilter);
}

export async function markServiceRequestRead(id) {
  return _markRead(ownerOf(id), id, 'user');
}
