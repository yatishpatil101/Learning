/**
 * Mock auth provider — wraps lib/auth.js (localStorage). This is how the app is developed and
 * demoed with no backend running, so it stays the default and must remain fully functional.
 *
 * Kept method-for-method identical to `providers/http/authProvider.js` so `authService.js` is a
 * true seam and `AuthContext` never learns which side it is talking to.
 */
import {
  loginUser as _loginUser,
  logoutUser as _logoutUser,
  readUser as _readUser,
  registerUser as _registerUser,
  staffLoginUser as _staffLoginUser,
  writeUser as _writeUser,
  withPermissions,
} from '../../../lib/auth.js';
import { withOwnerId } from '../../../lib/data/ownerIdentity.js';
import { getTeamMemberByMobile } from '../../../lib/mockApi.js';
import { exportUserData as _exportLocalData } from '../../../lib/store/account.js';
import { setOwnerPrefs as _setOwnerPrefs } from '../../../lib/contact.js';

/**
 * Attach the account id the rest of the mock keys its owner-scoped data on.
 *
 * The real API issues this id and hands it back with the session; here it is resolved once, at
 * sign-in, and then carried on the session object exactly as the token's subject would be. Doing it
 * at sign-in rather than at every read is what makes the id an *identity* rather than a derived
 * value: change the account's mobile afterwards and the deals, offers and visits stay findable.
 *
 * `remember` is threaded through so re-persisting the stamped user cannot silently promote a
 * tab-scoped session into a remembered one.
 */
function stamp(user, remember = true) {
  const stamped = withOwnerId(user);
  if (stamped !== user) _writeUser(stamped, remember);
  return withPermissions(stamped);
}

/**
 * No-op OTP dispatch. The delay is intentional: it preserves the "Sending…" affordance that the
 * real network round-trip provides, so the sign-in UX is identical in both modes. Any 6 digits are
 * then accepted — this is a prototype session, not authentication.
 */
export const sendOtp = () => new Promise((resolve) => setTimeout(() => resolve({ otpSent: true }), 700));

export const login = (data) => Promise.resolve(stamp(_loginUser(data), data?.remember !== false));

/** Records the account in the local registry, then opens a session. `otp` is ignored here. */
export const register = (data) => {
  _registerUser(data);
  return Promise.resolve(stamp(_loginUser(data), data?.remember !== false));
};

/**
 * Open an internal session, resolving who the caller actually is.
 *
 * The identity is decided **here**, not by the screen that collected the mobile. Live, the server
 * answers `/auth/login` with the authenticated account's own role, team and permission atoms and
 * the browser has no say; the mock's counterpart of that authority is the seeded `team` registry,
 * so it is consulted here for the same reason and at the same moment. `/staff-login` used to do
 * this lookup itself, which meant a product page imported `lib/mockApi` to answer a question it
 * had no business answering in either build.
 *
 * A mobile with no seeded record falls back to whatever the caller asked for. That is a demo
 * affordance and it is confined to this file: the prototype ships no internal accounts, so
 * refusing an unknown number would leave the console unreachable in a build that has no server to
 * add one. The http provider has no such fallback, and cannot grow one — its identity arrives in a
 * token it did not mint.
 */
export const staffLogin = (data) => {
  const seeded = getTeamMemberByMobile(data?.mobile);
  const who = seeded
    ? {
      name: seeded.name,
      mobile: seeded.mobile || data.mobile,
      role: seeded.role,
      roleId: seeded.roleId,
      moduleAccess: seeded.moduleAccess,
      teams: seeded.teams || [],
    }
    : data;
  return Promise.resolve(stamp(_staffLoginUser(who)));
};

export const logout = () => Promise.resolve(_logoutUser());

export const getMe = () => Promise.resolve(withPermissions(_readUser()));

/**
 * `PATCH /auth/me`.
 *
 * The two owner privacy fields are mirrored into the per-mobile privacy registry as well as onto
 * the account. That registry is not a duplicate: the contact gate has to answer "does *this owner*
 * accept unverified buyers" for an owner who is not the person asking, and a signed-in user record
 * can only ever describe the person asking. The server reads the owner's own row for that; the mock
 * has no rows, so the registry is what stands in for one — and it only stays truthful if every
 * write to the account lands there too.
 */
export const updateMe = (body) => {
  const user = _readUser();
  if (!user) return Promise.resolve(null);
  const updated = { ...user, ...body };
  _writeUser(updated);
  const privacy = {};
  if (body?.hideNumber !== undefined) privacy.hideNumber = !!body.hideNumber;
  if (body?.verifiedContactOnly !== undefined) privacy.verifiedContactOnly = !!body.verifiedContactOnly;
  if (Object.keys(privacy).length) _setOwnerPrefs(privacy);
  return Promise.resolve(withPermissions(updated));
};

/**
 * `GET /me/data-export`.
 *
 * Shaped like the server's document rather than like the old localStorage snapshot, because the
 * panel that renders it must not have to ask which side answered. The mock has one store and no
 * counterparties, so there is nothing to redact and nothing to leave out — but it still states the
 * rule and the (empty) exclusion list, so a subject reading a demo export is told the same things a
 * real one is.
 */
export const exportMyData = () => {
  const rows = _exportLocalData();
  return Promise.resolve({
    generatedAt: rows.exportedAt,
    subjectId: _readUser()?.id || null,
    schemaVersion: 1,
    redactionRule: 'Other people appear only as an opaque reference, never by name.',
    rowLimit: 0,
    datasets: Object.entries(rows.data).map(([name, value]) => ({
      domain: 'account',
      name,
      describes: 'Saved on this device',
      rowCount: Array.isArray(value) ? value.length : 1,
      truncated: false,
      withheld: {},
      rows: Array.isArray(value) ? value : [value],
    })),
    excluded: [],
  });
};

/* The erasure queue for this browser.

   Modelled as a queue rather than an immediate wipe so the mock tells the same story the server
   does: a request is filed and waits for a decision. Wiping local storage here would let the demo
   promise something the real product deliberately does not do, and the copy on the settings screen
   is written against the reviewed behaviour. */
const ERASURE_KEY = 'pnErasureRequests';
const readErasure = () => {
  try { return JSON.parse(localStorage.getItem(ERASURE_KEY) || '[]'); } catch { return []; }
};

export const requestErasure = ({ reason } = {}) => {
  const rows = readErasure();
  const open = rows.find((r) => r.status === 'pending');
  // One open request per account, matching the server: filing a second changes nothing about the
  // first, and two rows would let the panel show a contradiction.
  if (open) return Promise.resolve(open);
  const row = {
    id: 'er_' + Date.now().toString(36),
    status: 'pending',
    reason: reason || '',
    requestedAt: new Date().toISOString(),
    decidedAt: null,
    decisionNote: '',
  };
  try { localStorage.setItem(ERASURE_KEY, JSON.stringify([row, ...rows])); } catch { /* quota */ }
  return Promise.resolve(row);
};

export const myErasureRequests = () =>
  Promise.resolve(readErasure().filter((r) => r.status !== 'approved'));
