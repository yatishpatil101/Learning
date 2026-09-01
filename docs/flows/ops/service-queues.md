# Flow: Ops Service Queues (shared back-office work queues)

> The ops back-office. Two queues carry the work: a lightweight **ticket board** (Requests) and the
> **drafting desk** — both now reading the live API, and both scoped to the caller's own desk by the
> server rather than by the client. Admins see everything.
> **Status:** documented from React source - **Primary role(s):** staff (desk-scoped), admin / manager (all desks)

> **Runtime correction (2026-08-28).** Any remaining `serviceFlow` references below are migration
> history. The browser-local workflow was deleted with the mock provider; both the consumer tracker
> and the drafting desk read `service_requests` through `serviceRequestService.js`.

---

> **What changed (the five per-team desks are gone).** This doc used to describe six team desks
> — `/ops/rent-agreement`, `/ops/legal`, `/ops/interior`, `/ops/packers`, `/ops/valuation`, plus
> loans on the ticket board — all rendering one `OpsServiceQueue` component over the `serviceFlow`
> `localStorage` engine. They were **retired**, not ported, because consumers now file through the
> seam into Postgres: the desks were reading a store the work no longer arrives in, so in live mode
> every one of them was blind. The five routes now redirect to `/ops/drafting-desk?type=<team>`.
>
> Of the six operations `serviceFlow` gave those desks, three already existed on the server (take,
> message, cancel — plus draft/final, which had endpoints but no working path in dev) and three did
> not, **by design**: `setDocStatus` and `markDocsVerified` tick a checklist the server derives on
> read and never stores (D120), and `submitRegistration` sets a status `ServiceRequestStatus`
> refuses by name — "a state with no decision in it, and therefore not a state". Nothing was
> ported that the contract declines to model.
>
> The repo now has **four** ops surfaces on three data stores:
> - `OpsQueue.jsx` - the ticket board, on the **live seam** (`ticketService.js` → http provider).
>   Only `/ops/requests` renders it. It has **no mock provider at all** (D184): a board that cannot
>   reach the API says so and shows nothing, rather than showing an empty queue it did not read.
>   Sections 5.1 and 7.1.
> - `OpsDraftingDesk.jsx` - the service-request desk, on the **live seam**
>   (`serviceRequestService.js` → http provider). Team-scoped by the server, with the D120 document
>   checklist. Sections 5.1a and 7.2.
> - `OpsReferrals` - the referral fraud-review desk, documented separately in
>   [`referrals-fraud.md`](./referrals-fraud.md). Still on `lib/mockApi.js`; the backend
>   (`ReferralsController`) is complete and the frontend seam is not yet built.
> - `OpsFlatmateReview` - the flatmate host-verification desk (section 5.3), still on the
>   `localStorage` review store, with no ticket mirror, no assignment and no SLA. Its backend
>   (`FlatmateModerationController`) is complete; the seam is not yet built.

## 1. Purpose & user problem
- **Persona:** an ops staff member on a vertical team (Rent Agreement, Legal, Interior, Packers,
  Valuation), or an admin/manager overseeing all teams.
- **Job-to-be-done:** "Show me only my desk's incoming work, let me claim a matter, see what
  paperwork is still outstanding, read the parties' identity numbers while I hold it, and move it
  through its lifecycle - without seeing other desks' work."
- **Why it matters:** paid/assisted services are a direct revenue line. These queues are where
  requests captured on the consumer side (see [`../consumer/services-calculators.md`](../consumer/services-calculators.md)
  and [`../consumer/rent-agreement.md`](../consumer/rent-agreement.md)) are actually fulfilled.
  The admin mirror of this desk is [`../admin/services-moderation.md`](../admin/services-moderation.md).

## 2. Entry points
- **Routes** (all under `RoleRoute roles=['staff','admin']` + `AdminLayout variant="ops"`):
  - `/ops` - `OpsDashboard` (KPI landing).
  - `/ops/requests` - `OpsRequests` -> `OpsQueue` (all-teams ticket board).
  - `/ops/drafting-desk` - `OpsDraftingDesk` (service requests, live API). `?type=` picks the desk;
    a staffer is offered only their own.
  - `/ops/rent-agreement`, `/ops/legal`, `/ops/interior`, `/ops/packers`, `/ops/valuation` -
    **redirects** to `/ops/drafting-desk?type=<team>`. Kept rather than 404'd because they are in
    bookmarks, in `TEAM_HOME` history and in this documentation.
  - `/ops/flatmate-review` - `OpsFlatmateReview` (flatmate host verification; no team narrowing of
    its data - see the trust caveat in section 3).
- **Tiles / triggers:** the ops sidebar (`AdminLayout` nav, 7 rows), the `OpsDashboard` team tile
  (routes via `WORKFLOW_ROUTE`, now `/ops/drafting-desk?type=<team>` for all five verticals),
  and the "All tickets" link on the dashboard. Login (`/staff-login`) redirects a staffer to
  their team home via `TEAM_HOME` (`loans -> /ops/requests`, every other team -> the drafting desk).
- **Source components:**
  - `src/pages/ops/OpsQueue.jsx` - ticket board.
  - `src/pages/ops/OpsDraftingDesk.jsx` - service-request desk (live).
  - `src/pages/ops/service-queue/helpers.js` - `fmtAgo`, shared with `OpsSupportQueue`. The rest of
    that folder (`Stepper`, `DocViewer`, `constants`) went with `OpsServiceQueue`.
  - `src/pages/ops/OpsFlatmateReview.jsx` - flatmate host-verification desk (section 5.3).
  - `src/pages/ops/OpsDashboard.jsx` - ops landing.

## 3. Actors & roles
- **staff** - sees and acts on their own desk only. Enforced **on the server**:
  - `ServiceDeskAuthority.deskFilterFor(caller, team)` ignores a `team` a staff caller does not own
    and fails closed (D44); `ServiceRequestQueryService` documents why there is no `?requesterId=`
    either - "a filter a client can set is a filter a client can remove".
  - The client's job is only to *say so*: the drafting desk's picker offers a staffer their own desk
    and nothing else, because an empty queue and a forbidden queue must not look alike.
  - `OpsQueue` (tickets) does **not** narrow at all any more. It sends `?team=` only when the
    staffer picks one, and `TicketService.list` resolves the rest: a staffer with no team gets 403,
    a staffer asking another desk gets `"You can only see the <team> queue."`, and an admin gets
    everything. The old client-side `scope = team || (role === 'admin' ? undefined : myTeam)` line
    is gone — same reasoning as D44.
- **admin / manager** - sees every desk; the picker offers all of them. In `OpsQueue`, admins on
  `/ops/requests` also get an extra **Team** column (`showTeam`).
- **`TeamRoute` is deleted.** It gated the five retired routes and redirected to `/ops?denied=x`.
  Removing it widened nothing (D44, above); the `?denied=` banner on `OpsDashboard` went with it,
  since the guard was its only producer.
- **Note:** `/ops/requests`, `/ops/referrals` and `/ops/flatmate-review` never had a team guard.
  `/ops/requests` does not need one — the server scopes the read. `OpsFlatmateReview` still reads
  `getFlatmateReviews()` unfiltered from the client store. See
  [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 1 for the role/team model.
- **Trust caveat:** on the two live desks the guard is now a server decision and the client guard is
  only signposting. On the two surfaces still on `localStorage` (referrals, flatmate review) the
  caveat stands in full: guards are UX-only over editable storage (section 11).

## 4. Entities touched
Link definitions: [`../../system/data-model.md`](../../system/data-model.md).

- **Ticket** (`tickets` in Postgres, read through `ticketService.js`) - the `OpsQueue` record. Read
  (paged list), updated (status / priority / assignee / team), appended to (notes). Never deleted;
  `closed` and `cancelled` are statuses. The wire shape is `TicketDto`: `id`, `subject`, `team`,
  `priority`, `status`, `propertyId`, `assignee` (a resolved display **name**, not an id), `service`,
  `customer`, `mobile`, `value`, `detail`, `notes[]` (`{by, text, at}`), `createdAt`.
  Writes go the other way as `TicketUpdate(status, priority, assigneeId, team)` — an **id** in, a
  **name** out, so the client never gets to decide whose name appears against a claim.
  `service` and `value` are null on everything a customer files; see section 7.1.
- **Service request** (`service_requests` in Postgres, read through `serviceRequestService.js`) -
  the `OpsDraftingDesk` record. Read (paged queue + one matter), updated (assignee via *take*).
  The wire shape is `ServiceRequestDto`: `id`, `type`, `status`, `details {}` (free-form `jsonb`,
  D119), `documents[]`, `messages[]`, `timeline[]`, `assignee`, `amount`, `createdAt`. Identity
  numbers are **not** on it - they are a separate audited read, section 5.1a.
  The consumer tracker reads the same server-owned request through its consumer-scoped endpoint.
- **Document checklist** (derived, `GET /service-requests/{id}/checklist`) - not an entity. Folded
  at read time from the request's own vault documents (D120): no checklist table, no `status`
  column a desk can tick, and therefore no way for "verified" to disagree with "there is a file".
- **Ticket <-> service-request link** - a mock-era idea. `syncServiceTicket` mirrored a service
  request's workflow status onto a ticket carrying the same `ticketRef`, so that admin dashboards
  counting tickets stayed truthful. **The server does not do this**, and neither does the seam:
  `TicketUpdate` has no `ticketRef` and `ServiceRequestDto` has no ticket field. The two queues are
  now genuinely separate work streams. Nothing was lost that was real — the mirror existed to keep
  one store consistent with itself.
- **Staff activity / audit** - `logStaffActivity` writes on assign and on completion.
- **Notification** - cross-user dashboard bell (`pushNotificationFor`) fires on the maker-checker
  transitions (draft shared, registration submitted, completed).

## 5. Business rules & logic  *(the meat)*

### 5.1 Ticket queue (`OpsQueue`, `/ops/requests`) — **live-only since wave 2c**

The board reads `GET /tickets` through `services/ticketService.js` and has **no mock provider**.
That is not an oversight, and it is the same call D184 made for the drafting desk: three of the
mock's words were *wrong* rather than merely different, so a translation table would have had to
invent facts.

| | mock (`db.tickets`) | server |
|---|---|---|
| statuses | `new`, `in_progress`, `done` | `open`, `in-progress`, `waiting`, `resolved`, `closed` |
| assignment | `assignedTo = user.name`, any string | `assigneeId`, a user id — a name is not one, and an id that is no ops user is a **404** |
| notes | read-modify-write the whole `notes[]` | `POST /tickets/{id}/notes`, one note |
| shape | the whole list | paged (`PageResponse`) |
| team scoping | recomputed in the component | `TicketService.list`, server-side (D44) |

In mock mode the board renders the reason it is shut. An empty queue and a queue nobody can read
look identical on screen and only one of them is good news — the defect that retired the five
per-team desks, so it is stated rather than risked again.

- **Team scoping (data):** none in the component. It passes the `team` prop as given and lets the
  server answer, including the refusal: a staffer asking for another desk gets
  `You can only see the <team> queue.` rendered as written. The old
  `scope = team || (role === 'admin' ? undefined : myTeam)` was a second copy of a decision
  `TicketService.list` already makes, which is how two copies come to disagree.
- **The window, and why it is not a page.** Everything above the table — the four tiles, the
  search, "Assigned to me" — is computed *across* rows, and those numbers are wrong when taken
  from one page of a paged list ("3 open" of page 1 of 4 is not a fact about the queue). So the
  board asks for the newest 100 and counts over those; when the queue is longer it says so above
  the tiles rather than presenting a partial count as a total.
- **Counts:** `total / open / in-progress / resolved / mine` (mine = `assignedTo === user.name`,
  matching against the name `TicketMapper` resolved).
- **Filtering:** status tile (`'' | open | in-progress | resolved`), free-text search over
  `customer + mobile + id + detail`, and an "Assigned to me" toggle — all over the window.
- **Priority:** `low | medium | high | urgent` (`TicketPriorities`), **display-only**. `PATCH`
  accepts a priority; no control sends one.
- **Assignment — self-claim only.** `claim(t)` sends `{ assigneeId: user.id }`, the caller's own.
  The endpoint would take any ops user's id, but handing work to a named stranger needs a staff
  directory this portal does not have; free assignment and unassign (`assigneeId: "none"`, D46)
  are both deliberately absent. The name that comes back was resolved by the server, so the
  assignee column can no longer hold a string the browser typed.
- **A claim does not advance the ticket.** The mock's claim also flipped `new → in_progress`.
  Putting your name on something and declaring it underway are two decisions, and taking the
  second silently is how a board reports work in flight that nobody has started.
- **Status transitions (actions):** row buttons are status-aware — `open` shows **Claim**,
  `in-progress` shows **Resolve** (→ `resolved`), everything else shows none. The detail drawer
  has a free `Select` over all five, and the server is the one that refuses an illegal move.
- **Notes:** `addNote` **appends** via `POST /tickets/{id}/notes` and pushes the returned note.
  The array is never resent, so two colleagues writing in the same minute no longer erase each
  other. `attachments` is accepted and dropped by the controller; nothing here offers it.
- **Export:** CSV of the currently filtered rows — i.e. of the window, not the queue.
- **SLA:** none. There is no timer, breach flag, or due date — only `createdAt`. The dashboard's
  8-week "resolved" bar chart (`resolvedSeries`) is a deterministic decorative series seeded from
  the team name, not real SLA data.

### 5.2 Drafting desk (`OpsDraftingDesk`, `/ops/drafting-desk`)
The live replacement for the five per-team desks. It reads the server directly; there is no mock
mode or browser-local queue to fall back to. A desk that shows an empty table when it simply cannot
see the real queue is worse than one that fails the request visibly (D184).

- **Data scope:** `listServiceRequestQueue({type, status, page, size})` →
  `GET /service-requests`. The scope is the **server's**: `ServiceDeskAuthority.deskFilterFor`
  derives it from the principal's role and ignores a `team` a staff caller does not own (D44).
  There is no `?requesterId=` for the same reason.
- **Desk picker:** a staffer is offered their own desk and nothing else; an admin gets all of them.
  `?type=` in the URL, so a desk is linkable and the retired routes can redirect into it.
- **Counts / paging:** server-paged, `PAGE_SIZE = 20`, `{content, page, size, totalElements}`.
  A failed read is `status: 'error'`, never an empty list - "an unread queue that renders as an
  empty one is how a desk goes home early".
- **Take:** `takeServiceRequest(id)` → `PATCH /{id}/status` → `assigned`. Self-take only; there is
  no assign-to-someone-else. A 409 is the transition table talking and its sentence is shown.
- **Documents (read-only):** `readServiceRequestChecklist(id)` → `GET /{id}/checklist` renders
  "*n* of *m* received" and **every** item, present or missing - the missing ones are the point.
  There is nothing to tick: the fold is derived on read, so the only thing that moves an item is
  an upload. A failed read says so rather than rendering as "nothing filed".
  No viewer and no download: `Item.documentId` is an id, not a URL, so the endpoint never mints a
  download credential - the bytes stay behind `GET /service-requests/{id}`, and signed vault URLs
  do not resolve in dev anyway. Document *viewing* is a deliberate open gap.
- **Details:** an **allow-list** of named scalar `details` keys (`DETAIL_FIELDS`), never a dump of
  the raw `jsonb` - it is whatever a form put there.
- **Identity reveal:** section 5.1a / D151 / D173.
- **Not here, and not coming back:** per-doc verify/reject and *Mark all verified* (the checklist is
  derived - D120), and *Submit registration* (`registration` is a status the contract refuses by
  name). Share-draft and upload-final have endpoints but no surface: they were multipart writes
  into a vault whose signed URLs do not resolve in dev, so there was no working path to port.
  Messaging, cancel and the WhatsApp deep link exist on the seam
  (`addServiceRequestMessage`, cancel via `PATCH /{id}/status`) but have no desk UI yet.

### 5.3 Flatmate verification queue (`OpsFlatmateReview`, `/ops/flatmate-review`)
A sitting tenant's "I have a registered rent agreement" is self-declared, so tenant-tier flatmate
posts - and any address a **different** host already claimed, and any owner flat-split whose parent
listing is not yet approved - land here before they earn a trust cue. Owner-tier posts are vetted
through the listing's own docs and never appear.

- **Intake:** `enqueueFlatmateReview(...)`, called from `persistFlatmate` (tenant tier or
  `guard.flagForReview`) and from `splitFlat` (unapproved parent listing or flagged address -
  **one review per flat**, not per room).
- **Buckets / tabs:** `pending`, `flagged` (`flagForReview && status === 'pending'`), `approved`
  ("Ops-verified"), `rejected`, `all`. The four KPI tiles are the same buckets and are clickable.
- **Row content:** host + masked mobile (last 4) + created date; flat/address with a Room/Group chip;
  the claimed `tier`; signals (View agreement / Agreement on file / **No document** for a tenant-tier
  row with nothing attached); status; actions.
- **Decisions:** approve -> `decideFlatmateReview(id, 'approved')` and the host shows **Ops-verified**.
  Reject **requires a non-empty reason** (`decideFlatmateReview(id, 'rejected', reason)`), and the
  host is told why.
- **Documents** open through the shared `lib/openDoc.js` scheme allowlist, the same rule every other
  document surface uses.
- **Store:** `GET|PATCH /admin/flatmate-reviews` and `/admin/flatmates/{id}/moderation` since wave
  2c — **not** `db.tickets` and **not** `serviceFlow`. There is still no ticket mirror, no assignment
  and no SLA. The boards page at 25 server-side.
- Consumer-side model: [`../consumer/flatmates.md`](../consumer/flatmates.md) section 5.
- Board-by-board detail: [`flatmate-moderation.md`](flatmate-moderation.md).

### 5.5 Support queue (`OpsSupportQueue`, `/ops/support`) — **live-only since wave 2d**
The platform-wide view of customer support conversations, and a **different operation** from the
customer's own list rather than the same one with a wider scope (D51). `GET /support/tickets` is an
unpaged bare array carrying every message inline; "every support conversation on the platform" in
that shape is a PII export by another name, so `GET /admin/support-tickets` is paged, staff/admin
only, and returns summaries with **no thread and no mobile number**.

- **Tabs:** Awaiting reply (`awaitingReply=true`), Answered (`false`), All (parameter omitted). The
  tri-state matters — `undefined` is not `false`, and collapsing them would make "All" mean
  "answered".
- **Two booleans, not opposites.** `awaitingReply` is a customer message nobody on the desk has
  read; `unread` is a staff reply the *customer* has not opened. "We answered and they have not
  looked" is not "we have not answered", and a queue that collapses them tells the desk to chase
  people it has already answered.
- **Reading is side-aware** (D50, `staff_unread` added in V53). Opening a ticket clears the desk's
  side only; the raiser's own `unread` is untouched, and neither side can mark the other as caught
  up. One column could not do both jobs, which is why there are two.
- **The thread is a second read.** The row carries no messages, so the modal fetches
  `GET /support/tickets/{id}` — which succeeds for a ticket the caller did not raise because
  `readable()` admits ops. That is the staff read right, stated once, in the service.
- **Paging:** 25 a page, server-side, same as the flatmate boards.
- Consumer-side model: [`../consumer/support-tickets.md`](../consumer/support-tickets.md).

### 5.6 Must move server-side
**Done for service requests** (the drafting desk): the list read is scoped by
`ServiceDeskAuthority.deskFilterFor` (D44), take is a validated transition, and the document
checklist is derived server-side rather than ticked by a client (D120).

**Done for tickets** (wave 2c): the list read is scoped by `TicketService.list` and refuses a desk
the caller does not own by name; status, priority and assignment are validated writes; notes are
appended by the server with its own author and timestamp. The mirroring is not outstanding — it was
**dropped**, see section 4.

**Done for the flatmate desk** (wave 2c): host verification, the D72 moderation boards and the
group-application queue all read and write the server. The agreement blob is still base64 in JSONB
— recorded debt, not a gap in the seam — and the reason-required-on-reject rule is now the server's.

**Done for referral fraud review** (wave 2c): `ReferralsController` has its caller, and the
Aadhaar-before-approve rule moved with it.

**Done for the support queue** (wave 2d): the two-sided read model is the server's and always was;
what changed is that a client finally reads it instead of a `localStorage` flag standing in for both
sides at once.

Still outstanding:
- Notification/WhatsApp dispatch on transitions.

## 6. Maker-checker / approval
Applicable to the **draft approval step**. See the shared pattern in
[`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 2.

> **Currently unreachable from ops.** The maker half lived on the retired per-team desks. The
> endpoints exist (`POST /{id}/draft`, `POST /{id}/final`, `POST /{id}/draft-decision`) but the
> drafting desk has no surface for them yet, and the multipart writes land in a vault whose signed
> URLs do not resolve in dev. Described here as the intended shape, not as something that works.

- **Inverted maker/checker.** The **staff member is the maker** and the **customer is the
  checker** - the opposite of listing verification (where the customer proposes and staff approve).
  - **Maker = ops staff:** shares the deliverable and sets `draft-shared`.
  - **Checker = customer:** approves (`-> approved`) or requests changes
    (`-> changes-requested`, maker uploads a revised version and the cycle repeats).
  - **Approval side effects:** status advance, customer message, dashboard notification, and
    eventually the final document upload that completes the request.
- The **ticket queue** has no formal maker-checker; it is a plain work queue (claim -> resolve).

## 7. State machine

### 7.1 Ticket (`OpsQueue`, `TicketStatuses` — server-owned)
```
open  --(Claim)-->  open        <- a claim assigns; it does not advance
open  --(Resolve / Set status)-->  in-progress | waiting | resolved | closed
     \_______________ (Set status in the drawer, any -> any) _______________/
```
- Five values: `open`, `in-progress`, `waiting`, `resolved`, `closed`. The mock's `new`,
  `in_progress` and `done` do not exist and a client sending them gets a 400.
- **No transition table.** `PATCH /tickets/{id}` accepts any legal status from any other, unlike
  `ServiceRequestStatus` (7.2) which refuses illegal moves. That is deliberate for a work queue: a
  ticket that turns out to be the wrong desk's, or that a customer replies to after it was closed,
  has to be able to go backwards without an ops person filing a second one.
- Terminal in practice: `resolved` and `closed`, neither enforced.
- `waiting` is the value the mock had no way to say. A ticket parked on the customer used to sit in
  `in_progress` looking like work in flight, which is exactly the reading an SLA report must not
  make.

### 7.2 Service request (`ServiceRequestStatus`, server-owned)
Nine wire values, and the transition table is the server's:
```
awaiting-payment  -> new, cancelled
new               -> assigned, in-progress, cancelled
assigned          -> in-progress, draft-shared, cancelled
in-progress       -> assigned, draft-shared, cancelled
draft-shared      -> approved, changes-requested, in-progress, draft-shared, cancelled
changes-requested -> assigned, in-progress, draft-shared, cancelled
approved          -> completed, cancelled
completed, cancelled -> (terminal)
```
- `STAFF_SETTABLE = {assigned, in-progress, cancelled}`. Everything else is a consequence of an
  action (a draft shared, a decision taken), not a status a desk may pick.
- **The React prototype's extra statuses do not exist.** `docs_review`, `registration` and
  `awaiting_party` were `localStorage` inventions. `registration` in particular is refused by name:
  "the window between `approved` and the final document landing - a state with no decision in it,
  and therefore not a state". This is why the retired desks' *Mark all verified* and *Submit
  registration* buttons had nowhere to go.

## 8. Edge cases, validation & error states
- **Empty queue:** ticket table shows "No tickets in this queue."; the drafting desk distinguishes
  an empty queue from an unread one and from a mock-mode desk that cannot see at all.
- **Mock mode:** both live desks render a "needs the live API" panel and no filter row; there is no
  half-working fallback (D184). The ticket board says the mock "cannot speak its status vocabulary",
  which is the honest reason — the three words the mock knows are not three of the server's five.
- **Asking for someone else's desk:** on the drafting desk nothing is denied and nothing is hidden
  by the client - the server answers with your own rows (D44), and the picker offers only your desk
  so the result is never a mystery. The ticket board is stricter because `TicketService` is: asking
  for another desk returns 403 with `"You can only see the <team> queue."`, and the board prints
  that sentence rather than an empty table. (The old `?denied=` banner went with `TeamRoute`.)
- **Loading:** `OpsQueue` and the drafting desk both have explicit `loading | ready | error |
  offline` states. A read that fails shows the server's own sentence and a **Try again** button; it
  does not fall back to zero rows, because "no work" and "no answer" are different days.
- **A window, not a page:** the board reads the newest 100 tickets and pages through them in the
  browser. When the server's envelope total exceeds what was fetched it says so — *"Showing the 100
  newest of 342 tickets."* — rather than letting the tiles imply the count is the whole queue.
- **Unassigned display:** ticket shows "Unassigned"; a matter shows "Held by nobody" and must be
  *taken* deliberately - there is no auto-claim on open, because opening a matter to look at it is
  not the same as accepting it.
- **Checklist read failure:** says so, and explicitly does **not** render as an empty checklist -
  "nothing has been filed" is a fact about the customer, and getting it wrong sends a desk chasing
  documents it already has.
- **Missing / oversized files:** no document viewer today (`DocViewer` went with the retired desks);
  the checklist reports presence only. Viewing is a deliberate open gap.
- **Empty note / message:** `addNote` no-ops on blank input (`.trim()` guard).
- **Concurrency / staleness:** the ticket board read-modify-writes editable `localStorage` with no
  version check; last write wins. Service requests are server-side, and an invalid move is refused
  by the transition table with a 409 whose sentence reaches the screen.
- **Blank summary fallback:** `summaryOf` falls back across the allow-listed detail rows so a
  lightly-filled request never shows an empty summary.
