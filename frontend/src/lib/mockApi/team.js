// ---------------- Internal team & access (admin RBAC) ----------------
/* Internal (service-side) portal accounts live in db.team, separate from the consumer
   db.users so admin/ops staff never pollute consumer moderation lists. Each record:
   { id, name, mobile, email, role: 'admin'|'manager'|'staff', roleId, moduleAccess:[],
     teams:[], status:'active'|'suspended', createdAt }. Custom roles (reusable module
     bundles) live in settings.customRoles. */
import { rawLoad, rawSave, delay } from './core.js';

const normTeamMobile = (m) => String(m || '').replace(/\D/g, '').slice(-10);

export function listTeamMembers() {
  return delay(rawLoad().team || []);
}

// Synchronous lookup used at staff-login to attach a member's role/permissions to the
// session. Returns the stored record (or null) for the given mobile number.
export function getTeamMemberByMobile(mobile) {
  const m = normTeamMobile(mobile);
  if (!m) return null;
  return (rawLoad().team || []).find((u) => normTeamMobile(u.mobile) === m) || null;
}

export function saveTeamMember(member) {
  const db = rawLoad();
  if (!Array.isArray(db.team)) db.team = [];
  const clean = {
    name: (member.name || '').trim() || 'Team member',
    mobile: normTeamMobile(member.mobile),
    email: (member.email || '').trim(),
    role: member.role || 'manager',
    roleId: member.roleId || null,
    moduleAccess: Array.isArray(member.moduleAccess) ? member.moduleAccess : [],
    teams: Array.isArray(member.teams) ? member.teams : [],
    status: member.status || 'active',
  };
  let rec;
  if (member.id) {
    const idx = db.team.findIndex((u) => u.id === member.id);
    if (idx >= 0) { rec = { ...db.team[idx], ...clean, id: member.id }; db.team[idx] = rec; }
  }
  if (!rec) {
    rec = { id: 'TM' + Date.now(), createdAt: new Date().toISOString().slice(0, 10), ...clean };
    db.team.push(rec);
  }
  rawSave(db);
  return delay(rec);
}

export function setTeamMemberStatus(id, status) {
  const db = rawLoad();
  const rec = (db.team || []).find((u) => u.id === id);
  if (rec) { rec.status = status; rawSave(db); }
  return delay(rec);
}

export function deleteTeamMember(id) {
  const db = rawLoad();
  db.team = (db.team || []).filter((u) => u.id !== id);
  rawSave(db);
  return delay(true);
}

/* Custom roles are console-local module bundles. They used to live inside the settings document
   as `settings.customRoles`, and they cannot any more: the server refuses that key outright with
   422 (`AdminSettingsService.UNSUPPORTED_KEYS`, migration V61 deletes the stored row — D67), on the
   grounds that the console composes BASE ∪ role-bundle ∪ moduleAccess, a *widening* union, while
   the server's PermissionMap may only ever narrow. A mock whose settings document carries a key the
   API rejects is a mock that lies about the contract, so they live at `db.customRoles` instead —
   outside anything getSettings/updateSettings hands over. This lifts an existing browser store
   across on first read and takes the dead key out of its settings document at the same time. */
function customRoleStore(db) {
  if (Array.isArray(db.customRoles)) return db.customRoles;
  db.customRoles = Array.isArray(db.settings?.customRoles) ? db.settings.customRoles : [];
  if (db.settings && 'customRoles' in db.settings) {
    const { customRoles: _removed, ...settings } = db.settings;
    db.settings = settings;
    rawSave(db);
  }
  return db.customRoles;
}

export function listCustomRoles() {
  return delay(customRoleStore(rawLoad()));
}

// Synchronous read for permission resolution (nav filtering / route guards).
export function getCustomRoles() {
  return customRoleStore(rawLoad());
}

export function saveCustomRole(role) {
  const db = rawLoad();
  const roles = [...customRoleStore(db)];
  const clean = {
    name: (role.name || '').trim() || 'Custom role',
    modules: Array.isArray(role.modules) ? role.modules : [],
    teams: Array.isArray(role.teams) ? role.teams : [],
  };
  let rec;
  if (role.id) {
    const idx = roles.findIndex((r) => r.id === role.id);
    if (idx >= 0) { rec = { ...roles[idx], ...clean, id: role.id }; roles[idx] = rec; }
  }
  if (!rec) { rec = { id: 'CR' + Date.now(), ...clean }; roles.push(rec); }
  db.customRoles = roles;
  rawSave(db);
  window.dispatchEvent(new CustomEvent('punenest-settings-change'));
  return delay(rec);
}

export function deleteCustomRole(id) {
  const db = rawLoad();
  db.customRoles = customRoleStore(db).filter((r) => r.id !== id);
  rawSave(db);
  window.dispatchEvent(new CustomEvent('punenest-settings-change'));
  return delay(true);
}
