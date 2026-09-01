/**
 * HTTP users provider — the live counterpart to `providers/mock/usersProvider.js`.
 *
 * Method names, argument order and return shapes mirror the mock exactly; `usersService.js` is the
 * only contract between them. Shape translation lives here rather than in a `userMapper.js` for the
 * same reason `teamProvider` and `visitProvider` fold theirs in: another module on the provider
 * critical path buys nothing when the mapping is two functions long.
 *
 * ## The console's row shape
 *
 * The page renders `{ id, name, mobile, role, city, listings, joinedAt, status, verified,
 * aadhaarVerified, flagged, flagReason, archived }`. Everything comes off the contract's `User`
 * except three translations worth naming:
 *
 * - **`archived`** is not a field on the wire. The server models it as `status === 'archived'`, and
 *   the console wants a boolean because it renders a different badge and a different row action.
 * - **`listings`** is `listingsCount`.
 * - **`aadhaarVerified`** is passed through *because the badge control needs it*. Withdrawing an
 *   Aadhaar-earned badge is a 409, and a button that can only fail is worse than one that is
 *   visibly disabled with a reason next to it.
 *
 * ## Mobiles are masked and that is not a bug
 *
 * `GET /users` returns `9XXXXX123`. The unmasked number is behind `GET /users/{id}`, which writes an
 * audit row for the reveal — so this provider does not call it and the directory does not offer it.
 * A screen that quietly fetched every row's real number would turn a search page into a bulk export,
 * which is exactly the design the server's masking asymmetry exists to prevent.
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
  aadhaarVerified: Boolean(u?.aadhaarVerified),
  flagged: Boolean(u?.flagged),
  flagReason: u?.flagReason || '',
  archived: u?.status === 'archived',
});

/**
 * One page of the directory.
 *
 * `archived` and `status` are separate query parameters because they are separate columns. The
 * console's single picker collapses them, so the translation happens here: choosing "Archived" asks
 * for `archived=true` with no status, and everything else asks for live rows with the status
 * appended. Sending "suspended" without pinning `archived=false` would return suspended accounts
 * that had *also* been archived, which reads on screen as a suspension that never took.
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
 * The activity modal.
 *
 * Returned exactly as the server sends it — `{ kind, entityId, at, label, status }` — with no
 * wording applied. The console builds each line's sentence from `kind` through its own translation
 * files, which is the whole reason the server does not send one.
 */
export async function getUserTimeline(id) {
  const rows = await get(`/users/${encodeURIComponent(id)}/timeline`);
  return Array.isArray(rows) ? rows : [];
}

/** Grant or withdraw the Verified badge. 409 when the badge was earned through Aadhaar. */
export async function setUserBadge(id, granted, reason) {
  const updated = await patch(`/users/${encodeURIComponent(id)}/badge`, { granted, reason });
  return toRow(updated);
}

/**
 * Four routes behind one control, so the caller names the action rather than the desired state.
 *
 * `'active'` would be ambiguous — it is the answer to both "un-suspend" and "un-archive" — and the
 * two are not interchangeable: reactivating an archived account is a 409 that says to restore it
 * first, because restore carries a guard reactivate does not (an email freed while the account was
 * away may since have been taken). Passing the action makes the caller state which it meant, at the
 * point where it knows.
 *
 * None of the four is documented to return a body, so the caller reloads the row.
 *
 * @param {string} id
 * @param {'suspend'|'reactivate'|'archive'|'restore'} action
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
