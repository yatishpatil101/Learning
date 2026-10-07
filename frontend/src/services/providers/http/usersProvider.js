import { get, patch, post, unwrapPage } from '../../http.js';

/** `status` values the contract's `GET /users` accepts. Anything else is a 422 from the server. */
const WIRE_STATUSES = new Set(['active', 'suspended', 'archived']);
const BADGE_GRANTS_PATH = '/admin/badge-grants';

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
  badgeSource: u?.badgeSource || null,
  flagged: Boolean(u?.flagged),
  flagReason: u?.flagReason || '',
  archived: u?.status === 'archived',
});

const toBadgeGrant = (row) => ({
  id: row?.id,
  userId: row?.userId,
  userName: row?.userName || '',
  userMobile: row?.userMobile || '',
  requestedBy: row?.requestedBy,
  requestedByName: row?.requestedByName || '',
  reason: row?.reason || '',
  status: row?.status || 'pending',
  decidedBy: row?.decidedBy,
  decidedByName: row?.decidedByName || '',
  decidedAt: row?.decidedAt || null,
  decisionNote: row?.decisionNote || '',
  createdAt: row?.createdAt || null,
});

/** One page of the directory. `archived` and `status` are separate query parameters because they are separate
 * columns: sending a status without pinning `archived=false` returns archived rows too. */
export async function listUsers({ role, customers, status, q, page = 0, size = 20, counts } = {}) {
  const archived = status === 'archived';
  const res = await get('/users', {
    page,
    size,
    archived,
    role: role || undefined,
    customers: customers || undefined,
    q: q || undefined,
    status: !archived && WIRE_STATUSES.has(status) ? status : undefined,
    counts: counts || undefined,
  });
  const wrapped = unwrapPage(res, { page, size });
  return { ...wrapped, counts: res?.counts, items: wrapped.items.map(toRow) };
}

/** The activity modal, returned exactly as the server sends it: the console builds each line's sentence from `kind`
 * through its own translation files, which is why no wording arrives. */
export async function getUserTimeline(id) {
  const rows = await get(`/users/${encodeURIComponent(id)}/timeline`);
  return Array.isArray(rows) ? rows : [];
}

/** Request a badge grant, or withdraw a hand-granted badge. */
export async function setUserBadge(id, granted, reason) {
  const { data, status } = await patch(`/users/${encodeURIComponent(id)}/badge`, { granted, reason }, { withStatus: true });
  return status === 202
    ? { pending: true, request: toBadgeGrant(data) }
    : { pending: false, user: toRow(data) };
}

export async function listBadgeGrants({ status = 'pending', page = 0, size = 50 } = {}) {
  const res = await get(BADGE_GRANTS_PATH, { status, page, size });
  const wrapped = unwrapPage(res, { page, size });
  return { ...wrapped, items: wrapped.items.map(toBadgeGrant) };
}

export async function approveBadgeGrant(id, note) {
  return toBadgeGrant(await post(`${BADGE_GRANTS_PATH}/${encodeURIComponent(id)}/approve`, { note }));
}

export async function rejectBadgeGrant(id, reason) {
  return toBadgeGrant(await post(`${BADGE_GRANTS_PATH}/${encodeURIComponent(id)}/reject`, { reason }));
}

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
