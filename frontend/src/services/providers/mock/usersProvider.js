/**
 * Mock users provider — the offline counterpart to `providers/http/usersProvider.js`.
 *
 * Its job is not to be a faithful database. It is to answer the same five calls with the same five
 * shapes, so `AdminUsers.jsx` can be written once against the live contract and still open in a
 * browser with no backend. Everything below therefore translates the mock's own vocabulary into the
 * server's, rather than the other way round: the page speaks contract, and this file does the
 * bending.
 *
 * ## Where it cannot be faithful, and says so
 *
 * - **The timeline joins by phone number.** `lib/mockApi/users.js` has no foreign keys, so it
 *   matches enquiries, visits and tickets on `mobile`. Two accounts sharing a handset see each
 *   other's history. The live endpoint joins on real keys and does not have this problem; the
 *   difference is left in place rather than patched, because rewriting the mock's join would be
 *   effort spent on code scheduled for deletion.
 * - **Nothing here is refused.** The server's guards are real — self-suspension is a 403,
 *   withdrawing an Aadhaar badge is a 409, a flag without a reason is a 422. None of them exist in
 *   the browser. A screen developed only against this provider will look like every action always
 *   succeeds, which is precisely the illusion this migration is removing.
 *
 * ## Paging is simulated, not implemented
 *
 * The mock returns every row and this file slices it. That is honest for a fixture of a few dozen
 * users and it keeps the return shape identical to the live one, so the page's pager works in both
 * modes rather than being a live-only branch.
 */
import {
  listUsers as mockListUsers,
  updateUser,
  getUserTimeline as mockTimeline,
} from '../../../lib/mockApi/users.js';
import { archiveRecord, restoreRecord } from '../../../lib/mockApi/core.js';

const toRow = (u) => ({
  id: u?.id,
  name: u?.name || '',
  mobile: u?.mobile || '',
  email: u?.email || '',
  role: u?.role,
  city: u?.city || '',
  listings: u?.listings ?? u?.listingsCount ?? 0,
  joinedAt: u?.joinedAt || null,
  status: u?.archived ? 'archived' : u?.status || 'active',
  verified: Boolean(u?.verified),
  aadhaarVerified: Boolean(u?.aadhaarVerified),
  flagged: Boolean(u?.flagged),
  flagReason: u?.flagReason || '',
  archived: Boolean(u?.archived),
});

export async function listUsers({ role, status, q, page = 0, size = 20 } = {}) {
  const all = (await mockListUsers(role || undefined, { includeArchived: true })).map(toRow);
  const needle = (q || '').trim().toLowerCase();
  const matches = all.filter((u) => {
    if (status === 'archived' ? !u.archived : u.archived) return false;
    if (status && status !== 'archived' && u.status !== status) return false;
    if (!needle) return true;
    return `${u.name} ${u.mobile} ${u.email}`.toLowerCase().includes(needle);
  });
  const from = page * size;
  return {
    items: matches.slice(from, from + size),
    total: matches.length,
    page,
    size,
    totalPages: Math.max(1, Math.ceil(matches.length / size)),
  };
}

/**
 * Reshaped into the wire's `{ kind, entityId, at, label, status }`.
 *
 * The mock emits a pre-worded English `action` and a `detail`; the server deliberately emits
 * neither, because the console is translated. Dropping them here rather than letting the page read
 * them is what stops the mock's wording quietly becoming the page's only wording.
 *
 * `note` has no live equivalent — internal notes are their own feature and are not part of the
 * union — so it is mapped onto `moderation`, which is the kind the live timeline uses for things a
 * colleague did rather than the account holder.
 */
export async function getUserTimeline(id) {
  const entries = await mockTimeline(id);
  return (entries || []).map((e) => ({
    kind: e.type === 'note' ? 'moderation' : e.type,
    entityId: e.meta?.listingId || e.id,
    at: e.at,
    label: e.detail || e.action || '',
    status: e.meta?.status,
  }));
}

export async function setUserBadge(id, granted) {
  return toRow(await updateUser(id, { verified: granted }));
}

export async function setUserStatus(id, action, reason) {
  if (action === 'archive') return archiveRecord('users', id, reason);
  if (action === 'restore') return restoreRecord('users', id, 'active');
  return updateUser(id, { status: action === 'suspend' ? 'suspended' : 'active' });
}

export async function setUserFlag(id, flagged, reason) {
  return toRow(await updateUser(id, { flagged, flagReason: flagged ? reason : '' }));
}
