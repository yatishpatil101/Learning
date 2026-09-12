# Flow: Users Management & KYC / Verification

> The admin users desk: list and filter every account, grant/remove the opt-in Verified badge for
> owners and buyers, suspend / ban and flag bad actors, archive/restore, and keep a full activity
> timeline and audit trail. Verification is a **badge, not a gate** (ADR-019): granting it is a
> trust/ranking signal, never a prerequisite to post or contact.
> **Status:** documented from React source · re-synced to ADR-019 (badge-not-gate) - **Primary role(s):** admin / manager (staff with the Users module)

---

## 1. Purpose & user problem
- **Persona:** a back-office operator responsible for account integrity - approving genuine owners,
  suspending fraudsters, and answering "who is this user and what have they done?"
- **Job-to-be-done:** "Find an account, confirm its identity (KYC), and take the right moderation
  action, leaving an auditable record."
- **Why it matters:** a verified owner earns a trust badge that buyers rely on, and suspension is the
  lever that removes bad actors. This desk is the human side of the trust system that
  [`property-verification.md`](./property-verification.md) applies to supply.

## 2. Entry points
- **Routes:** `/admin/users`.
- **Tiles / triggers:** admin dashboard "users" KPI; per-row action buttons (verify, suspend, flag,
  archive/restore, view activity); bulk action bar when rows are selected.
- **Source components:**
  - `src/pages/admin/AdminUsers.jsx` - table, filters, single + bulk actions, timeline modal.
  - `src/components/ui/InternalNote.jsx` (`submitNote`) - reviewer notes.
  - `src/components/ui/Table.jsx` / `Badge.jsx` / `Modal.jsx` - presentation.

## 3. Actors & roles
- **Checker = admin / manager**, or a staff member whose custom role grants the `users` module
  (`ModuleRoute moduleKey="users"` in `src/App.jsx`, inside `RoleRoute roles={['admin','manager']}`).
- **Subjects** are `owner`, `buyer`, `staff`, and `admin` accounts (`ROLE_OPTS`).
- Guards are UX-only (cross-cutting section 1); real authorization must be server-side.

## 4. Entities touched
- [`users`](../../system/data-model.md) - **read** (list/filter), **updated** (`verified`,
  `status`, `flagged`), **soft-deleted** (`archived`, `archivedAt`, `archiveReason`).
- [`internalNotes`](../../system/data-model.md) (`internalNotes["user:<id>"]`) - **created**;
  never deleted.
- [`audit_log`](../../system/data-model.md) - **created** on every action.
- **Timeline (read-only join):** `enquiries`, `visits`, `tickets`, `listings`, and `internalNotes`
  are aggregated by the user's mobile/id to build the activity feed (`getUserTimeline`).

## 5. Business rules & logic  *(the meat)*

### 5.1 List, filter, search
- `listUsers(undefined, { includeArchived: true })` loads all accounts including archived
  (`src/lib/mockApi/users.js`); the page filters client-side (`rows` memo in `AdminUsers.jsx`):
  - **Role** filter (`owner|buyer|staff|admin`).
  - **Status** filter: `active|suspended|archived`. Choosing `archived` shows only archived rows;
    any other status hides archived rows and matches on `u.status`.
  - **Text** search over `name + mobile + id` (lowercased substring).
- Selection is cleared whenever a filter changes so bulk actions never hit invisible rows.

### 5.2 Grant the Verified badge (the approval action)
- A single toggle: `updateUser(id, { verified: !u.verified })`. Setting `verified: true` grants the
  BadgeCheck trust badge shown in the table and on public surfaces; unsetting removes it. The
  per-user action button reads **"Grant Verified badge"** / **"Remove Verified badge"**.
- Every toggle records context: `submitNote('user', id, note, verified ? 'Verified badge granted' :
  'Verified badge removed')` and `logAudit('User', '<Granted|Removed> Verified badge ... <name> (<id>)')`.
- **Badge grant is admin-decided, not self-service.** The user (maker) opts in and presents identity
  (DigiLocker via the consumer badge flow, or offline docs); the admin (checker) confirms and flips
  `verified`. There is no second-approver step today - a single admin both reviews and grants.
- **Badge-not-gate (ADR-019):** this `verified` flag is an **opt-in trust/ranking badge**. Owners do
  **not** need to clear any Aadhaar gate to post — posting and contact stay at L1 mobile. Uniqueness
  is enforced as **one identity → one badge** via the composite `identity_hash` (ADR-009b), inside the
  opt-in badge flow only.

### 5.3 Moderation actions (single)
`confirmAction` in `AdminUsers.jsx` switches on the action type, writes an audit entry, and patches
local state. Each carries a **reason**, typed into the action modal's own textarea — not the shared
`InternalNote` widget, which is collapsed behind a disclosure and would let a mandatory field be
missed:
| Action | Write | Audit |
|--------|-------|-------|
| Verify | `verified` toggled | "Verified"/"Unverified" |
| Suspend / Reactivate | `status` toggled `suspended` <-> `active` | "Suspended"/"Reactivated" |
| Flag / Unflag | `flagged` toggled | "Flagged"/"Unflagged" (soft signal for later review) |
| Archive | `archiveRecord('users', id, 'Archived by admin')` | `archived=true`; "Archived" |
| Restore | `restoreRecord('users', id, 'active')` | `archived=false`, `status='active'`; "Restored" |

- **Suspend** is the ban lever: a suspended account keeps its data but is treated as inactive.
- **Archive** is soft-delete (cross-cutting section 4); restore reactivates.
- A **staff note** on the account is a separate, deliberate act — see 5.6 — because the reason for a
  decision and what the team knows about a person are different records with different lifetimes.

### 5.4 Bulk actions
Gated by the `users.bulkOps` admin flag. Each iterates the selected ids and writes one audit entry:
- `runBulkVerify` (bulk button **"Grant badge"**) -> `updateUser(id, { verified: true })`.
- `runBulkSuspend` -> `updateUser(id, { status: 'suspended' })`.
- `runBulkArchive` -> `archiveRecord('users', id, 'Bulk archive')`.
Each is confirmed via a modal (`bulkConfirm`) before running.

### 5.5 Activity timeline (context for a decision)
`getUserTimeline(userId)` (`src/lib/mockApi/users.js`) builds a newest-first feed by joining on the
user's `mobile` (and `id` for owners):
1. Account creation (`joinedAt`).
2. Enquiries sent (`enquiries` where `mobile` matches; labelled visit / callback / enquiry).
3. Visits scheduled (`visits`; completed / cancelled / scheduled).
4. Service tickets (`tickets`; with team + value).
5. Listings owned (owners only; title + status).
Gated by the `users.timeline` flag; opened via the Eye action.

Notes are **not** on this feed. `GET /users/{id}/timeline` is administrator-only and its `kind`
union has no `note`, while notes are readable by any staffer holding `notes:read` — collapsing the
two would have narrowed the readership of a note to the narrower of the two routes. They render in
their own panel above the feed instead (5.6).

### 5.6 Staff notes on the account
The same `note` domain the property console uses, with `entityType: 'user'`:
`GET|POST /admin/notes/user/{id}`, `PATCH /admin/notes/{id}`. Mutable, author resolved server-side
from the token, no per-team walls — any staffer or administrator reads any note, deliberately.
Rendered as `data-testid="user-notes"` inside the Activity modal, with an explicit empty state
rather than an absent panel, so "nobody has written one" is distinguishable from "the read failed".

### 5.7 CSV export
`users.csvExport` flag enables exporting the current filtered rows
(ID, Name, Mobile, Role, City, Listings, Joined, Verified, Status) via `exportCsv`.

### 5.7 What MUST move server-side
- The `verified` grant (trust badge is a server-owned attribute, not client-settable).
- Suspend/ban enforcement (a suspended user must actually be blocked, not just badged).
- Archived-row visibility (archived accounts must be excluded from unauthorized reads).
- The timeline join (server-side aggregation with proper access control over PII).

## 6. Maker-checker / approval
- **Applicable: yes, in the single-approver form.** Maker = the user presenting identity/KYC;
  checker = the admin who flips `verified`. On approval the account gains the trust badge and an audit
  row is written. There is no distinct pending "verification request" record for accounts today (unlike
  property verification, which has an explicit `property_reviews` record) - the admin acts directly on
  the `users` row. See [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 2; a
  future backend should add a pending KYC-request record so verify/suspend can require a second approver.

## 7. State machine
- **`status`:** `active <-> suspended`; `active|suspended --(archive)--> archived --(restore)--> active`.
- **`verified`:** `false <-> true` (independent boolean; not a lifecycle stage).
- **`flagged`:** `false <-> true` (advisory marker; does not change access).
- **Terminal-ish:** `archived` (re-openable by restore, which forces `status='active'`).

## 8. Edge cases, validation & error states
- **Loading:** `<Loading />` until `all` resolves.
- **Empty / filtered-out:** the table renders its empty state ("Nothing matches this filter.").
- **Selection safety:** selection resets on any filter/role/status change.
- **Optional note:** action modals accept an optional note; the action still records its label even
  when the note is blank (`addInternalNote` saves when text OR an action label is present).
- **Idempotent toggles:** verify/suspend/flag are toggles; re-applying flips back (no dedicated
  "already verified" error).
- **Concurrency:** last write wins on the shared store; no locking.
