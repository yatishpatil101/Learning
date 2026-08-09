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
  - Report intake UI: the shared `src/components/ReportModal.jsx`, reused by the property detail page
    (via a thin `src/pages/consumer/property/ReportModal.jsx` adapter), Flatmates posts, Messages,
    and the public owner profile. The modal takes a `reasons` prop, so each surface supplies its own
    vocabulary.

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
- **Reasons** are per-surface and exported from `src/components/ReportModal.jsx`:
  `LISTING_REPORT_REASONS` (the default, property listings), `SHARE_REPORT_REASONS` (Flatmates
  seeker/room/group posts), `OWNER_REPORT_REASONS` (owner profiles and chat). `REPORT_REASONS` in
  `src/lib/data/reports.js` is a leftover export with no importers. The admin filter still lists its
  own moderation reason set (`fake`, `inaccurate`, `fraud`, `impersonation`, `offensive`, `spam`), so
  the intake<->filter enum mismatch (data-model inconsistency #7) is now a three-way mismatch.
- **`kind` routing:** rooms report as `kind: 'listing'` (admin listings queue); flatmate seekers and
  groups report as `kind: 'user'` (admin users queue).
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
