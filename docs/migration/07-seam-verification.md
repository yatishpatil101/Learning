# Seam Verification — proving the live app actually works, page by page

**Status:** Not started. Opened 2026-08-30, after the first hands-on session against live APIs
since the migration began.
**Trigger (verbatim):** *"I am seeing lot of issues in API and UI screen, functionalities. I want
to check each page one by one if they are working as expected, I cannot totally rely on the e2e
set."*

> **This is a verification plan, not a defect list.** Confirmed defects go to
> `tasks/todo.md` → "Needs attention" (the existing register); product calls go to
> `tasks/DECISIONS-NEEDED.md` as a numbered row. This file owns the **method** and the
> **route ledger** — what has been swept, and what the sweep is required to look at.
> Duplicating a defect here and there guarantees one copy rots.

---

## 1. Why the e2e suite is not the answer to this question

The live suite is 1,935 tests over 283 files and it is green. The app is visibly broken.
Both statements are true, and the reason is structural, not a gap in diligence:

**Almost every spec written before the mock was deleted was written against the mock.** A
mock-backed test stores the client's own vocabulary and hands it back, so both sides of the seam
agree with themselves and the test passes on a feature that has never once worked against the real
server. Five instances of exactly this are already on record — `semi` vs `semi-furnished`,
`name` vs `label`, `name` vs `ownerName`, `source` vs `mintOrigin`, a queue filtering on `l.real`
which no mapper emits. The suite cannot see this class of bug **by construction**; it is not
that it missed them.

The second reason is coverage shape: specs assert that a page *renders* and that a *happy path*
completes. They rarely assert that a displayed number is the number the server sent, and they
almost never assert that an empty state is genuinely empty rather than a predicate ANDing a field
that arrives `undefined`.

So the sweep's job is the thing the suite structurally cannot do:
**compare what the screen says against what the wire actually carried.**

---

## 2. The four failure signatures to hunt

Every defect this migration has produced so far belongs to one of four families. Knowing them
turns "click around and see" into a search with a target.

### A. Confident zero
A count, a total, an average or a list renders `0` / `—` / "No X yet" **with full confidence** —
no error, no spinner, no retry affordance. Cause is almost always a predicate or a formatter
consuming a field the mapper never emits: `items.filter(x => x.real)` where `real` is `undefined`
on every row, or `` `${n || 0}` `` turning *unknown* into *all clear*.

**This is the single most dangerous signature**, because an empty state is indistinguishable
from a correct empty state. Treat every zero as guilty until the raw JSON acquits it.

### B. Vocabulary drift
The same concept spelled differently on each side. Three sub-shapes, in ascending nastiness:

1. **Different word, same field** — `semi` vs `semi-furnished`. Symptom: a `422` the user cannot
   act on, a filter matching nothing, or a raw wire string rendered as a label.
2. **Partially matching enum** — the majority of members agree, so the field *looks* mapped and
   nobody re-checks. Enumerate **every** member, never a sample.
3. **Same word, different field** — the store's `source` is the server's `mintOrigin`, and the
   server's `source` is something else. Compiles, reads naturally, and is wrong for exactly the
   rows the field exists to distinguish. Only caught by reading the **writer** on each side.

### C. Silently dropped write
The form collects a field; a whitelist between the form and the wire discards it; the toast says
saved. `toListingUpdate` does this today with `bhk`. **Only a reload catches it.**

### D. Dark surface
The UI reads a field no `http` mapper produces — `PropertyResponse.adminPipeline` has six readers
and no mapper. The component renders its fallback branch forever and looks merely quiet.

---

## 3. Preconditions — do these once, before any page is opened

Skipping these does not save time; it produces findings that have to be re-diagnosed later.

- [ ] **Prove the JVM is not stale.** Compare the running JVM's `StartTime` against the newest
      mtime under `backend/src/main`. This has been misread as a code defect twice. Spring
      **silently ignores unknown query parameters**, so a new facet hitting a stale JVM returns
      the whole table with a `200` — it *fails open*, which reads as "the filter is broken"
      rather than "you are talking to yesterday's build".
- [ ] **Confirm the lane.** BASE_URL + API_PORT + E2E_DB_NAME + E2E_DB_URL + Maven
      `-DbuildDirName` all belong to this session. Any other session's `npm test` resets the
      shared DB at run start.
- [ ] **Baseline the user count.** Exactly **88** users, or the DB is contaminated and every
      count on every screen is untrustworthy.
- [ ] **`[MOCK OTP]` must not appear in the backend log.** If it does, stop.
- [ ] **Fetch `GET /flags` once and write the result down.** Eleven routes are flag-gated
      (§5). A disabled flag redirects, and a redirect looks exactly like a broken page. Do not
      file a finding against a flag-gated route without knowing its flag state.
- [ ] **Record the pre-existing red.** Run the backend Maven suite and `npm run check` once and
      write down what is *already* failing. There is no backend job in CI, so nothing has been
      gating the Java tests — some of it may have been red for weeks. Without this you cannot
      attribute anything.

---

## 4. The per-page protocol

Four checks per page. A page is not swept until all four are done; a page that "looked fine"
without them is not evidence of anything.

1. **Network + Console open.** Any `4xx`/`5xx` or console error is a finding **even if the page
   looks correct** — a swallowed failure is a defect in its own right (`PropertyReviewModal.jsx:391`
   returns `null` on a failed load, making it identical to a dismissed click).

2. **Interrogate every empty state.** For each `0`, `—`, blank list or "No X yet": open the
   request in the Network tab and read the raw response. If the server sent rows and the screen
   shows none, that is signature **A**. If the server sent nothing, ask whether it *should* have —
   the seed is a documented fixture contract, so "the seed has no data for this" is itself a
   finding when the fixture says otherwise.

3. **Pick one displayed value and trace it to the JSON.** One per page is enough. If the field
   is not in the response body, the UI is inventing it (signature **D**). If it is present but
   spelled differently, that is **B**. This single check has the highest yield per minute of
   anything in this document.

4. **Every write: submit → hard reload → verify it persisted.** Not the toast, not the optimistic
   row — the reload. This is the only check that catches **C**. Where a write has multiple fields,
   change *all* of them in one submit; a whitelist drops a subset, so changing one field at a time
   can miss it.

**Additional pass for list pages:** compare the rendered row count against the response's total.
`spring.data.web.pageable.max-page-size=100` is a known ceiling that presents 100 rows as the
whole catalogue.

---

## 5. Route ledger

**71 page routes + 12 redirect-only routes.** Sourced from `frontend/src/App.jsx` (lines 188–381)
on 2026-08-30 — if the router changes, re-harvest rather than trusting this table.

Legend: **🏳** = behind an `AppFlagRoute`/`FlagRoute` (confirm flag state before filing) ·
**🔒** = `ProtectedRoute` · **👤** = `RoleRoute` · **📦** = `ModuleRoute` ·
**↪** = redirect only (verify it *redirects*; there is no page to sweep).

### Wave 1 — Money and trust
Swept first because a failure here costs revenue or leaks data, not just credibility.

| Route | Guard | Watch for |
|---|---|---|
| `/signin` | — | Live API exposes no "does this mobile exist?" oracle and **auto-registers on first verified login** — that is by design, not a bug |
| `/staff-login` | — | Role assignment on the returned session |
| `/signup` | 🏳 `signupsEnabled` | |
| `/property/:id` | — | The contact gate; **`flagReason` is currently served anonymously** (known) |
| `/list-property` | 🔒 | Wizard field survival — reload after post and diff every field against what was typed |
| `/checkout` | 🔒 | Deferred Cashfree session is **not returned by later reads** and has no resume/cancel (known) |
| `/plans` | — | Price and entitlement values traced to JSON |
| `/pay-rent` | 🔒 | |
| `/schedule-visit` | 🏳 `scheduleVisit` + 🔒 | |
| `/view-documents/:requestId` | 🔒 | |
| `/shared-documents` | — (token in fragment **is** the credential) | Confirm the fragment never reaches a server; `X-Share-Token` header only |

### Wave 2 — Public discovery
Highest traffic, and where confident zeros hide most comfortably as "no results".

| Route | Guard | Watch for |
|---|---|---|
| `/` | — | Every rail: an empty rail is signature **A** until the JSON says otherwise |
| `/listings` | — | Every filter facet, one at a time, against the raw response. **Enumerate enum members** |
| `/listings?view=map` | — | Map pins vs list count |
| `/owner/:id` | — | Browser-side review averaging still lives here (known) |
| `/societies`, `/society/:slug` | — | `photoUrl` receives a preview object where a URL string is expected (known) |
| `/society` | 🏳 `societySaaS` | |
| `/locality`, `/locality/:slug` | — | Browser-side review averaging (known) |
| `/flatmates` | — | Heterogeneous list — properties + posts + groups + rooms share one array; check nothing keys off `list[0]` |
| `/reels` | — | |
| `/saved` | 🏳 `savedListings` | Renders on-device shortlist while signed out **by design** |
| `/compare` | 🏳 `compareProperties` | |
| `/emi-calculator` | 🏳 `emiCalculator` | Pure client maths — low risk, sweep last in this wave |
| `/services` + 6 landing pages | — | Sign-in is enforced at the *action*, not the page |
| `/help` ×3 languages (6 patterns each) | — | FAQ endpoint answers `[]` and the list has **no `Sort`** — heap order (known) |
| `/privacy`, `/terms`, `/refund-policy`, `/disclaimer`, `/contact` | — | Static; a fast pass |
| `*` (404) | — | Confirm the `Stub` still says something sensible |

### Wave 3 — Signed-in self-service

| Route | Guard | Watch for |
|---|---|---|
| `/dashboard` | 🔒 | Recent searches now server-owned (V121) — confirm cross-context |
| `/owner-hub/property/:id` | 🔒 | Rent receipts are immutable snapshots (V120) |
| `/tenant-profile` | 🔒 | |
| `/notifications` | 🔒 | `puneNestNotifications` was write-only and is gone — this must now be genuinely server-backed |
| `/messages` | 🏳 `inAppMessaging` + 🔒 | `pnConversations` was read-only and is gone |
| `/refer` | 🔒 | |
| `/support` | 🔒 | |
| — inside dashboard | | `MyListingsPanel.jsx:258` calls `sendWhatsappTemplate`, which **403s for owners** (known) |
| — document vault | | `PersonalDocument.sizeBytes` nullable → renders "0 bytes"; `EvidenceUpload` caps at 2 MB vs vault's 10 MB (known) |

### Wave 4 — Back office
Last: damage is contained, and staff can report what they hit.

| Route | Guard | Watch for |
|---|---|---|
| `/admin` | 👤 admin | |
| `/admin/properties` | 📦 `properties` | **100-row ceiling presented as the whole catalogue**; `toListingUpdate` drops `bhk` (both known) |
| `/admin/users` | 📦 `users` | |
| `/admin/analytics` | 📦 + 🏳 `analytics` | Verify the `mockApi` gate at `AdminAnalytics.jsx:35`/`:59` is actually gone post-P5c |
| `/admin/finance` | 📦 + 🏳 `finance` | Ledger queue item 20 |
| `/admin/reports` | 📦 + 🏳 `reports` | |
| `/admin/services` | 📦 `services` | **No admin write route** for services content (known) |
| `/admin/enquiries` | 📦 `enquiries` | |
| `/admin/content` | 📦 `content` | Banners cannot round-trip; announcements have no write route (known) |
| `/admin/societies` | 📦 `societies` | Cross-society residents queue **has no backend route**; `societies:write` bypassable on the residents decision path (both known) |
| `/admin/localities` | 📦 `localities` | |
| `/admin/team` | 📦 `team` | |
| `/admin/settings` | 📦 `settings` | Flag toggles — the source of truth for every 🏳 above |
| `/admin/post-on-behalf` | 📦 `postOnBehalf` | |
| `/admin/staff-activity` | 📦 `staffActivity` | |
| `/ops` | 👤 staff\|admin | |
| `/ops/requests` | 👤 | `adminPipeline` is unmapped — **six back-office readers are dark** (known) |
| `/ops/support` | 👤 | |
| `/ops/drafting-desk` | 👤 | Sweep all five `?type=` values; rental-desk ticket must arrive from the **payment webhook** |
| `/ops/referrals` | 👤 | |
| `/ops/flatmate-review` | 👤 | Four moderation jobs merged here from the deleted admin desk |

### Redirect-only routes — verify the redirect, no page to sweep

`/map` → `/listings?view=map` · `/share-flat` → `/flatmates` · `/docs` → `/help` ·
`/help-center` → `/help` · `/owner-hub` → `/dashboard#owner-hub` ·
`/admin/support` → `/admin/services` · `/admin/flatmates` → `/ops/flatmate-review` (guards must
still refuse) · `/ops/{rent-agreement,legal,interior,packers,valuation}` → `/ops/drafting-desk?type=…`

---

## 6. Do not re-file these

`tasks/todo.md` → "Needs attention" already carries ~15 confirmed live defects, and the M3–M7
backend gaps are recorded there too. **Check a symptom against that register before filing it.**
The highest-severity open item, for reference, is the **co-fill document blocker**: request
documents project bearer download URLs to every accepted party, so one party can obtain the
other's KYC. That ships with per-party ownership/visibility and an integration test proving the
refusal — not before.

---

## 7. What a finding looks like

A symptom without the raw response gets re-diagnosed from scratch next session, so the record is
fixed-shape and short:

```
ROUTE   /admin/properties
DO      Edit a listing's BHK from 2 to 3, save, reload
SEE     Toast says saved; row still reads 2 BHK
WIRE    PATCH /admin/properties/{id} body: {"title":"…","rent":…}   ← no bhk key
CLASS   C (silently dropped write)
```

`CLASS` is the §2 signature. It matters because the classes have different fixes: **A** and **D**
are mapper gaps, **B** is a translation table, **C** is a whitelist. Grouping by class means one
fix often closes several findings — and if a class starts filling up, the right move stops being
"fix these" and becomes "audit that mapper end to end".

---

## 8. Exit criteria

- [ ] All 71 page routes swept under §4, with flag-gated routes swept in their **enabled** state.
- [ ] All 12 redirects confirmed.
- [ ] Every finding either fixed, or filed in "Needs attention" / `DECISIONS-NEEDED.md` with its class.
- [ ] Every **fixed** finding has a live spec asserting the wire value, plus an `e2e/COVERAGE.md`
      row. A fix without a spec is a regression waiting for the next refactor — and the spec must
      assert against the **server's** vocabulary, not the client's, or it reproduces the blindness
      that caused this exercise.

---

## 9. Relationship to the mapper audit

Signatures **A**, **B** and **D** are all discoverable **without a browser**, by diffing each of
the 21 `frontend/src/services/providers/http/*Mapper.js` files against the DTO it maps to. That
audit is cheaper per defect than clicking, and it should run **in parallel** with — ideally
slightly ahead of — Wave 1. Findings it produces are the same four classes and belong in the same
register.

The sweep remains necessary regardless: the mapper diff cannot see a field that is mapped
correctly and then *used* wrongly, and it cannot see a broken flow.
