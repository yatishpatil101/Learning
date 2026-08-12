/**
 * HTTP team provider — the live counterpart to `providers/mock/teamProvider.js`.
 *
 * Method names, argument order and return shapes mirror the mock exactly; `teamService.js` is the
 * only contract between them. Shape translation lives here rather than in a `teamMapper.js`: the
 * provider registries are globbed eagerly, so both files sit on the critical path and a third one
 * would too — `visitProvider` and `savedProvider` fold their mapping in for the same reason.
 *
 * ## The wire shape
 *
 * `User` (contract) carries `{ id, name, mobile, email, role, team, status, createdAt, … }`.
 * The console's `TeamMember` carries `{ …, roleId, moduleAccess[], teams[] }`. The last three have
 * no server representation at all (D67), so they map to null/empty here and stay console-local.
 * `status` collapses `archived` onto the console's `suspended`, which is the same state under two
 * names — archive *is* the suspension, and it is the only removal the contract offers.
 *
 * ## Where this provider refuses instead of calling
 *
 * Two console affordances have no route behind them, and posting an approximation of either would
 * be the exact failure D205 exists to remove — a success message for something that did not happen.
 *
 * - **Creating a `manager`.** The contract's `Role` enum is `buyer|owner|staff|admin` and says so:
 *   "Admin RBAC labels (e.g. manager/member) are permissions, not roles, and are not modelled
 *   here." Refused with the server's own wording rather than posted and bounced.
 * - **Changing an existing account's role or team.** `PATCH /users/{id}` accepts name, email and
 *   avatar; there is no role-change route anywhere in the contract. Sending the subset it does
 *   accept would drop the role change silently, so the whole save is refused with a code the
 *   console renders in the operator's language.
 *
 * Detecting the second needs the stored record, which is why `saveTeamMember` takes `previous`.
 * A pre-flight `GET /users/{id}` was the alternative and is worse: that route is the audited
 * mobile reveal, so every save would file an access record nobody asked for.
 */
import { ApiError, get, patch, post, unwrapFullPage } from '../../http.js';
// Leaf module, no imports of its own — see its header, and D208. Deliberately not from `http.js`.
import { MAX_PAGE_SIZE } from '../../apiLimits.js';

/** The contract's `Role` values a back-office account may hold. `manager` is not one of them. */
const STAFF_ROLES = new Set(['staff', 'admin']);
const STAFF_ROLES_ONLY = 'Staff accounts may only be created with role staff or admin';

const toMember = (u, approval = null) => ({
  id: u?.id,
  name: u?.name || '',
  mobile: u?.mobile || '',
  email: u?.email || '',
  role: u?.role,
  // No server representation — see the header. Left empty rather than invented.
  roleId: null,
  moduleAccess: [],
  teams: u?.team ? [u.team] : [],
  status: u?.status === 'active' ? 'active' : 'suspended',
  createdAt: u?.createdAt || u?.joinedAt || null,
  approval,
});

/**
 * The directory read, narrowed to back-office accounts.
 *
 * `role` takes one value and `archived` is a boolean, so covering "every internal account, live and
 * suspended" is four requests rather than one. They are independent, so they go out together.
 * Buyers and owners are never fetched: this screen administers colleagues, and pulling ~40k
 * consumer rows to filter them away client-side would be a different kind of wrong answer.
 */
export async function listTeamMembers() {
  const query = { size: MAX_PAGE_SIZE };
  const pages = await Promise.all(
    ['admin', 'staff'].flatMap((role) => [false, true].map((archived) =>
      get('/users', { ...query, role, archived }).then((res) => unwrapFullPage(res, `team:${role}`)))),
  );
  return pages.flat().map((u) => toMember(u));
}

export async function saveTeamMember(member, previous = null) {
  const teamValue = member?.teams?.[0] || undefined;

  if (!member?.id) {
    if (!STAFF_ROLES.has(member?.role)) {
      throw new ApiError({ code: 'forbidden', status: 403, message: STAFF_ROLES_ONLY });
    }
    const created = await post('/users/staff', {
      name: member.name,
      mobile: member.mobile,
      email: member.email,
      role: member.role,
      team: teamValue,
    });
    return toMember(created);
  }

  // The console can edit role, team, preset role and module ticks in one modal. Only two of those
  // fields exist on the wire, and a partial PATCH would report success for the rest.
  const roleChanged = previous && previous.role !== member.role;
  const teamChanged = previous && (previous.teams?.[0] || '') !== (teamValue || '');
  if (roleChanged || teamChanged) {
    throw new ApiError({
      code: 'role_change_unsupported',
      status: 409,
      message: 'A back-office account\'s role and team cannot be changed after it is created. '
        + 'Archive this account and create a new one with the role you need.',
    });
  }

  const updated = await patch(`/users/${encodeURIComponent(member.id)}`, {
    name: member.name,
    email: member.email,
  });
  return toMember(updated, previous?.approval || null);
}

/**
 * Archive or restore. The 409 on archive is the last-administrator floor, held under an advisory
 * lock server-side, and it is passed through untouched — its message names the fix (`users:write`
 * on somebody else first), which no client-side rewording would improve on.
 *
 * Neither response is documented to carry a body, so nothing is read back; the caller reloads.
 */
export async function setTeamMemberStatus(id, status) {
  const path = `/users/${encodeURIComponent(id)}`;
  if (status === 'active') return patch(`${path}/restore`);
  return patch(`${path}/archive`, { reason: 'Suspended from the admin console' });
}

/**
 * Unpaged and oldest-first by contract, so neither is imposed here.
 *
 * The queue cannot say *who* created each account: `User` has no `createdBy` field (D206), and the
 * approval record that holds it is not projected onto any response. `createdAt` answers "since
 * when", and the screen says plainly that the other half is unavailable rather than guessing.
 */
export async function listPendingApprovals() {
  const rows = await get('/users/pending-approvals');
  return (Array.isArray(rows) ? rows : []).map((u) => toMember(u, {
    createdBy: null,
    createdByName: null,
    createdAt: u?.createdAt || null,
    approvedBy: null,
    approvedAt: null,
  }));
}

/** 403 self-approval or archived approver, 404 unknown, 409 not waiting / already approved. */
export async function approveTeamMember(id) {
  return toMember(await post(`/users/${encodeURIComponent(id)}/approve`));
}
