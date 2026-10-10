/* Shape translation stays inline because this provider is the only caller. */
import { PAGE_LOAD_TTL, ApiError, get, patch, post } from '../../http.js';

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
  functions: u?.functions || [],
  status: u?.status === 'active' && !u?.archived ? 'active' : 'suspended',
  archived: Boolean(u?.archived),
  createdAt: u?.createdAt || u?.joinedAt || null,
});

export const listTeamMembers = async () => (await get('/admin/team', undefined, { ttl: PAGE_LOAD_TTL })).map(toMember);

/** The ticket picker's directory: active accounts by name and desks only. */
export const listAssignees = async () => (await get('/admin/team/assignees', undefined, { ttl: PAGE_LOAD_TTL }))
  .map((a) => ({ id: a.id, name: a.name || '', desks: Array.isArray(a.desks) ? a.desks : [] }));

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
export async function setTeamMemberStatus(member, status) {
  const path = `/users/${encodeURIComponent(member.id)}`;
  if (status === 'suspended') return patch(`${path}/suspend`, { reason: 'Suspended from the admin console' });
  return patch(member.archived ? `${path}/restore` : `${path}/reactivate`);
}

/** No body back. Both sign the account out everywhere; 403 on yourself, 409 on a non-staff account. */
export const resetTeamMemberTwoFactor = (id) => post(`/users/${encodeURIComponent(id)}/reset-2fa`);
export const reissueTeamMemberInvite = (id) => post(`/users/${encodeURIComponent(id)}/reissue-invite`);
