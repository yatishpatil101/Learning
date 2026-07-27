# Flow: Trust & Safety - Reports & Moderation

> The moderation queue for user-submitted reports against listings and users: triage each report,
> take action (take down a listing / suspend a user) or dismiss, and keep an audit trail.
> **Status:** documented from React source - **Primary role(s):** admin / manager (staff with the Reports module)

---

## 1. Purpose & user problem
- **Persona:** a Trust & Safety moderator handling community reports of fake, misleading, fraudulent,
  or spam content.
- **Job-to-be-done:** "Review what buyers reported, decide whether it is actionable, and act -
  take the listing down or suspend the user - without losing the paper trail."
- **Why it matters:** reports are the crowd-sourced signal that catches bad supply the automated
  verification queue missed. Repeated reports on one target are an escalation cue.

## 2. Entry points
- **Routes:** `/admin/reports`. Tabs: `listings` and `users`. Deep link `?open=<reportId>` opens the
  detail modal.
- **Tiles / triggers:** admin dashboard "open reports" signal; per-row actions (take down / suspend /
  resolve / dismiss / reopen); bulk resolve / dismiss bar.
- **Source components:**
  - `src/pages/admin/AdminReports.jsx` - queue, filters, single + bulk actions, detail modal.
  - `src/lib/data/reports.js` - `submitReport` (intake) + `REPORT_REASONS`.
  - Report intake UI: `src/pages/consumer/property/*` report modal (consumer side).

## 3. Actors & roles
- **Reporter = any signed-in user** (maker) who flags a listing/user from the consumer app.
- **Checker = admin / manager**, or a staff member with the `reports` module
  (`ModuleRoute moduleKey="reports"` + `FlagRoute flag="reports"`, inside
  `RoleRoute roles={['admin','manager']}` in `src/App.jsx`).
- Guards are UX-only (cross-cutting section 1).

## 4. Entities touched
- [`reports`](../../system/data-model.md) - **created** by `submitReport`, **updated** (`status`,
  `actionTaken`, `handledAt`) by the moderator.
- [`properties` / `users`](../../system/data-model.md) - the report's **target** (`targetId`,
  `kind`); acted on indirectly (take down / suspend) via their own admin flows.
- [`internalNotes`](../../system/data-model.md) (`internalNotes["report:<id>"]`) - **created**
  from the action prompt.
- [`audit_log`](../../system/data-model.md) - **created** on every action.

## 5. Business rules & logic  *(the meat)*

### 5.1 Intake (the report record)
`submitReport(...)` (`src/lib/data/reports.js`) unshifts a record into `db.reports`:
```
{ id: 'REP'+Date.now(), kind: 'listing'|'user', targetId, targetTitle, targetOwner,
  ownerMobile (digits), reason, reasonLabel, details, reportedBy, reporterMobile (digits),
  url, at: Date.now(), status: 'open', actionTaken: '', handledAt: 0 }
```
- **Reasons** come from `REPORT_REASONS` on the consumer side (`sold`, `fake`, `unavailable`,
  `pricing`, `spam`, `broker`, `other`); the admin filter also lists moderation reasons
  (`fake`, `inaccurate`, `fraud`, `impersonation`, `offensive`, `spam`). (Reason enums differ between
  intake and admin filter - see data-model inconsistency #7.)
- Every new report starts `status: 'open'` with no action taken.

### 5.2 Triage states & moderator actions
The `act(id, status, actionTaken)` handler (`AdminReports.jsx`) is the single mutation path:
- Prompts for an optional internal note (`window.prompt`).
- Writes `{ status, handledAt: Date.now() }`, plus `actionTaken` when supplied; **reopening
  (`status='open'`) clears `actionTaken` back to `''`**.
- If a note was entered: `addInternalNote('report', id, note, actionTaken || status)`.
- Always `logAudit('Reports', '<status> report <id>')`.

| Trigger | status | actionTaken | Effect |
|---------|--------|-------------|--------|
| Take down (listings tab) | `actioned` | `Listing taken down` | records the takedown decision |
| Suspend (users tab) | `actioned` | `User suspended` | records the suspend decision |
| Resolve | `resolved` | `Reviewed, no action needed` | closed, no action |
| Dismiss | `dismissed` | (unchanged) | closed as not actionable |
| Reopen | `open` | cleared to `''` | back to the queue |

> Note: the queue records the moderation **decision and audit**; the actual listing takedown /
> user suspension is executed through the property and user admin flows
> ([`property-verification.md`](./property-verification.md) flag/archive,
> [`users-kyc.md`](./users-kyc.md) suspend). The report row is the decision + evidence trail.

### 5.3 Escalation signal
`targetCounts` (a memoized `O(n)` map of `targetId -> report count`) flags targets reported multiple
times, so a repeat offender stands out even if each individual report looks minor.

### 5.4 Filtering, KPIs, and tabs
- **Tabs** split by `kind`: `listings` vs `users`.
- **Filters:** status (`open|resolved|actioned|dismissed`), reason, date range, and free-text search
  over the whole record (`JSON.stringify(r).includes(q)`).
- **KPIs:** `open`, `listings`, `users`, `closed` (status != open).
- Selection resets on any tab/filter change; the header checkbox selects all **open** rows only.

### 5.5 Bulk actions
- `bulkResolve` -> each selected `{ status: 'resolved', actionTaken: 'Bulk resolved', handledAt }`,
  then one `logAudit`.
- `bulkDismiss` -> each selected `{ status: 'dismissed', handledAt }`, then `logAudit`.
Both confirm via `window.confirm` first.

### 5.6 CSV / export & detail
The detail modal (`?open=<id>` or the Eye action) shows the full record for context before deciding.

## 6. Maker-checker / approval
- **Applicable: yes, in the report-as-proposal form.** The **reporter is the maker** who proposes an
  action ("take this down"); the **moderator is the checker** who approves it (`actioned`), declines
  it (`resolved` / `dismissed`), or defers (`reopen`). Approval fires the downstream side-effect
  (takedown / suspend) and writes an audit row. See
  [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 2.
- There is **no second-approver** on the moderator's action today - a single moderator both reviews
  and acts. A future backend can require a checker to approve high-impact takedowns (a true two-person
  rule), which is the natural place to add dual control.

## 7. State machine
```
open --(take down / suspend)--> actioned
open --(resolve)-------------> resolved
open --(dismiss)-------------> dismissed
actioned|resolved|dismissed --(reopen)--> open   (clears actionTaken)
```
- **Terminal:** `actioned`, `resolved`, `dismissed` - all re-openable back to `open`, which clears
  the recorded action.

## 8. Edge cases, validation & error states
- **Loading:** `<Loading />` until `all` resolves.
- **Empty queue:** table empty state.
- **Note is optional:** the prompt can be skipped; the action still logs to the audit trail.
- **Reopen resets action:** intentional - a reopened report has no decision, matching the persisted
  patch (`resolveAction`).
- **Bulk on open only:** the select-all header targets open rows, so bulk resolve/dismiss cannot
  accidentally re-close already-closed reports.
- **Duplicate reports:** multiple reports can target one entity; `targetCounts` surfaces the cluster
  but each report is triaged independently.
- **Concurrency:** shared store, last write wins; no locking.

## 9. Current mock implementation
- **Page + handlers:** `src/pages/admin/AdminReports.jsx`
  (`act`, `bulkResolve`, `bulkDismiss`, `updateReport`, `targetCounts`, `kpis`).
- **Intake + reasons:** `src/lib/data/reports.js` (`submitReport`, `REPORT_REASONS`).
- **List service:** `src/lib/mockApi/collections.js` (`listReports`, excludes archived by default).
- **Audit / notes:** `src/lib/mockApi/audit.js` (`logAudit`, `addInternalNote`);
  mutation via `mutateDb` (`src/lib/mockApi.js`).
- **Data/seed:** `src/data/reports.json` (fields: `id`, `kind`, `targetId`, `targetTitle`,
  `targetOwner`, `ownerMobile`, `deal`, `reason`, `reasonLabel`, `details`, `reportedBy`,
  `reporterMobile`, `url`, `at`, `status`, `actionTaken`, `resolution`, `handledBy`, `handledAt`).

## 10. Target API endpoints
Map to the [OpenAPI spec](../../../backend/src/main/resources/static/openapi/punenest-api.yaml) (tag: Moderation):
- `POST /reports` - reporter files a report (`submitReport`).
- `GET /reports?kind=&status=&reason=&q=&page=&size=` - moderation queue.
- **Deltas implied but not in the contract yet:**
  - `PATCH /reports/:id` - `{ status, actionTaken }` (the `act` handler; server should stamp
    `handledBy` + `handledAt` and, on `actioned`, trigger the linked takedown/suspend).
  - `POST /reports/:id/notes` - internal note.
  - `GET /reports/:id` - detail.
- `POST /admin/audit-log` - audit write.

## 11. Backend responsibilities
- **Authorize the checker** (admin/manager or Reports module) for reads and actions.
- **Execute the side-effect atomically:** an `actioned` report must actually take down the listing /
  suspend the user (call the property/user services in one transaction), not just label the report.
- **Stamp the actor:** set `handledBy`/`handledAt` server-side; never trust a client-supplied handler.
- **Enforce escalation policy server-side:** compute repeat-report counts and (optionally) require a
  second approver for high-impact takedowns.
- **Rate-limit and de-duplicate intake** so a target cannot be brigaded, and protect reporter PII.
- **Write audit + internal notes** immutably.
