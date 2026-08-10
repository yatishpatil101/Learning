/**
 * Mock contact provider — the localStorage counterpart to `providers/http/contactProvider.js`.
 *
 * `lib/contact.js` buckets requests by **owner mobile**, but the service contract is keyed on
 * **listing id** (see `services/contactService.js` for why). This module is where that gap is
 * closed: it resolves the listing's owner through the property mock and keeps the storage layer
 * untouched, so the React app and the older HTML prototype still share `puneNestContactReq:<digits>`.
 *
 * It also synthesises the pieces the server would otherwise compute — the masked requester number
 * and the paged envelope — because a call site must not be able to tell which provider it is
 * talking to. Anything shaped only in the http provider is a bug that only appears in production.
 */
import { getProperty } from '../../../lib/mockApi.js';
import { ApiError } from '../../http.js';
import {
  contactStatus as _contactStatus,
  digits,
  getContactReqs,
  myMobile,
  NO_CONTACT_GATE,
  ownerVerifiedOnly,
  pendingContactCount as _pendingContactCount,
  requestContact as _requestContact,
  setContactStatus as _setContactStatus,
  viewerIsVerified,
} from '../../../lib/contact.js';

/** The server's page size default, mirrored so paging behaves identically on mocks. */
const DEFAULT_SIZE = 20;

/**
 * `98XXXXX210` — the server's mask (first two digits, then the last three). Deliberately *not*
 * `lib/contact.js`'s `maskPhone`, which renders `+91 98••• •••10` for display: the two providers
 * have to agree byte-for-byte here, because this value is asserted on in tests and, more
 * importantly, is the string a UI would show if it ever leaked into a "call" link.
 */
const maskMobile = (mobile) => {
  const d = digits(mobile);
  return d.length === 10 ? `${d.slice(0, 2)}XXXXX${d.slice(-3)}` : d;
};

/** The listing's owner mobile, or '' when the listing is unknown. */
async function ownerOf(propertyId) {
  if (!propertyId) return '';
  const p = await getProperty(propertyId);
  return p ? String(p.ownerMobile || '') : '';
}

/** Build the gate object for an already-resolved owner. */
function gateFor(ownerMobile, propertyId) {
  const status = _contactStatus(ownerMobile, propertyId);
  const verifiedContactOnly = ownerVerifiedOnly(ownerMobile);
  return {
    status,
    verifiedContactOnly,
    // An owner is never gated out of their own listing, so the badge cannot apply to them.
    verificationRequired: status !== 'owner' && verifiedContactOnly && !viewerIsVerified(),
    // D5 (global policy): the owner's raw number is never revealed to a buyer — approval unlocks
    // in-app chat, not the digits. users.hide_number is retained but no-op, so this signal is
    // constant-true, mirroring the backend ContactStatusResponse.
    ownerHidesNumber: true,
  };
}

export async function contactStatus(propertyId) {
  const owner = await ownerOf(propertyId);
  return owner ? gateFor(owner, propertyId) : NO_CONTACT_GATE;
}

export async function requestContact(propertyId) {
  const owner = await ownerOf(propertyId);
  if (!owner) {
    throw new ApiError({ code: 'not_found', status: 404, message: 'Listing not found' });
  }

  // `lib/contact.js` reports failure in-band, as a string that sits in the same value space as a
  // real status. Translate to the thrown ApiError the http provider raises, so that a caller
  // handling one provider correctly cannot be silently wrong against the other.
  const res = _requestContact(owner, propertyId);
  if (res === 'login') {
    throw new ApiError({ code: 'unauthorized', status: 401, message: 'Sign in to contact the owner' });
  }
  if (res === 'verification_required') {
    throw new ApiError({
      code: 'verification_required',
      status: 403,
      message: 'This owner only accepts verified contacts',
    });
  }
  if (res === 'unavailable') {
    throw new ApiError({
      code: 'contact_unavailable',
      status: 409,
      message: "This owner's contact is unavailable right now",
    });
  }

  return gateFor(owner, propertyId);
}

/**
 * The owner's inbox. The mock stores one flat array per owner, so paging is applied here — the
 * point is that `total` counts the whole array, not the slice, which is what makes the badge and
 * the list agree.
 */
export async function myContactRequests({ page = 0, size = DEFAULT_SIZE } = {}) {
  const mine = myMobile();
  const all = mine ? getContactReqs(mine) : [];
  const start = page * size;
  return {
    items: all.slice(start, start + size).map(toRequestView),
    total: all.length,
    page,
    size,
  };
}

export async function respondToContactRequest(reqId, status) {
  _setContactStatus(myMobile(), reqId, status);
  return { id: reqId, status };
}

export async function pendingContactCount() {
  const mine = myMobile();
  return mine ? _pendingContactCount(mine) : 0;
}

/**
 * Mock row → the server's `ContactRequest` shape.
 *
 * `contact` is present only once approved: it is the reveal itself, so emitting it alongside a
 * pending row would hand the UI the number it is supposed to be withholding and leave the gate
 * enforced by nothing but a `&&` in a template.
 */
function toRequestView(r) {
  const approved = r.status === 'approved';
  return {
    id: r.id,
    propertyId: r.propId || '',
    status: r.status,
    createdAt: new Date(r.requestedAt || Date.now()).toISOString(),
    requester: {
      name: r.buyerName || 'Buyer',
      mobile: maskMobile(r.buyerMobile),
      role: 'buyer',
    },
    ...(approved ? { contact: { name: r.buyerName || 'Buyer', mobile: digits(r.buyerMobile) } } : {}),
  };
}
