# Flow: Trust & Safety - Reports & Moderation

> The moderation queue for user-submitted reports against listings, users and flatmate posts: triage each report,
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
- **Routes:** `/admin/reports`. Tabs: `listings`, `users` and `posts`. Deep link `?open=<reportId>` opens the
  detail modal.
- **Tiles / triggers:** admin dashboard "open reports" signal; per-row actions (take down / suspend /
  resolve / dismiss / reopen); bulk resolve / dismiss bar.
- **Source components:**
  - `src/pages/admin/AdminReports.jsx` - queue, filters, single + bulk actions, detail modal.
  - `src/lib/data/reports.js` - `submitReport` (intake).
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
- **Reasons** are per-surface and exported from `src/lib/reportReasons.js`:
  `LISTING_REPORT_REASONS` (the modal's default, property listings), `SHARE_REPORT_REASONS`
  (Flatmates seeker/room/group posts), `OWNER_REPORT_REASONS` (owner profiles and chat). They lived
  in `src/components/ReportModal.jsx` until the reports slice; they moved because the ops queue and
  the http mapper need them too, and a services-layer module should not import from `components/`.
  A fourth, byte-identical copy of the listing set survived as `REPORT_REASONS` in
  `src/lib/data/reports.js` with no importers — deleted, because an unimported duplicate sitting in
  the file the mock writer calls is the one a future edit lands in.
- **The three-way mismatch is closed.** The admin filter used to carry its own hand-written
  moderation set (`fake`, `inaccurate`, `fraud`, `impersonation`, `offensive`, `spam`) — two of those
  codes existed in no vocabulary at all, so filtering by them always emptied the queue, and nine
  codes reports genuinely carry were unfilterable. It now derives its options from the two
  vocabularies above, per tab, and an inapplicable selection is *derived* away rather than cleared,
  so the tab never paints a frame filtered by a code its rows cannot carry — and returning to the
  original tab restores the filter. Labels are
  resolved the same way: `reportMapper.reasonLabel(reason, targetType)` indexes the vocabularies by
  target type, because `spam` on a listing ("duplicate listing"), on a flatmate post ("duplicate
  post") and from an owner ("irrelevant messages") are different complaints. Data-model
  inconsistency #7 is resolved.
- **The reporter is never named to the queue.** `ReportResponse` deliberately omits `reporterId`, so
  the http mapper resolves `reportedBy` to `''` and every live row falls back. The fallback reads
  **"Withheld"**, not "Anonymous": `reports.reporter_id` is NOT NULL and drives the duplicate index,
  so the platform knows exactly who filed the report — telling a moderator it was anonymous would
  suggest an unattributable complaint, which is a far easier one to dismiss. The string is rendered
  in four places (table column, detail drawer, mobile card and the CSV export, where a blank cell
  would read as missing rather than withheld); `admin/live-reports` asserts that "Anonymous" appears
  **nowhere** on the page, which is what caught the last two copies.
- **`kind` routing:** rooms, flatmate seekers and groups all report as `kind: 'share'` →
  `targetType: 'post'`, and land in the admin **posts** tab. That tab arrived late: the queue split
  its rows with `kind === 'listing' ? … : kind === 'user'`, so `share` rows matched neither branch
  and rendered in no tab at all. It was masked by an older bug in `Flatmates.jsx`, which sent
  `kind: 'user'` — wrong, but *visible*, under the owner vocabulary. Fixing the mapping is what made
  the reports vanish. `TAB_KIND` in `AdminReports.jsx` is now the single place the three-way
  correspondence is written down, so a fourth target type cannot be added without confronting it.
- Every new report starts `status: 'open'` with no action taken.

### 5.2 Triage states & moderator actions
The `act(id, status, actionTaken, enforcement)` handler (`AdminReports.jsx`) is the single mutation
path:
- Prompts for an optional internal note (`window.prompt`) and sends it to
  `PATCH /reports/{id}/triage` as `note`, where `ReportService.triage` records it on `report.triage`
  alongside the from-status, the to-status and the authenticated actor.
- Writes `{ status, handledAt: Date.now() }`, plus `actionTaken` when supplied; **reopening
  (`status='open'`) clears `actionTaken` back to `''`**.
- **No** `addInternalNote` and no `logAudit`. Both stood here once and both wrote a browser-local
  second copy of something the server had already stored under a real author. The note went under
  the key `report:<id>` in localStorage, which nothing ever read. `report` is one of the `note`
  domain's four entity families and the route is open to this screen, but nothing here calls it
  yet, deliberately: the triage record already carries the moderator's words for the decision
  itself, and a note here would be for something the triage record cannot hold — context that
  outlives the decision. Adding the panel is a product choice, not a gap in the plumbing.
- The server's answer is authoritative for `status` — `resolved` is stored as `dismissed`.

| Trigger | status | actionTaken | Effect |
|---------|--------|-------------|--------|
| Take down (listings tab) | `actioned` | `Listing taken down` | records the takedown decision |
| Suspend (users tab) | `actioned` | `User suspended` | records the suspend decision |
| Take down (posts tab) | `actioned` | `Post taken down` | `hide_content`, not `suspend_account` — a post is content, and its author may have done nothing worse than forget to delete it |
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
- **Tabs** split by `kind` via `TAB_KIND`: `listings → listing`, `users → user`, `posts → share`.
- **Filters:** status (`open|resolved|actioned|dismissed`), reason, date range, and free-text search
  over the whole record (`JSON.stringify(r).includes(q)`).
- **KPIs:** `open`, `listings`, `users`, `posts`, `closed` (status != open). The two partitions
  (`open + closed` and `listings + users + posts`) must total the same number; the live spec asserts
  it, and that arithmetic is what would have caught the missing posts tab.
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
