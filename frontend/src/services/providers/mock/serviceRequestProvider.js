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
  update as _update,
  createCoFill as _createCoFill,
  pendingInvites as _pendingInvites,
  declineInvite as _declineInvite,
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

export async function createCoFillServiceRequest({ request, role, mobile }) {
  const u = readUser();
  const ownerMobile = myMobile();
  const details = request?.details || {};
  const fromName = request?.customer?.name || u?.name || 'Owner';
  const created = _createCoFill(ownerMobile, {
    type: request?.type || 'rental',
    service: request?.service || 'Rent Agreement',
    customer: { name: fromName },
    details,
    initiatorRole: 'owner',
    initiatorName: fromName,
    invite: {
      toMobile: mobile,
      toRole: role || 'tenant',
      fromName,
      fromRole: 'owner',
      sections: [role || 'tenant'],
    },
  });
  return created?.req || null;
}

export async function listMyServiceRequestInvites() {
  return _pendingInvites(myMobile()).map((inv) => ({
    id: inv.inviteId,
    requestId: inv.reqId,
    requestType: 'rental',
    role: inv.toRole,
    status: inv.status === 'pending' ? 'invited' : inv.status,
    invitedBy: inv.fromName,
    createdAt: new Date(inv.createdAt || Date.now()).toISOString(),
  }));
}

export async function decideServiceRequestInvite(partyId, decision) {
  if (decision === 'decline') {
    _declineInvite(myMobile(), partyId);
    return { id: partyId, status: 'declined' };
  }
  return { id: partyId, status: 'accepted' };
}

export async function submitServiceRequestPartyDetails(id, details) {
  const owner = ownerOf(id);
  const current = _get(owner, id) || {};
  _update(owner, id, { details: { ...(current.details || {}), ...(details || {}) } });
  return getServiceRequest(id);
}

export async function openServiceRequestCheckout(id) {
  return getServiceRequest(id);
}

/**
 * Withdraw an unanswered invitation — <strong>a no-op read in mock mode</strong>.
 *
 * The mock's invite lives in the *invitee's* `localStorage`, not the requester's, so the requester's
 * browser has nothing to withdraw: the row it would delete is in a storage key it cannot reach. That
 * is the same one-browser limit that made the whole co-fill flow a live-only feature, so this
 * reports the request unchanged rather than pretending. The live provider deletes the party row and
 * frees the role.
 */
export async function withdrawServiceRequestParty(id) {
  return getServiceRequest(id);
}

export async function addServiceRequestDoc(id, doc) {
  const owner = ownerOf(id);
  const current = _get(owner, id) || {};
  const docs = Array.isArray(current.docs) ? current.docs.slice() : [];
  if (doc?.fileName) {
    docs.push({
      id: `d_${Date.now()}`,
      name: doc.fileName,
      status: 'submitted',
      file: {
        fileName: doc.fileName,
        dataUrl: doc.dataUrl || null,
        mime: doc.mime || 'application/octet-stream',
      },
    });
  }
  _update(owner, id, { docs });
  return getServiceRequest(id);
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

/* ── The drafting desk's three operations are deliberately absent (D184) ──────────────────────
 *
 * `listServiceRequestQueue`, `takeServiceRequest` and `readServiceRequestIdentities` used to live
 * here, backed by `allRequests()`. They were removed rather than repaired.
 *
 * The queue read was the problem. The desk's status filter sends `?status=` in the server's
 * vocabulary — `ServiceRequestStatus`: `awaiting-payment`, `new`, `assigned`, `in-progress`,
 * `draft-shared`, `changes-requested`, `approved`, `completed`, `cancelled` — while these rows
 * carry the stepper's (`docs_review`, `changes_requested`, …). So most filters matched nothing and
 * the desk looked idle when it was not, which is the worst possible failure for a work queue.
 *
 * The obvious patch — a mapping between the two vocabularies — was rejected on purpose. It exists
 * only to make a demo look right, it is a second vocabulary to keep in sync, and it makes the
 * server's own list the *third* place to edit whenever a status is added. The two vocabularies
 * exist because the demo workflow and the contract genuinely model different things; the fix is to
 * stop dual-running the surface, not to translate between them.
 *
 * `OpsDraftingDesk.jsx` gates itself on `isHttpDomain('serviceRequest')` and says plainly that it
 * needs the live API, so nothing calls these and no `getLoader` throw can be reached. Everything
 * else in this file — the customer-facing tracker, the co-fill flow, the demo history — still runs
 * on the mock and is unaffected; the ops back-office keeps `OpsServiceQueue`, which is written
 * against the stepper's vocabulary and is correct in it.
 */

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
