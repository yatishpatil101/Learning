# Flow: Ops Service Queues (shared back-office work queues)

> The team-scoped ops back-office. Two shared, parameterized queue engines power every ops
> desk: a lightweight ticket queue (Requests) and a config-driven service-workflow queue
> (Rent Agreement, Legal, Interior, Packers, Valuation). Staff see only their team's work;
> admins see everything.
> **Status:** documented from React source - **Primary role(s):** staff (team-scoped), admin / manager (all teams)

---

> **Reality check (honest gap vs. the "one shared OpsQueue" framing).** The repo has **two**
> shared queue components, not one:
> - `OpsQueue.jsx` - a simple ticket board backed by `db.tickets`. Only `/ops/requests` renders it.
> - `OpsServiceQueue.jsx` - a config-driven workflow board backed by the `serviceFlow` engine
>   (per-customer `localStorage`). All five team desks (rental, legal, interior, packers,
>   valuation) render it, differing only by a `type` prop into `SVC_CONFIG`.
>
> Both are "one component parameterized per team", but they are different engines with different
> data stores and different state machines. This doc covers both and where they join
> (`syncServiceTicket`). The referrals desk is a third queue, documented separately in
> [`referrals-fraud.md`](./referrals-fraud.md).

## 1. Purpose & user problem
- **Persona:** an ops staff member on a vertical team (Rent Agreement, Legal, Interior, Packers,
  Valuation), or an admin/manager overseeing all teams.
- **Job-to-be-done:** "Show me only my team's incoming work, let me claim/assign a ticket, move
  it through its lifecycle, verify customer documents, share a draft for approval, and close it
  out - without seeing other teams' queues."
- **Why it matters:** paid/assisted services are a direct revenue line. These queues are where
  requests captured on the consumer side (see [`../consumer/services-calculators.md`](../consumer/services-calculators.md)
  and [`../consumer/rent-agreement.md`](../consumer/rent-agreement.md)) are actually fulfilled.
  The admin mirror of this desk is [`../admin/services-moderation.md`](../admin/services-moderation.md).

## 2. Entry points
- **Routes** (all under `RoleRoute roles=['staff','admin']` + `AdminLayout variant="ops"`):
  - `/ops` - `OpsDashboard` (team-scoped KPI landing).
  - `/ops/requests` - `OpsRequests` -> `OpsQueue` (all-teams ticket board; **no** `TeamRoute`).
  - `/ops/rent-agreement` - `TeamRoute team="rental"` -> `OpsRentAgreement` -> `OpsServiceQueue type="rental"`.
  - `/ops/legal` - `TeamRoute team="legal"` -> `OpsLegal` -> `OpsServiceQueue type="legal"`.
  - `/ops/interior` - `TeamRoute team="interior"` -> `OpsInterior` -> `OpsServiceQueue type="interior"`.
  - `/ops/packers` - `TeamRoute team="packers"` -> `OpsPackers` -> `OpsServiceQueue type="packers"`.
  - `/ops/valuation` - `TeamRoute team="valuation"` -> `OpsValuation` -> `OpsServiceQueue type="valuation"`.
- **Tiles / triggers:** the ops sidebar (`AdminLayout` nav), the `OpsDashboard` team tile
  (routes to the team's workflow page via `WORKFLOW_ROUTE`, or falls back to `/ops/requests`),
  and the "All tickets" link on the dashboard. Login (`/staff-login`) redirects a staffer to
  their team home via `TEAM_HOME` (for example `rental -> /ops/rent-agreement`, `loans -> /ops/requests`).
- **Source components:**
  - `src/pages/ops/OpsQueue.jsx` - ticket board.
  - `src/pages/ops/OpsServiceQueue.jsx` - workflow board (`SVC_CONFIG` at top of file).
  - `src/pages/ops/service-queue/{Stepper,DocViewer,constants,helpers}.js(x)` - workflow sub-parts.
  - `src/pages/ops/{OpsRequests,OpsRentAgreement,OpsLegal,OpsInterior,OpsPackers,OpsValuation}.jsx`
    - thin per-team wrappers.
  - `src/pages/ops/OpsDashboard.jsx` - team-scoped landing.

## 3. Actors & roles
- **staff** - sees and acts on their team only. Enforced two ways:
  - **Route guard:** `TeamRoute team="x"` (`src/components/RouteGuards.jsx`) requires `x` in the
    user's `teams[]`; otherwise redirect to `/ops?denied=x`. Admins bypass.
  - **Data scope:** inside the component (see section 5). `OpsQueue` resolves
    `scope = team || (role === 'admin' ? undefined : myTeam)`; `OpsServiceQueue` filters by service
    `type`, and its route is already team-gated.
- **admin / manager** - bypasses `TeamRoute` (`user.role === 'admin'` short-circuit) and sees every
  team. In `OpsQueue`, admins on `/ops/requests` also get an extra **Team** column (`showTeam`).
- **Note:** `/ops/requests` and `/ops/referrals` have **no** `TeamRoute`, so any staffer can open
  the route; `OpsQueue` still narrows the *data* to `myTeam`. See
  [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 1 for the role/team model.
- **Trust caveat:** guards are UX-only over editable `localStorage`. Team scoping MUST be
  re-enforced server-side (section 11).

## 4. Entities touched
Link definitions: [`../../system/domain-model.md`](../../system/domain-model.md).

- **Ticket** (`db.tickets`) - the `OpsQueue` record. Read (list), updated (status / assignee /
  notes). Never hard-deleted (status flips to `cancelled` on sync). Fields: `id`, `team`, `service`,
  `customer` (name string), `mobile`, `status`, `priority`, `assignedTo`, `value`, `ref`,
  `createdAt` (date), `notes[]` (`{at, by, text}`), `detail`.
- **Service request** (`serviceFlow`, `localStorage puneNestServiceReq:<mobile>`) - the
  `OpsServiceQueue` record. Read (list across all customers), updated (status, docs, draft,
  finalDoc, assignedTo, messages, timeline). Fields include `id`, `type`, `service`, `status`,
  `customer {name, mobile}`, `details {}`, `docs[]`, `draft`, `draftDecision`, `finalDoc`,
  `messages[]`, `timeline[]`, `assignedTo`, `ticketRef`, `createdAt`, `updatedAt`.
- **Ticket <-> service-request link** - a service request created with a `ticketRef` mirrors its
  workflow status onto the matching ticket via `syncServiceTicket` (keeps admin dashboards truthful).
- **Staff activity / audit** - `logStaffActivity` writes on assign and on completion.
- **Notification** - cross-user dashboard bell (`pushNotificationFor`) fires on the maker-checker
  transitions (draft shared, registration submitted, completed).

## 5. Business rules & logic  *(the meat)*

### 5.1 Ticket queue (`OpsQueue`, `/ops/requests`)
- **Team scoping (data):**
  ```js
  const scope = team || (role === 'admin' ? undefined : myTeam || undefined);
  listTickets(scope); // filters db.tickets by t.team === scope, or returns all if undefined
  ```
  `OpsRequests` passes **no** `team` prop, so: staff -> their `myTeam`; admin -> `undefined` (all).
  `listTickets(team)` (`src/lib/mockApi/tickets.js`) does the `t.team === team` filter.
- **Counts:** `total / new / in_progress / done / mine` (mine = `assignedTo === user.name`),
  computed client-side from the loaded (already team-scoped) list.
- **Filtering:** status tile (`'' | new | in_progress | done`), free-text search over
  `customer + mobile + id + detail`, and an "Assigned to me" toggle (`mineOnly`).
- **Priority:** `high | medium | low`, seeded per ticket, **display-only** (colored label). There
  is no priority editing and no due date. `PRIORITY` maps to text colors only.
- **Assignment:** `claim(t)` sets `assignedTo = user.name`; if the ticket is `new` it also flips
  to `in_progress`. Re-claiming a non-new ticket only reassigns.
- **Status transitions (actions):** row buttons are status-aware -
  `new` shows **Claim**, `in_progress` shows **Resolve** (-> `done`), `done` shows none. The detail
  modal also has a free `Select` (New / In progress / Done) plus "Assign to me".
- **Notes:** `addNote` appends `{at: today, by: user.name, text}` to `notes[]`. Activity is
  append-only (no edit/delete).
- **Export:** CSV of the currently filtered rows.
- **SLA:** none. There is no timer, breach flag, or due date - only `createdAt`. The dashboard's
  8-week "resolved" bar chart (`resolvedSeries`) is a deterministic decorative series seeded from
  the team name, not real SLA data.

### 5.2 Service-workflow queue (`OpsServiceQueue`, 5 team desks)
- **Config-driven per team:** `SVC_CONFIG[type]` supplies `title`, `subtitle`, `icon`,
  `draftNoun` (Draft / Legal opinion / Design quote / Quote / Valuation report), `regNoun`
  (Registration / Execution / Moving day / Review), `finalNoun`, the 5 `steps` labels, the detail
  `rows` (key/label/format), and the hero amount key. Same code, different nouns per team.
- **Data scope:** `allRequests(svc.type)` (`src/lib/serviceFlow.js`) scans **every**
  `puneNestServiceReq:<mobile>` localStorage key across all customers and keeps records where
  `r.type === svc.type`, sorted by `updatedAt` desc. So the desk shows all requests of that
  service type; team isolation is enforced by the `TeamRoute` on the route, not by an owner/team
  field on the record.
- **Counts / buckets:** `total`, `open` (`isActive` = not completed/cancelled), `action`
  (status in `submitted | docs_review | changes_requested | approved`), `done` (`completed`).
- **Filtering:** free-text over `customer name + summary + id + mobile`, plus a stage `Select`
  where `open` and `action` are derived buckets and the rest are exact status matches.
- **Open behavior:** `openReq` marks staff-facing messages read and **auto-assigns** the request
  to the current user if it is unassigned (`assign`).
- **Documents:** each request seeds a `docs[]` checklist. Staff can `Verify` / `Reject` a single
  doc (`setDocStatus`), add a per-doc note, view/download the file (`DocViewer`), or
  **Mark all verified** (`markDocsVerified`, which also advances `submitted -> docs_review`).
- **Draft (maker step):** `shareDraft` uploads a file, bumps `draft.version`, sets status
  `draft_shared`, clears any prior decision, posts a customer message, and fires a notification.
- **Registration / completion:** `submitRegistration` (`approved -> registration`), then
  `uploadFinal` (`registration -> completed`, attaches `finalDoc`, notifies, logs completion).
- **Cancel:** `cancel` sets `cancelled` (terminal) with a confirm prompt.
- **Messaging + WhatsApp:** `addMessage` posts a staff/customer message; `waCustomer` opens a
  `wa.me` deep link with a status-aware template (draft ready / changes / registration / completed).
- **Ticket mirroring:** any status change routes through `_save -> syncTicket`, which calls
  `syncServiceTicket(ticketRef, TICKET_STATUS[status])` so a linked `db.tickets` row tracks the
  workflow (`new / in_progress / done / cancelled`). Unlinked requests no-op.

### 5.3 Must move server-side
- Team scoping of both list reads (never send other teams' rows to the client).
- Auto-assign, status transitions, and doc verification (authorization + valid-transition checks).
- The ticket <-> service-request mirroring (a transactional server join, not a client re-write).
- Notification/WhatsApp dispatch on transitions.

## 6. Maker-checker / approval
Applicable to the **service-workflow queue** (the draft approval step). See the shared pattern in
[`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 2.

- **Inverted maker/checker.** Here the **staff member is the maker** and the **customer is the
  checker** - the opposite of listing verification (where the customer proposes and staff approve).
  - **Maker = ops staff:** `shareDraft(...)` proposes the deliverable and sets `draft_shared`.
  - **Checker = customer:** on the consumer side `decideDraft(id, 'accepted' | 'changes')`
    (`serviceFlow.js`) either approves (`-> approved`, side effect: staff may now
    `submitRegistration`) or requests changes (`-> changes_requested`, maker uploads a revised
    version and the cycle repeats).
  - **Approval side effects:** status advance, customer message, dashboard notification, and
    eventually the final document upload that completes the request.
- The **ticket queue** has no formal maker-checker; it is a plain work queue (claim -> resolve),
  though its completion is what an admin/manager ultimately signs off on in the mirror ticket.

## 7. State machine

### 7.1 Ticket (`OpsQueue`)
```
new  --(claim)-->  in_progress  --(resolve)-->  done
  \____________ (Select in modal, any -> any) ____________/
(cancelled is reachable only via syncServiceTicket when a linked service request is cancelled)
```
- Terminal: `done` (and `cancelled` via sync). Re-opening is only by editing status in the modal.

### 7.2 Service request (`OpsServiceQueue`, engine `serviceFlow.js`)
```
awaiting_party --> submitted --> docs_review --> draft_shared --> approved --> registration --> completed
                                     ^                |
                                     |          changes_requested (customer)
                                     +----- (revised draft via shareDraft) --+
any active state --(cancel)--> cancelled
```
- Step map (`ACTIVE`) drives the 5-dot `Stepper`: Submitted(1) / Documents(1) /
  Draft & approval(2) / Registration(3) / Ready(4); `completed` renders all steps done.
- `isActive(status)` = not `completed` and not `cancelled`.
- Terminal: `completed`, `cancelled`. `changes_requested` re-opens the draft loop (back to
  `draft_shared` on the next `shareDraft`).

## 8. Edge cases, validation & error states
- **Empty queue:** ticket table shows "No tickets in this queue."; service desk shows
  "No <title> requests".
- **Team denied:** `TeamRoute` redirects to `/ops?denied=<team>`; the dashboard shows a dismissible
  amber banner naming the team (`TEAM_LABELS`).
- **Loading:** `OpsQueue` shows `<Loading />` until tickets arrive (`all === null`);
  `OpsServiceQueue` seeds demo data on mount (`seedDemo`) then renders.
- **Unassigned display:** ticket shows "Unassigned"; opening a service request auto-claims it.
- **Missing / oversized files:** `DocViewer` handles image vs. PDF vs. unknown mime, and shows
  "No file uploaded by the customer yet." when absent. Large uploads are flagged (`file.tooLarge`).
- **Empty note / message:** `addNote` and `send` no-op on blank input (`.trim()` guard).
- **Reject-verify interplay:** `markDocsVerified` verifies everything **except** docs already
  `rejected`, so a rejected doc is not silently re-approved by "Mark all verified".
- **Concurrency / staleness:** both engines read-modify-write the same editable `localStorage`
  with no version check; last write wins. A real backend needs optimistic concurrency (section 11).
- **Blank summary fallback:** `summaryOf` falls back across `summaryKey -> service -> location ->
  from` so a lightly-filled request never shows an empty summary.

## 9. Current mock implementation
- **Ticket service:** `src/lib/mockApi/tickets.js` - `listTickets(team)`, `updateTicket(id, patch)`,
  `createServiceRequest(...)`, `syncServiceTicket(ref, status)`. Re-exported from `src/lib/mockApi.js`.
- **Workflow engine:** `src/lib/serviceFlow.js` - `allRequests`, `get`, `assign`, `markRead`,
  `setDocStatus`, `markDocsVerified`, `shareDraft`, `decideDraft`, `submitRegistration`,
  `uploadFinal`, `addMessage`, `cancel`, `seedDemo`, `seedService`, plus status helpers
  (`statusLabel`, `isActive`, `stepStates`, `progressPct`). State persists to
  `localStorage` under `puneNestServiceReq:<mobile>` (same keys the consumer app reads/writes).
- **Data/seed:**
  - `src/data/db.json` -> `tickets[]` (teams: interior, legal, and others; statuses new /
    in_progress / done; priority high/medium/low).
  - `serviceFlow.seedDemo()` / `seedService(type)` synthesize rental/legal/interior/packers/valuation
    requests with sample docs (`sampleDocFile`) on first load.
- **Key components / handlers:**
  - `OpsQueue.jsx` - `claim`, `setTicketStatus`, `addNote`, `counts`, `rows`, `doExport`, columns.
  - `OpsServiceQueue.jsx` - `SVC_CONFIG`, `openReq`, `verifyAll`, `doDoc`, `doShareDraft`,
    `doSubmitReg`, `doUploadFinal`, `doCancel`, `send`, `waCustomer`.
  - `service-queue/Stepper.jsx` (stage dots), `service-queue/DocViewer.jsx` (doc preview + note),
    `service-queue/constants.js` (`STAGE_BADGE`, `DOC_PILL`, `STAGE_OPTS`), `helpers.js` (`fmtAgo`).
- **Provider seam:** these ops flows call `mockApi` / `serviceFlow` directly (not the
  `src/services/providers/mock` seam used by consumer-facing reads); a backend swap must add the
  HTTP equivalents. See [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 6.

## 10. Target API endpoints
Map to [`../../system/api-contract.md`](../../system/api-contract.md).

- **Tickets (section 13):**
  - `GET /tickets` - list; MUST accept/enforce a team scope for staff (server derives team from
    the token, not a client param).
  - `PATCH /tickets/:id` - status / assignee changes.
  - `POST /tickets/:id/notes` - append a note.
- **Service requests (section 21):**
  - `GET /service-requests` (staff view MUST be filtered by service type + team).
  - `GET /service-requests/:id` - detail with timeline.
  - `PATCH /service-requests/:id/status` - the workflow transitions (docs_review, registration,
    completed, cancelled).
  - `POST /service-requests/:id/docs` - verify/reject a doc + note.
  - `POST /service-requests/:id/draft` - share a draft (maker).
  - `POST /service-requests/:id/draft/decision` - customer approve/reject (checker).
  - `POST /service-requests/:id/final-doc` - upload the final document.
  - `POST /service-requests/:id/messages` - chat.
- **Delta the flow implies:** the contract's ticket list needs an explicit team-scoped variant for
  staff; the service-request list needs a `type` filter; and a server-side link so approving/closing
  a service request mirrors the ticket status (the `syncServiceTicket` behavior) transactionally.

## 11. Backend responsibilities
- **Team scoping enforced server-side.** Derive the caller's team(s) from the auth token and filter
  both ticket and service-request lists on the server. Never return other teams' rows; the client
  `scope`/`TeamRoute` are hints only.
- **Authorization per action.** Only a member of the owning team (or admin) may claim, change status,
  verify docs, share a draft, submit registration, or upload the final document.
- **Valid-transition guards.** Reject illegal jumps (for example `submitted -> completed`); enforce
  the state machine in section 7 on the server, not via UI button visibility.
- **Auto-assign + audit.** Server sets `assignedTo` on open, and writes an audit/staff-activity row
  for assign, status change, doc decision, draft share, and completion (who / when / what) -
  see [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 4.
- **Maker-checker integrity.** The customer's draft decision must be authenticated as the customer;
  the client cannot flip a request to `approved` or `completed` on its own.
- **Ticket <-> request consistency.** Mirror workflow status onto the linked ticket in one
  transaction; never trust the client to keep the two in sync.
- **Notifications / WhatsApp** dispatched server-side on transitions, not fired from the browser.
- **Concurrency.** Use optimistic locking (updatedAt / version) so two staff editing the same
  request do not silently overwrite each other.
- **Not client-trusted:** team membership, status value, assignee identity, and completion.
