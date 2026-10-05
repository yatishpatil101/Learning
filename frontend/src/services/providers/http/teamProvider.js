/* Shape translation stays inline because this provider is the only caller. */
import { ApiError, get, patch, post, unwrapFullPage } from '../../http.js';
import { MAX_PAGE_SIZE } from '../../apiLimits.js';
import { getMemberPermissions } from './permissionsProvider.js';

const STAFF_ROLES = new Set(['staff', 'manager']);
const STAFF_ROLES_ONLY = 'Team members may only be created with role staff or manager';

const toMember = (u) => ({
  id: u?.id,
  name: u?.name || '',
  mobile: u?.mobile || '',
  email: u?.email || '',
  role: u?.role,
  // No server representation — see the header. Left empty rather than invented.
  roleId: null,
  moduleAccess: [],
  functions: [],
  status: u?.status === 'active' ? 'active' : 'suspended',
  createdAt: u?.createdAt || u?.joinedAt || null,
});

/* Team screens administer colleagues only, so buyer/owner accounts are never fetched. */
export async function listTeamMembers() {
  const query = { size: MAX_PAGE_SIZE };
  const pages = await Promise.all(
    ['admin', 'manager', 'staff'].flatMap((role) => [false, true].map((archived) =>
      get('/users', { ...query, role, archived })
        .then((res) => unwrapFullPage(res, `team:${role}`)))),
  );
  const members = pages.flat().map((u) => toMember(u));
  return Promise.all(members.map(async (member) => {
    if (member.role === 'admin') return member;
    try {
      const doc = await getMemberPermissions(member.id);
      return { ...member, functions: doc.functions || doc.permissions || [] };
    } catch {
      return member;
    }
  }));
}

export async function saveTeamMember(member, previous = null) {
  if (!member?.id) {
    if (!STAFF_ROLES.has(member?.role)) {
      throw new ApiError({ code: 'forbidden', status: 403, message: STAFF_ROLES_ONLY });
    }
    const created = await post('/users/staff', {
      name: member.name,
      mobile: member.mobile,
      email: member.email,
      role: member.role,
      functions: member.role === 'staff' ? member.functions || [] : [],
    });
    return { member: { ...toMember(created.user), functions: member.functions || [] }, inviteUrl: created.inviteUrl };
  }

  const roleChanged = previous && previous.role !== member.role;
  if (roleChanged) {
    throw new ApiError({
      code: 'role_change_unsupported',
      status: 409,
      message: 'A back-office account\'s role cannot be changed after it is created. '
        + 'Archive this account and create a new one with the role you need.',
    });
  }

  const updated = await patch(`/users/${encodeURIComponent(member.id)}`, {
    name: member.name,
    email: member.email,
  });
  return toMember(updated);
}

/* Status writes return no documented body; callers reload instead of reading a stale shape. */
export async function setTeamMemberStatus(id, status) {
  const path = `/users/${encodeURIComponent(id)}`;
  if (status === 'active') return patch(`${path}/restore`);
  return patch(`${path}/archive`, { reason: 'Suspended from the admin console' });
}

/** No body back. Both sign the account out everywhere; 403 on yourself, 409 on a non-staff account. */
export const resetTeamMemberTwoFactor = (id) => post(`/users/${encodeURIComponent(id)}/reset-2fa`);
export const reissueTeamMemberInvite = (id) => post(`/users/${encodeURIComponent(id)}/reissue-invite`);
