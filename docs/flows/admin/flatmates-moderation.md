# Flow: Admin Flatmates Moderation (Seekers, Groups & Group Applications)

> The admin desk for the flatmate marketplace: moderate seeker requirements, share groups and the
> group applications addressed to owners - approve, flag or remove, with an internal note and an
> audit entry on every decision.
> **Status:** documented from React source - **Primary role(s):** admin (with the Flatmates module)

> **Retired (wave 2c part 3, 2026-08-15).** `AdminFlatmates.jsx` has been deleted and
> `/admin/flatmates` now redirects to `/ops/flatmate-review`
> ([`../ops/flatmate-moderation.md`](../ops/flatmate-moderation.md)), which does the same three jobs
> against the real API and also carries the host-verification queue this page never had. Everything
> below is kept as the historical record of what the mock desk did, and as the checklist the live
> desk was measured against - it is **not** a description of shipping behaviour.
>
> Three things about the old page are worth keeping in view, because they are why it was retired
> rather than converted:
>
> - **It could not see rooms at all.** Seekers, groups and applications were its three queues; a room
>   a consumer posted was invisible to it. The live desk moderates all three supply kinds.
> - **It had no view of the D72 publication axis.** `mod_status` was the only verdict it wrote, and
>   host verification - the tier badge, the tenant declaration, the owner-consent trail - had no
>   surface here whatsoever.
> - **`src/lib/groupApplications.js` no longer exists.** It was deleted in the same wave, because
>   until then nothing in the product could create a group application at all - the records this desk
>   moderated were two seeded rows in `localStorage`.

---

## 1. Purpose & user problem
- **Persona:** a trust-and-safety operator running the flatmate side of the marketplace.
- **Job-to-be-done:** "Find the fake, brokered or abusive share posts before a seeker meets a
  stranger through them, and clear the honest ones."
- **Why it matters:** Flatmates is where strangers agree to share a home. The consumer flow already
  hard-blocks the cheap abuse (share cap, address dedupe - see
  [`../consumer/flatmates.md`](../consumer/flatmates.md) section 5), so what reaches this desk is the
  judgement calls: a post that reads like a broker, a group that keeps re-listing, a report from a
  seeker.

> **Scope note (honest gap):** this desk moderates **seekers, groups and group applications only**.
> **Rooms** - now the primary "Move in now" supply, including every owner flat-split room - live in
> `localStorage` under `draazyRoomListings` (`lib/store/listings.js`), not in the mock DB this page
> reads, so they never appear here. Room-level verification happens in the Ops queue
> ([`../ops/service-queues.md`](../ops/service-queues.md) section 5.3). Unifying the two stores is a
> backend-to-build, called out in section 11.

## 2. Entry points
- **Routes:** `/admin/flatmates`, wrapped in `ModuleRoute moduleKey="flatmates"` then
  `FlagRoute flag="flatmates"` inside the admin role guard - so both the module and the tab flag must
  be on. Tabs are URL-bound via `useTabParam(['seekers', 'groups', 'apps'], 'seekers')`.
- **Tiles / triggers:** 4 KPI tiles (Seekers / Groups / Flagged / Applications); each except Flagged
  deep-links to its tab and is itself gated by an option flag. Per-row Approve / Flag / Remove.
- **Source components:**
  - `src/pages/admin/AdminFlatmates.jsx` - loader, KPIs, three tables + their mobile cards, actions.
  - `src/lib/adminModules.js` - the `flatmates` module entry (label, path, icon, `flagKey`).
  - `src/context/AdminFlagsContext.jsx` - `tab.flatmates` and the
    `flatmates.{seekers,groups,applications}` option flags (all seed `true`).
  - `src/lib/groupApplications.js` - **deleted (wave 2c part 3).** The group-application records
    this desk moderates now come from `flatmate_group_applications`, written by
    `POST /flatmates/groups/{id}/apply`.
  - `src/lib/mockApi.js` - `rawDb`, `mutateDb`, `logAudit`, `addInternalNote`.

## 3. Actors & roles
- **Operator = admin** with the `flatmates` module enabled. `ModuleRoute` handles the
  module gate; `FlagRoute` handles the tab flag.
- **Option flags** (`useAdminFlags().optionEnabled`) hide individual KPI tiles:
  `flatmates.seekers`, `flatmates.groups`, `flatmates.applications`. The **Flagged** tile is
  unconditional - the count that matters most is never hidden by configuration.
- Guards are UX-only mock RBAC ([`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 1).

## 4. Entities touched
- [`flatmate_requests` (seekers)](../../system/data-model.md) - **read** from `db.flatmateSeekers`
  (falling back to `db.flatmates` filtered by `kind === 'seeker'`); **updated** `modStatus`.
- **Share groups** - **read** from `db.flatmateGroups` (same fallback with `kind === 'group'`);
  **updated** `modStatus`.
- **Group applications** - **read** from `db.groupApplications || db.flatmateApplications`;
  **updated** `modStatus`. The owner-facing `status` (`pending`/`accepted`/`declined`) is **not**
  writable here - the owner owns that decision, admin owns moderation.
- [`audit_log`](../../system/data-model.md) - **created** on every action via `logAudit('Flatmate', ...)`.
- **Internal notes** - **created** via `addInternalNote('flatmate' | 'flatmate-app', id, note, status)`.

## 5. Business rules & logic  *(the meat)*

### 5.1 Two independent status axes
A group application carries **two** statuses and they must not be conflated:

| Axis | Field | Values | Owned by |
|------|-------|--------|----------|
| Owner decision | `status` | `pending` / `accepted` / `declined` | the flat owner |
| Moderation | `modStatus` | `live` / `approved` / `flagged` / `removed` / `rejected` | this desk |

Seekers and groups have only the moderation axis. `modStatus` is **absent** on an untouched record
and reads as `live` everywhere (`MOD_LABEL[x] || 'Live'`), so a never-moderated post is not a
special case.

### 5.2 Actions (`act` / `actApp`)
Three actions, offered only when they would change something:
- **Approve** - shown only when `modStatus` is not already `live`/`approved`. Seekers and groups are
  approved back to `live`; applications are approved to `approved`.
- **Flag** - shown unless already `flagged`. Keeps the post visible but marks it for follow-up.
- **Remove** - shown unless already `removed`.

`flagged` and `removed` prompt for an optional internal note (`window.prompt`) before writing, since
those are the two decisions a colleague will later need explained. Every action then writes the
status, records the note if given, logs an audit entry, reloads and toasts. There is **no undo** and
no confirmation on Remove.

### 5.3 KPIs
- **Seekers** / **Groups** / **Applications** - collection lengths, each behind its option flag and
  each deep-linking to its tab.
- **Flagged** - `modStatus === 'flagged'` across seekers **and** groups combined (applications are
  excluded). It is a count, not a link - there is no "flagged" filter view.

### 5.4 What each table shows
- **Seekers:** name + id (`· demo` for seeded rows), gender, budget, localities, the seeker's
  identity **Verified** badge (read-only here - it is the shared DigiLocker badge, ADR-009a), and
  moderation status.
- **Groups:** title + id (`· applied to flat` when the group targets a listing), locality, `policy`
  as "Women only / Men only / Anyone", **per-head** rent (`rent / seatsTotal`, falling back to the
  whole rent when seats are unknown), members `n / seatsTotal`, and moderation status.
- **Applications:** group title + applicant, the target listing, per-head rent, members
  `n / seatsTotal`, the **owner decision** badge, and the **mod status** badge.

### 5.5 Responsive dual-render
Every table renders twice: a stacked card list below `sm` and the real table above it, so the
moderation buttons are never clipped off-screen on a phone. Both copies are in the DOM at all times -
see the design system's responsive dual-render note.

## 6. Maker-checker / approval
This desk is **not** a maker-checker loop: an admin acts unilaterally and the change is immediate.
The two real approval loops in the flatmate domain live elsewhere:
- **Ops flatmate verification** (host proposes -> Ops approves) -
  [`../ops/service-queues.md`](../ops/service-queues.md) section 5.3.
- **Host request approval** (seeker asks -> host decides) -
  [`../consumer/flatmates.md`](../consumer/flatmates.md) section 6.

The audit entry + internal note are the accountability substitute here; a second-approver step is a
backend-to-build (section 11).

## 7. State machine
```
Seeker / Group:      live --flag--> flagged --approve--> live
                       \--remove--> removed --approve--> live

Group application:   modStatus: live --flag--> flagged --approve--> approved
                                     \--remove--> removed
                     status (owner):  pending --owner decides--> accepted | declined
```
- **Terminal:** none. Every moderation state is reversible via Approve.

## 8. Edge cases, validation & error states
- **Module or flag off:** the route never renders - `ModuleRoute` / `FlagRoute` intercept first.
- **Legacy single collection:** if `db.flatmateSeekers` / `db.flatmateGroups` are absent, the loader
  falls back to a single `db.flatmates` collection split by `kind`.
- **Status write scans three collections:** `setFlatStatus` looks in `flatmateSeekers`,
  `flatmateGroups`, then `flatmates`, and stops at the first id match - so one action works
  regardless of which shape the DB is in.
- **Seed rows are moderatable.** Demo records are labelled `· demo` but are not protected.
- **Empty note:** `window.prompt` cancelled or blank writes no note; the status change still applies.
- **Rooms are invisible here** (see the scope note in section 1) - a report against a room routes to
  the admin **listings** queue, not to this page.
