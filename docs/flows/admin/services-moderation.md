# Flow: Admin Services Moderation (Service Requests desk)

> The ops desk for the services marketplace: every customer service request (rent agreement,
> legal, home loans, interior, packers, valuation) routed to a team, assigned to staff, worked
> and resolved - plus the catalog/pricing levers that live in Settings.
> **Status:** documented from React source - **Primary role(s):** admin / manager (with the Services module); ops staff via the team-scoped portal

---

## 1. Purpose & user problem
- **Persona:** an operations lead (or team manager) running PuneNest's paid/assisted services.
- **Job-to-be-done:** "Take incoming service requests, route each to the right vertical team,
  assign an owner, track age/SLA, and mark them resolved."
- **Why it matters:** services are a direct revenue line (see [`finance.md`](./finance.md), where
  done tickets and rent-agreement fees feed the transaction ledger). This desk is where that
  revenue is actually fulfilled, and its pickup/delivery timings drive the SLA analytics.

> **Scope note (honest gap):** the repo does **not** implement a separate provider directory with
> per-provider/per-listing approval. The "marketplace" is: (a) the consumer `/services` catalog
> (`src/data/services.json` + Settings Move-in Pack pricing), and (b) this admin **Service Requests**
> desk which moderates the *request lifecycle* by team. Provider onboarding/approval maker-checker is
> a backend-to-build, called out in sections 6 and 11.

## 2. Entry points
- **Routes:** `/admin/services`. Deep-link `?open=<ticketId>` auto-opens that ticket's modal once per mount.
- **Tiles / triggers:** 4 KPI stats (New / In Progress / Resolved / Total), a search+filter bar,
  the requests table (per-row Start / Resolve / Open), and the request modal (assignment, status, notes).
  The Dashboard "Latest service requests" and "New Service Requests" tile both link here.
- **Source components:**
  - `src/pages/admin/AdminServices.jsx` - KPIs, filters, table, row actions, modal, CSV export.
  - `src/lib/data/tickets.js` - `TEAMS`, `TEAM_LABEL`, `statusLabel`, `addTicketNote`.
  - `src/lib/mockApi/tickets.js` - `listTickets`, `updateTicket`, `createServiceRequest`, `syncServiceTicket`.
  - Catalog/pricing surfaces (adjacent): `src/data/services.json`, `AdminSettings.jsx` Move-in Pack + fees.

## 3. Actors & roles
- **Operator = admin / manager** with the `services` module; the whole page short-circuits to
  "Services module is disabled" when the `services.enabled` option flag is off (links to Settings).
- **Ops staff** work the same tickets through the staff portal; scoping is server-side
  (`ServiceDeskAuthority.deskFilterFor`, D44) rather than a route guard, and an admin implicitly
  belongs to all teams. Ops teams are the 6 verticals in `OPS_TEAMS` / `TEAMS`.
- Option flags (`useAdminFlags().optionEnabled`) toggle columns/controls:
  `services.priority`, `services.teamRouting`, `services.staffAssignment` (all seed `true`).
- Guards are UX-only mock RBAC ([`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 1).

## 4. Entities touched
- [`tickets`](../../system/data-model.md) - **read** and **updated** (`status`, `assignedTo`, appended `notes`).
- [`users`](../../system/data-model.md) - **read** (staff filtered by `role === 'staff'` and `team`) to populate the assignee dropdown.
- [`services`](../../system/data-model.md) catalog + `settings.movePack` / `settings.fees` - **read** (pricing context; edited on the Settings page, see [`settings-team-staff.md`](./settings-team-staff.md)).
- [`audit_log`](../../system/data-model.md) - **created** on start / resolve / save via `logAudit('Service request', ...)`.

## 5. Business rules & logic  *(the meat)*

### 5.1 Teams (the service verticals)
`TEAMS = ['rental', 'legal', 'loans', 'interior', 'packers', 'valuation']` with labels
(`TEAM_LABEL`): Rent Agreement, Property & Legal, Home Loans, Interior & Renovation,
Packers & Movers, Property Valuation. These are the same keys as `OPS_TEAMS` (staff team-scoping)
and the `services.json` `team` field, so a ticket's `team` binds the request to a vertical and to
the staff who may own it.

### 5.2 KPIs
`kpis` memo over all tickets: `nw` = count `status==='new'`, `ip` = `in_progress`, `dn` = `done`,
`total` = length. Rendered as New / In Progress / Resolved / Total.

### 5.3 Filtering & search
`rows` filter combines: team (`t.team === fTeam`, only when `services.teamRouting`), status
(`t.status === fStat`), priority (`t.priority === fPrio`, only when `services.priority`), and a
free-text query lower-cased against `id + service + customer + detail + mobile`. A counter shows
`rows.length of tickets.length requests`.

### 5.4 Age chip (informal SLA signal)
`openDays(t) = floor((now - createdAt) / 86400000)`. For non-terminal tickets the status cell shows
a chip: green `< 2` days, amber `2-4` days, red `>= 5` days ("Xd open", "today" for `<= 0`). Done/cancelled tickets show no chip.

### 5.5 Row actions (lifecycle transitions)
| From | Action | Effect |
|------|--------|--------|
| `new` | **Start** | `updateTicket(id, { status: 'in_progress', assignedTo })` where `assignedTo = t.assignedTo || firstStaffOfTeam || null`; audit "Started ...". |
| `in_progress` | **Resolve** | `updateTicket(id, { status: 'done' })`; audit "Resolved ...". |
| any | **Open** | opens the detail/assignment modal (no mutation). |
- `teamStaff(team) = users.filter(u => u.role === 'staff' && u.team === team)` - drives the default
  assignee on Start and the modal's assignee options.

### 5.6 Modal save
`saveTicket()` writes `{ assignedTo: form.assignedTo || null, status: form.status }`; if a trimmed
note is present it calls `addTicketNote(id, note, 'Admin')` (appends `{ at, by, text }`, date `YYYY-MM-DD`).
Audit: "Updated <id> -> <status>[, assigned <name>]". The `?open=` deep-link param is cleared on close/save.

### 5.7 Catalog & pricing (adjacent, not on this page)
- `services.json` entries carry `{ key, name, team, price, active, desc, icon }` - the consumer catalog;
  `active:false` hides a service. There is **no admin UI to toggle `services[].active` today** - only
  the module-level `services.enabled` flag and the Settings Move-in Pack pricing/launch toggle exist.
- Move-in Pack (Settings > Fees): per-item prices + `enabled` (Live vs "Coming soon"); read by consumer `/services`.

### 5.8 Ops-workflow mirroring
`syncServiceTicket(ref, status)` keeps a ticket truthful when its linked ops workflow (rent agreement,
valuation, etc.) advances - it matches by the `ref` stamped at creation and mirrors the workflow state
onto `ticket.status` so the admin desk never shows a request stuck at "new" after real progress.

### 5.9 What MUST move server-side
- Ticket lifecycle transitions and legal-transition enforcement (cannot resolve a cancelled ticket).
- Team-based authorization of who may see/act on a ticket (currently client-filtered).
- The default-assignee-on-Start heuristic (first staff of team) should be a real routing/round-robin rule.
- The age/SLA colour thresholds are client-side; SLA compliance must be computed server-side (see analytics SLA).

## 6. Maker-checker / approval
- **For the request desk: no.** Start/Resolve/assign are single-actor ops transitions, not propose/approve gates.
- **For a real provider marketplace: yes (to build).** Provider onboarding and per-listing catalog changes
  should follow the shared maker-checker pattern - a maker (partner/ops) proposes a provider/service listing,
  a checker (admin) approves before it goes live, with pending -> approved/rejected states and audit.
  See [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 2. This is **not** implemented today.

## 7. State machine
- **Ticket:** `new -> in_progress -> done`; `cancelled` is a terminal option available in the modal
  status select (`STATUS_OPTS`). Terminal states (`done`, `cancelled`) drop the age chip and offer no row action.
- Row actions only expose the next legal step (Start from `new`, Resolve from `in_progress`); the modal
  can set any of `new / in_progress / done / cancelled` directly.

## 8. Edge cases, validation & error states
- **Loading:** `<Loading />` until tickets + flags load.
- **Module disabled:** `services.enabled` off -> full-page "Services module is disabled" with a Settings link.
- **Deep-link guard:** `?open=` handled once per mount (`deepLinkHandled` ref) so it doesn't re-open after close.
- **Unassigned display:** null `assignedTo` renders "-" / "Unassigned"; Start falls back to the first team staffer.
- **Empty:** table shows "No requests match".
- **Notes:** only non-empty trimmed notes are appended; empty note textareas are ignored.
- **Concurrency:** shared store, last write wins (`updateTicket` does `Object.assign` + save).
