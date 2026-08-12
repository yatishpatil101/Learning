// ---------------- Internal team & access (admin RBAC) ----------------
/* Internal (service-side) portal accounts live in db.team, separate from the consumer
   db.users so admin/ops staff never pollute consumer moderation lists. Each record:
   { id, name, mobile, email, role: 'admin'|'manager'|'staff', roleId, moduleAccess:[],
     teams:[], status:'active'|'suspended', createdAt, approval }. Custom roles (reusable
     module bundles) live in db.customRoles.

   `approval` is the D200 maker-checker envelope: { createdBy, createdByName, createdAt,
   approvedBy, approvedAt }. Present while an account is waiting for a second administrator's
   signature and after it has been given; absent on accounts that never needed one.

   ## This file is the fake server, so the server's refusals live here (D205)

   Everything below used to say yes. An administrator archived the last administrator, the
   console reported success, and the real API would have answered 409 — a confident wrong
   answer, which is worse than a missing feature. The rules the server actually enforces are
   reproduced here, refusal messages included and verbatim, so a flow that fails live also
   fails on mocks. What could not be reproduced is named in `providers/mock/teamProvider.js`;
   read that list before trusting a green run here. */
import { rawLoad, rawSave, delay, currentStaffInfo } from './core.js';
/* Deliberately the same error class the http provider throws. A caller must not be able to tell a
   mock refusal from a real one by its type — that is the whole point of the exercise. (lib → services
   is an established direction here; `lib/data/myListings.js` does the same.) */
import { ApiError } from '../../services/http.js';

const normTeamMobile = (m) => String(m || '').replace(/\D/g, '').slice(-10);

/* ---- Refusals -------------------------------------------------------------------------
   Wording is the server's, not ours. These strings are what an operator reads live, so
   translating or improving them here would only hide the difference — they are deliberately
   absent from the locale files for that reason. Codes mirror `common/error/ErrorCodes`. */

const LAST_ADMINISTRATOR = 'This is the last administrator who can still manage back-office access. '
  + 'Give another active administrator the users:write permission first, otherwise nobody would be '
  + 'able to hand access back.';
const SELF_ARCHIVE = 'You cannot archive your own account';
const STAFF_ROLES_ONLY = 'Staff accounts may only be created with role staff or admin';
const DUPLICATE_MOBILE = 'A user with that mobile already exists';
const DUPLICATE_EMAIL = 'A user with that email already exists';
const APPROVER_ARCHIVED = 'This account is no longer active and cannot approve colleagues.';
const NOT_WAITING = 'This account is not waiting for approval — it can already sign in.';
const ALREADY_APPROVED = 'This account has already been approved.';
const SECOND_SIGNATURE = 'An account must be approved by an administrator other than the one who '
  + 'created it. Ask a colleague to approve this one.';

const conflict = (message) => new ApiError({ code: 'conflict', status: 409, message });
const forbidden = (message) => new ApiError({ code: 'forbidden', status: 403, message });
const notFound = (message) => new ApiError({ code: 'not_found', status: 404, message });

/* ---- Predicates ---------------------------------------------------------------------- */

const team = (db) => (Array.isArray(db.team) ? db.team : (db.team = []));
const isLive = (m) => (m?.status || 'active') === 'active';
const isPending = (m) => !!m?.approval && !m.approval.approvedAt;
/** The console's stand-in for the server's "administrator": role admin, live, signature done. */
const isAdministrator = (m) => m?.role === 'admin' && isLive(m) && !isPending(m);
const actorMobile = () => normTeamMobile(currentStaffInfo().mobile);

/**
 * The last-administrator floor (`AdministratorGuard`, D200).
 *
 * The server counts administrators who can still *manage back-office access* — role admin, not
 * archived, not awaiting approval, and still holding `users:write` once their permission document
 * is applied. The mock has no permission documents, so it counts the first three and treats every
 * live administrator as capable. That set is a superset of the server's, which means this floor
 * lifts *later* than the real one: a state the server refuses can still be reached here. It is the
 * one asymmetry left in the permissive direction and it is documented rather than papered over.
 */
function refuseIfLastAdministrator(db, target) {
  if (!isAdministrator(target)) return;
  const others = team(db).filter((m) => m.id !== target.id && isAdministrator(m));
  if (others.length === 0) throw conflict(LAST_ADMINISTRATOR);
}

/**
 * Whether a new account needs a second signature (`StaffAccountApproval`, D200).
 *
 * Decided before the row is inserted, and false while the platform is bootstrapping — if no other
 * admin-role account has ever existed there is nobody to countersign, and demanding one would
 * lock the first administrator out of their own console. Archived accounts still count as having
 * existed, exactly as the server counts them.
 */
function approvalIsPossible(db, creatorMobile) {
  return team(db).some((m) => m.role === 'admin' && normTeamMobile(m.mobile) !== creatorMobile);
}

export function listTeamMembers() {
  return delay(rawLoad().team || []);
}

/* Synchronous lookup used at staff-login to attach a member's role/permissions to the session.
   Returns the stored record (or null) for the given mobile number.

   Deliberately NOT maker-checker aware: `pages/consumer/StaffLogin.jsx` falls back to the
   role picked in its own radio group when this answers null, so hiding a pending account here
   would *widen* what that page grants, not narrow it. Closing that path is D205's sibling
   problem, not this one — see providers/mock/teamProvider.js. */
export function getTeamMemberByMobile(mobile) {
  const m = normTeamMobile(mobile);
  if (!m) return null;
  return (rawLoad().team || []).find((u) => normTeamMobile(u.mobile) === m) || null;
}

/**
 * Create or update an internal account.
 *
 * Create mirrors `POST /users/staff`: role restricted to the contract's `Role` enum, mobile and
 * email unique, and a maker-checker envelope attached when a second administrator exists to sign.
 * Update mirrors nothing on the wire — there is no route that changes a user's role — so the
 * floor is enforced here for the demote/suspend path the console can still reach.
 */
export function saveTeamMember(member) {
  const db = rawLoad();
  const rows = team(db);
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

  const duplicate = (pick, value) => value
    && rows.some((u) => u.id !== member.id && pick(u) === value);
  if (duplicate((u) => normTeamMobile(u.mobile), clean.mobile)) throw conflict(DUPLICATE_MOBILE);
  if (duplicate((u) => (u.email || '').trim().toLowerCase(), clean.email.toLowerCase())) {
    throw conflict(DUPLICATE_EMAIL);
  }

  let rec;
  if (member.id) {
    const idx = rows.findIndex((u) => u.id === member.id);
    if (idx < 0) throw notFound('No such team member');
    const previous = rows[idx];
    rec = { ...previous, ...clean, id: member.id };
    // A demotion or a suspension can strip the last administrator just as an archive can, and the
    // edit form is the only place that reaches it — the server has no role-change route at all.
    if (!isAdministrator(rec)) refuseIfLastAdministrator(db, previous);
    rows[idx] = rec;
  } else {
    // `STAFF_ROLES` on the server is exactly {staff, admin}; `manager` is an admin-console
    // permission label, not an auth role (contract: Role = buyer|owner|staff|admin).
    if (clean.role !== 'staff' && clean.role !== 'admin') throw forbidden(STAFF_ROLES_ONLY);
    const creator = actorMobile();
    const approval = approvalIsPossible(db, creator)
      ? {
        createdBy: creator,
        createdByName: currentStaffInfo().name,
        createdAt: new Date().toISOString(),
        approvedBy: null,
        approvedAt: null,
      }
      : null;
    rec = { id: 'TM' + Date.now(), createdAt: new Date().toISOString().slice(0, 10), ...clean, approval };
    rows.push(rec);
  }
  rawSave(db);
  return delay(rec);
}

/** `'suspended'` is the archive, `'active'` the restore — the only two the contract offers. */
export function setTeamMemberStatus(id, status) {
  const db = rawLoad();
  const rec = team(db).find((u) => u.id === id);
  if (!rec) throw notFound('No such team member');
  if (status !== 'active') {
    if (normTeamMobile(rec.mobile) === actorMobile()) throw forbidden(SELF_ARCHIVE);
    refuseIfLastAdministrator(db, rec);
  }
  rec.status = status;
  rawSave(db);
  return delay(rec);
}

/** Accounts still waiting on a second signature, oldest first — the server's ordering. */
export function listPendingApprovals() {
  const rows = (rawLoad().team || []).filter(isPending);
  rows.sort((a, b) => String(a.approval.createdAt).localeCompare(String(b.approval.createdAt)));
  return delay(rows);
}

/**
 * Turn the second key (`POST /users/{id}/approve`).
 *
 * Not idempotent, deliberately: approving twice is a 409 live, backed by a CHECK constraint, and a
 * mock that shrugged the second time would hide a double-click bug until production. Refusal order
 * matches the server's so the console's error copy is exercised in the same sequence.
 */
export function approveTeamMember(id) {
  const db = rawLoad();
  const rows = team(db);
  const rec = rows.find((u) => u.id === id);
  if (!rec) throw notFound('No such team member');

  const approver = rows.find((u) => normTeamMobile(u.mobile) === actorMobile());
  if (approver && !isLive(approver)) throw forbidden(APPROVER_ARCHIVED);
  if (!rec.approval) throw conflict(NOT_WAITING);
  if (rec.approval.approvedAt) throw conflict(ALREADY_APPROVED);
  if (rec.approval.createdBy === actorMobile()) throw forbidden(SECOND_SIGNATURE);

  rec.approval = { ...rec.approval, approvedBy: actorMobile(), approvedAt: new Date().toISOString() };
  rawSave(db);
  return delay(rec);
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
