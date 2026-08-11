# Flow: Admin Settings, Team & Staff

> The control room: site branding/contact/legal details, the fee schedule + Move-in Pack pricing,
> Google Places geo policy, application + admin-module feature flags, the audit log, and the
> Team & Access console (internal accounts, roles, permissions, ops-team scoping).
> **Status:** documented from React source - **Primary role(s):** admin (super-admin only)

---

## 1. Purpose & user problem
- **Persona:** a super-admin / platform owner configuring how PuneNest behaves and who can operate it.
- **Job-to-be-done:** "Edit site details and fees, flip features on/off safely, review the audit trail,
  and create scoped internal accounts (managers, ops staff) whose access maps to exactly the modules and
  service teams they need."
- **Why it matters:** these settings drive money math ([`finance.md`](./finance.md)), consumer behaviour
  (flags), locality search (geo policy), and - via team-scoping - which ops queues each staffer sees. Team &
  Access is the RBAC substrate every other admin flow is gated by.

## 2. Entry points
- **Routes:** `/admin/settings` (tabs: general, fees, maps, flags [sub-tabs application/admin], audit),
  `/admin/team` (tabs: members, roles). Both are `adminOnly` modules.
- **Tiles / triggers:** Settings save buttons per section, flag toggles (confirmation-gated), audit
  export/clear; Team "Add member" / "New role" and per-row Edit / Suspend / Remove. Dashboard "Feature flags"
  and "Add staff" quick actions link here.
- **Source components:**
  - `src/pages/admin/AdminSettings.jsx` + `settings/AppFlagsPanel.jsx`, `AdminFlagsPanel.jsx`, `MapsGeoPanel.jsx`.
  - `src/pages/admin/AdminTeam.jsx` (members + custom roles); `src/lib/adminModules.js`, `src/lib/permissions.js`.
  - Persistence `src/lib/mockApi/collections.js` (`getSettings`, `updateSettings`), `src/lib/mockApi/team.js`.

## 3. Actors & roles
- **Super-admin only.** Both `team` and `settings` modules are `adminOnly: true` in `ADMIN_MODULES`, so
  `permissions.js` (`effectiveModuleKeys`) filters them out for any non-super-admin, and no grant can add them.
- `isSuperAdmin(user)` = role in `['admin','superadmin']` **or** a `'*'` module grant.
- Guards are UX-only mock RBAC ([`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 1);
  the real enforcement must be server-side (section 11).

## 4. Entities touched
- [`settings`](../../system/data-model.md) - **read / updated**: `site`, `fees`, `movePack`, `geo`,
  `flags` (app), `adminFlags` (admin modules, via `AdminFlagsContext`).
  **Not** `customRoles`: `PUT /admin/settings` answers **422** for that key
  (`AdminSettingsService.UNSUPPORTED_KEYS`; migration `V61` deletes the stored row - D67), so it is
  not part of the settings document at all. It lives in its own `customRoles` collection (see 5.8).
- `customRoles` (console-local) - **read / created / updated / deleted**. Never sent to the server.
- [`team`](../../system/data-model.md) (internal accounts, separate from consumer `users`) - **read / created / updated / deleted**.
- [`audit_log`](../../system/data-model.md) - **read / created / cleared** (Settings audit tab; every save/toggle logs).

## 5. Business rules & logic  *(the meat)*

### 5.1 General (site) settings
`SITE_FIELDS` = name, legalName, tagline, supportEmail, supportPhone, whatsapp, supportHours, address, gst.
`saveSite()` -> `updateSettings({ site })` + audit "Updated branding / contact / legal details". Free-text; no validation today.

### 5.2 Fees + Move-in Pack
- Fees are the flat `settings.fees` map (seed: `ownerPlanYearly 999`, `ownerProYearly 2499`,
  `rentAgreementPlatform 500`, `seekerPlusTopup 199`, `featuredListing 999`, `gstPercent 18`, `rentPayPercent 2`).
  `setFee(k, v) = Number(v) || 0`; keys containing "percent" render a `%` suffix (else a rupee prefix). Labels are humanized.
  `saveFees()` -> `updateSettings({ fees })` + audit "Updated platform charges & fee schedule". These feed Finance math.
- **Move-in Pack** (`settings.movePack`): `{ enabled, items:{ movers, clean, agreement, paint, verify, internet } }`.
  Per-item price inputs (`Number||0`), an `enabled` switch labelled Live vs "Coming soon"; `saveMovePack()` audits
  "Saved prices; status: Live|Coming soon". Read by the consumer `/services` bundle.

### 5.3 Maps & Places (geo policy)
`MapsGeoPanel` edits `settings.geo` (city limit + blacklist for Google Places). `saveGeo(nextGeo, detail)`
optimistically sets state, `updateSettings({ geo })`, audits "Maps & Places" with a detail, and is read live by
`lib/geoConfig.js` across every locality/area search.

### 5.4 Feature flags (two namespaces, confirmation-gated)
- **Application flags** (`settings.flags`, ~30 booleans e.g. `mapSearch`, `zeroBrokerage`, `onlineRentPayment`,
  `staffLoginEnabled`, `maintenanceMode`): `requestAppFlagToggle(k)` opens a `ConfirmDialog` ("Enable/Disable
  <Humanized>?", `danger` when disabling); on confirm it writes the full `flags` map via `updateSettings` and
  audits "App flag <Name> enabled|disabled".
- **Admin-module flags** (`settings.adminFlags`, grouped tab/dash/analytics/finance/properties/users/services/
  enquiries/content/reports/flatmates/staffActivity): managed through `AdminFlagsContext` (`setFlag(section, key, value)`);
  `requestAdminFlagToggle` shows the same confirm and toasts. These are the `optionEnabled('<section>.<key>')`
  gates every admin page reads. Disabling a module reduces "API cost" and hides UI.
- Both share `humanize(k)` (camelCase -> Title, with SaaS/SMS/EMI fixups). A risk legend (Low/Med/High) is shown for admin modules.

### 5.5 Audit log
On entering the audit tab, `listAudit()` populates the table (When = localized `at`, User = `who`, Action badge,
Detail). `exportAudit()` -> CSV `['When','User','Action','Detail']`; `wipeAudit()` -> `clearAudit()` (both toast on empty).
A banner cross-links to `/admin/staff-activity` for operational (staff) activity.

### 5.6 Team & Access - the RBAC model (`permissions.js` + `adminModules.js`)
Three internal roles:
- **admin (super-admin):** full access to every module (the `'*'` grant); can see Team & Access + Settings.
- **manager (scoped):** sees BASE modules (`dashboard`) UNION their custom-role bundle (`roleId -> customRoles`)
  UNION per-user `moduleAccess` overrides - but never `adminOnly` modules. `effectiveModuleKeys(user, customRoles)`
  computes this; `properties:verify` sub-scope also unlocks the Properties module in a verify-only mode (`propertiesScope`).
- **staff (ops):** no admin shell; scoped to ops service **teams** (`OPS_TEAMS` = rental, legal, loans, interior,
  packers, valuation). `userTeams(user)` = `teams[] || [team]`.
Grantable permissions grid = every non-base, non-admin-only module, with a "Properties . Verify only" sub-scope row.

### 5.7 Team & Access - member CRUD + guardrails
`accessSummary(m)`: admin -> "Full access"; staff -> its team labels (or "No teams assigned"); manager ->
`<roleName?> . <N modules | Dashboard only>` (excluding `dashboard`).
`saveMember()` validation and payload shaping:
- Name required; mobile normalized to 10 digits (`digits10`) and must be exactly 10; **duplicate mobile** across
  members is rejected.
- **Last-admin guardrail:** editing cannot demote (admin -> manager/staff) or suspend the final active admin
  (`wasLastAdmin && !staysActiveAdmin` -> error). Mirrored in `toggleMemberStatus` (can't suspend last admin) and
  `removeMember` (can't delete last active admin).
- Payload zeroes irrelevant fields by role: manager keeps `roleId` + `moduleAccess`, clears `teams`; staff keeps
  `teams`, clears role bundle/overrides; admin clears both.
- `saveTeamMember` (mock) assigns `id = 'TM'+Date.now()`, `createdAt` on create; audits "Created/Updated <RoleLabel> \"name\"".
- `toggleMemberStatus` flips `active <-> suspended`; `removeMember` confirms then deletes. Status pill = active/suspended.

### 5.8 Team & Access - custom roles (reusable module bundles, **console-only**)
`customRoles` (seed: `CR_requests` = enquiries+services+postOnBehalf; `CR_verify` = properties:verify;
`CR_content` = content+localities+societies). `saveCustomRole` -> `id='CR'+Date.now()`, stores `{name, modules, teams}`
into the `customRoles` collection and fires `punenest-settings-change`. `removeRole` warns how many members use it
(they fall back to their manual tab access). Roles are picked as a manager "preset"; ticked tabs add on top.

**They are not a permission grant and the tab says so.** The server has no concept of them and refuses
the key outright (422, D67): this screen composes `BASE UNION role-bundle UNION moduleAccess`, a
*widening* union, whereas the server's `PermissionMap` may only ever **narrow** a role baseline -
honouring the console's model server-side would be privilege escalation. What a custom role actually
does is decide which modules this admin console renders for a member; server-side access still comes
from their role and team alone. Whether scoped back-office accounts should exist server-side at all
is open (D13, [`../../system/open-questions.md`](../../system/open-questions.md)); until it is
answered, the affordance stays but is labelled console-only rather than removed, so the decision is
not foreclosed by deleting the UI.

### 5.9 How team-scoping drives ops queues
A staff member's `teams[]` (or a role's `teams`) select which service verticals they own; the Services desk
([`services-moderation.md`](./services-moderation.md)) filters staff by `role==='staff' && team===<ticket.team>`
for assignment, and the staff portal (`TeamRoute`) only shows tickets for the member's teams. Team labels
(`OPS_TEAMS`/`TEAM_LABEL`) are the single source shared by Settings, the ticket desk and staff login.

### 5.10 What MUST move server-side
- All permission resolution (`effectiveModuleKeys`, `propertiesScope`, `isSuperAdmin`) and every last-admin
  guardrail - today they are client-side and explicitly labelled "mock RBAC - UX only, not real security".
- Flag writes and settings persistence (a manipulated client must not be able to grant itself `settings`/`team`).
- Fee/geo changes must be validated and authorized server-side (they change money and search behaviour).

## 6. Maker-checker / approval
- **Not a maker-checker flow** in the propose/approve sense - a single super-admin edits and it takes effect
  immediately (flag toggles are only *confirmation*-gated, not two-person). Audit provides the after-the-fact trail.
- A hardened backend could add maker-checker to sensitive changes (fee schedule, kill-switches like
  `maintenanceMode`, granting admin) per [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 2. Not present today.

## 7. State machine
- **Settings fields:** no lifecycle - each save overwrites (`updateSettings` merges the patched section).
- **Feature flag:** `on <-> off` (confirmation-gated).
- **Team member:** `active <-> suspended`; `create -> (edit)* -> delete`. Terminal-ish `suspended` still counts as
  a member; last-active-admin is protected from demotion/suspension/deletion.
- **Custom role:** `create -> (edit)* -> delete`; deletion detaches members to their manual access.

## 8. Edge cases, validation & error states
- **Loading:** `<Loading />` until `getSettings()` (Settings) / `listTeamMembers()`+`listCustomRoles()` (Team) resolve.
- **Confirmation dialogs:** every flag toggle is gated; `danger` styling when disabling.
- **Member validation:** required name, 10-digit mobile, duplicate-mobile rejection, last-admin protections (3 sites).
- **Audit empty:** export/clear no-op with a toast when the log is empty; render shows "No changes logged yet."
- **Fee coercion:** non-numeric fee input becomes `0`.
- **Cross-tab sync:** `updateSettings` and role writes dispatch `punenest-settings-change` so nav/guards refresh in-tab.
- **Concurrency:** shared store; `updateSettings` merges by section, but two concurrent section saves can clobber each other (last write wins).
