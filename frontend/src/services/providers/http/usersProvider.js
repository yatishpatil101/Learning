/**
 * HTTP users provider; `usersService.js` is the only contract and the two-function shape
 * translation is folded in here rather than given its own mapper module.
 */
import { get, patch, unwrapPage } from '../../http.js';

/** `status` values the contract's `GET /users` accepts. Anything else is a 422 from the server. */
const WIRE_STATUSES = new Set(['active', 'suspended', 'archived']);

const toRow = (u) => ({
  id: u?.id,
  name: u?.name || '',
  mobile: u?.mobile || '',
  email: u?.email || '',
  role: u?.role,
  city: u?.city || '',
  listings: u?.listingsCount ?? 0,
  joinedAt: u?.joinedAt || u?.createdAt || null,
  status: u?.status,
  verified: Boolean(u?.verified),
  // Drives whether the badge control is offered at all — see the header.
  identityVerified: Boolean(u?.identityVerified),
  flagged: Boolean(u?.flagged),
  flagReason: u?.flagReason || '',
  archived: u?.status === 'archived',
});

/**
 * One page of the directory. `archived` and `status` are separate query parameters because they are
 * separate columns: sending a status without pinning `archived=false` returns archived rows too.
 */
export async function listUsers({ role, status, q, page = 0, size = 20 } = {}) {
  const archived = status === 'archived';
  const res = await get('/users', {
    page,
    size,
    archived,
    role: role || undefined,
    q: q || undefined,
    status: !archived && WIRE_STATUSES.has(status) ? status : undefined,
  });
  const wrapped = unwrapPage(res, { page, size });
  return { ...wrapped, items: wrapped.items.map(toRow) };
}

/**
 * The activity modal, returned exactly as the server sends it: the console builds each line's
 * sentence from `kind` through its own translation files, which is why no wording arrives.
 */
export async function getUserTimeline(id) {
  const rows = await get(`/users/${encodeURIComponent(id)}/timeline`);
  return Array.isArray(rows) ? rows : [];
}

/** Grant or withdraw the Verified badge. 409 when the badge was earned through a reviewed case. */
export async function setUserBadge(id, granted, reason) {
  const updated = await patch(`/users/${encodeURIComponent(id)}/badge`, { granted, reason });
  return toRow(updated);
}

/**
 * @param {'suspend'|'reactivate'|'archive'|'restore'} action named, since `'active'` is ambiguous
 * @param {string} [reason] carried by suspend and archive; ignored by the other two
 */
export async function setUserStatus(id, action, reason) {
  const base = `/users/${encodeURIComponent(id)}`;
  if (action === 'archive') return patch(`${base}/archive`, { reason });
  if (action === 'suspend') return patch(`${base}/suspend`, { reason });
  if (action === 'restore') return patch(`${base}/restore`);
  return patch(`${base}/reactivate`);
}

/** Raise or lower the review flag. 422 when raising one without a reason. */
export async function setUserFlag(id, flagged, reason) {
  const updated = await patch(`/users/${encodeURIComponent(id)}/flag`, { flagged, reason });
  return toRow(updated);
}
