import { createProvider } from './config.js';

const provider = createProvider('team');

/** Every internal account, live and suspended, in console shape. */
export const listTeamMembers = async (...args) => (await provider()).listTeamMembers(...args);

/** Active back-office accounts as { id, name, desks } for an assignee picker; no contact details. */
export const listAssignees = async () => (await provider()).listAssignees();

/** Creates return `{ member, inviteUrl }`; edits return the member. */
export const saveTeamMember = async (...args) => (await provider()).saveTeamMember(...args);

/** `'suspended'` archives the account, `'active'` restores it. 409 when the floor refuses. */
export const setTeamMemberStatus = async (...args) => (await provider()).setTeamMemberStatus(...args);

/** The colleague sets up a new authenticator at their next sign-in. */
export const resetTeamMemberTwoFactor = async (...args) => (await provider()).resetTeamMemberTwoFactor(...args);

/** Returns a fresh invite link and voids the old one. */
export const reissueTeamMemberInvite = async (...args) => (await provider()).reissueTeamMemberInvite(...args);
