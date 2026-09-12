# Flow: Admin Content, Localities & Societies

> The editorial + place-registry surface: homepage banners, FAQs, announcements and user-review
> moderation (Content page); community-locality promotion into the curated registry (Localities page);
> and the society directory with claims/residents/candidates moderation (Societies page).
> **Status:** documented from React source - **Primary role(s):** admin (Content, Localities, Societies modules)

---

## 1. Purpose & user problem
- **Persona:** a content/ops manager who owns what the public site says and which places it knows about.
- **Job-to-be-done:** "Publish and retire marketing content, moderate user reviews, keep the locality and
  society registries clean, and promote real community-submitted places into the canonical set."
- **Why it matters:** localities and societies are the spine of search, filters, SEO and pricing
  ([`../consumer/search-listings.md`](../consumer/search-listings.md)); banners/FAQs/announcements are the
  storefront; review moderation guards trust. Bad registry data breaks discovery everywhere.

## 2. Entry points
- **Routes:** `/admin/content` (tabs: banners, faqs, announcements, reviews), `/admin/localities`
  (tabs: pending, directory), `/admin/societies` (tabs: claims, residents, candidates, directory, moderation).
- **Tiles / triggers:** Content per-tab Add/Edit/Archive/Restore + review Approve/Reject; Localities 3 KPI
  cards (Localities / Pending review / Curated) that jump to a tab, plus per-row Verify/Dismiss; Societies
  per-tab decision buttons. Dashboard "New announcement" quick action links to `/admin/content`.
- **Source components:**
  - `src/pages/admin/AdminContent.jsx` - banners/faqs/announcements/reviews CRUD + archive + review moderation.
  - `src/pages/admin/AdminLocalities.jsx` - community-locality pending/directory + verify/dismiss.
  - `src/pages/admin/AdminSocieties.jsx` + `societies/*.jsx` - claims, residents, candidates, directory, moderation.

## 3. Actors & roles
- **Operator = admin** holding the relevant atoms (`content:*`, `localities:*`, `societies:*`).
  The seed custom role `CR_content` that used to bundle them was retired with the rest (D209): the
  bundles were a widening union the server could never honour, so they granted nothing.
- Content tabs are individually flag-gated (`content.enabled` gates the whole page; `content.banners`,
  `content.faqs`, `content.announcements`, `content.reviews` gate each tab). Localities/Societies have no per-tab flags.
- `by = user.name || 'Admin'` stamps verifications; guards are UX-only mock RBAC
  ([`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 1).

## 4. Entities touched
- [`banners`](../../system/data-model.md), [`faqs`](../../system/data-model.md),
  [`announcements`](../../system/data-model.md) - **read / created / updated / archived / restored**.
- [`reviews`](../../system/data-model.md) - **read / updated** (`status` publish/reject) / **archived / restored**.
- [`localities`](../../system/data-model.md) - **read** (curated + community); community records **updated** (`tier`) or **removed**.
- Societies: static `societies.js` catalog (**read**) plus localStorage-backed overlays (claims, resident
  requests, candidates, suggestions, reports, WhatsApp/location fixes) - **read / updated**.
- [`audit_log`](../../system/data-model.md) - **created** on every content/locality/society action.
  This console writes **no** internal notes. It did once, into a browser-side log it was also the
  only reader of; `AdminContent.jsx` carries the tombstone explaining why re-wiring a `window.prompt`
  to the live route's `reason` would have been worse than dropping it. Notes are their own domain
  now (`note`, four entity families, `notes:read` / `notes:write`) and `content` is not one of them.

## 5. Business rules & logic  *(the meat)*

### 5.1 Content - collections and blank templates
Tabs: banners, faqs, announcements, reviews. Blank templates:
- Banner: `{ title, sub, cta:'View', href:'/listings', theme:'teal', active:true }`.
- FAQ: `{ q, a, cat:'general', active:true }`.
- Announcement: `{ title, body, audience:'all', active:true }` (audience: all / owners / seekers / staff).
Each active/archived split is `filter(x => !x.archived)` vs `x.archived`.

### 5.2 Content - create / edit / active toggle
- **Save (new):** id = `` `${kind[0]}${Date.now()}` ``, appended, persisted via `saveCollection(col, list)`
  (`mutateDb(db => db[col] = list)`); audit `Added <kind> "<title|q>"` (sliced to 80 chars).
- **Save (edit):** merges `editData` into the matching id; audit `Updated <kind> <id>`.
- **Active toggle:** flips `active` in state and in the db item (banners/faqs/announcements) - controls public visibility.
- Modal fields: banner edits title/sub/cta/href/theme + active; FAQ edits q/a/cat; announcement edits title/body/audience + active.

### 5.3 Content - archive / restore (soft delete)
> **Historical.** The archive/restore controls below were localStorage-only and have been removed
> along with `archiveRecord` / `restoreRecord`; the optional `window.prompt` note they collected is
> gone with them. Kept as the record of what the mock desk did.
- **Archive:** `window.confirm` -> optional `window.prompt` note -> `archiveRecord(col, id, 'Archived by admin')`
  (sets `archived:true`, `archivedAt`, `archiveReason`), optional `addInternalNote(kind, id, note, 'Archived')`,
  local state flips `archived:true`; audit `Archived <kind> <id>`.
- **Restore:** confirm -> `restoreRecord(col, id)` (sets `archived:false`, `restoredAt`) + `addInternalNote(kind,id,'','Restored')`;
  audit `Restored <kind> <id>`. Archived items render in a dimmed "Archived" section, restore-only.

### 5.4 Content - review moderation
Reviews carry `status` (`pending` / `published` / `rejected`). Actions:
- **Approve:** set `status:'published'` (shown unless already published).
- **Reject:** set `status:'rejected'` (shown unless already rejected).
- **Archive / Restore:** same soft-delete as other content.
Row fields tolerate seed drift: author = `user || author || 'User'`, text = `text || body`, target/rating optional.
This is a lightweight moderation, distinct from property-review threads (`store/reviews.js`).

### 5.5 Localities - curated vs community tiers
- The registry = `allLocalities() = LOCALITIES (curated seed) + COMMUNITY (runtime)` from `src/data/localities.js`.
  Each record: `{ slug, name, lat, lng, tier: 'curated' | 'community', pincode?, source? }`.
  `slug` is the stable key (`slugifyLocality`: lowercase, non-alphanumerics -> `-`, trimmed).
- Community localities are **auto-minted** when a lister picks a place that matches no curated locality
  (`addCommunityLocality` also logs a `localityLead` of kind `auto`).
- KPIs: Localities = `directory.length`; Pending review = `pending.length`; Curated = `directory.length - communityCount`.

### 5.6 Localities - verify / dismiss (the promotion queue)
`pending = pendingCommunityLocalities()` = community-tier records awaiting review.
- **Verify:** `verifyCommunityLocality(slug, by)` flips the stored record to `tier:'curated'` with
  `verifiedAt`, `verifiedBy`, re-registers it in the live lookup maps (so search/SEO see it immediately);
  audit `Verified community locality <slug>`; toast "promoted to a curated locality".
- **Dismiss:** `dismissCommunityLocality(slug)` drops the record from the persisted community set (the
  in-memory registry keeps the slug resolvable until reload - harmless); audit `Dismissed community locality <slug>`.
- The directory tab lists every locality with tier badges (Curated/Community) and coordinates.
- Source chip on pending rows prefers the matching `localityLead.source` (`getLocalityLeads`), else `l.source || 'listing'`.

> Note: locality **editorial/SEO content** (rate/sq.ft, avg rent, demand index, focus) is not edited here -
> those fields live in `localities` and surface in Analytics (Geography/Pricing) and consumer locality pages.
> A comment in `AdminContent.jsx` records that "Localities & City Demand moved to Analytics".

### 5.7 Societies - directory + moderation queues
`AdminSocieties.jsx` merges the static `allSocieties()` catalog with a localStorage overlay
(`resolveSociety(slug)` = static record + admin overlay + derived claim status). Five tabs:
- **Claims:** society-admin claim requests. `setSocietyClaimStatus(slug, status, by)` sets the claim
  `status`; on `approved` it writes an overlay `{ claimStatus:'claimed', adminMobile, adminName }`.
  A claim by a different mobile is blocked while an existing claim is `pending`/`approved` ("exists").
- **Residents:** resident verification requests. `setResidentStatus(slug, mobile, status, by)` -> `verified`
  is blocked by a **unit conflict** guard (another verified resident already holds that `unitKey`) returning `'conflict'`.
- **Candidates:** community-submitted society candidates - `verifyCommunitySociety` (promote) or
  `mergeSocieties` (dedupe into an existing society), with a merge target picker via `searchSocieties`.
- **Directory:** the resolved catalog; edit overlay via `setSocietyOverlay`.
- **Moderation:** pending society **suggestions** (`applySocietySuggestion` / `dismissSocietySuggestion`),
  open **reports** (`moderateReport`), pending **WhatsApp** links (`moderateSocietyWhatsapp`) and
  **location fixes** (`moderateSocietyLocation`).
Each decision logs `Societies` audit and re-reads via a `bump` counter.

### 5.8 What MUST move server-side
- Publish/active/archive state for content (public visibility must be enforced server-side, not by a client `active` flag).
- Community-locality promotion (tier flip) and society verification/merge - these mutate the canonical
  registry that search/SEO depend on and must be transactional and authorized on the server.
- The unit-conflict and duplicate-claim guards must be enforced by the backend, not the browser.
- Society overlays currently live in localStorage - they must become real records with server ownership.

## 6. Maker-checker / approval
- **Content:** effectively single-actor publish/archive (no separate proposer/approver) - though review
  moderation (`pending -> published | rejected`) is a checker gate over user-generated content.
- **Localities:** a promotion gate - the community mint is the "proposal" (maker = the lister who created it),
  the admin Verify/Dismiss is the checker step; approval side-effect = tier `community -> curated` + registry re-registration.
- **Societies:** genuine maker-checker across claims, residents, candidates, suggestions and reports - users
  propose (claim/resident/suggestion), admin approves/rejects with side-effects (claim overlay, unit binding, merge).
  See the shared pattern in [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 2.

## 7. State machine
- **Content item (banner/faq/announcement):** `active <-> inactive`; orthogonal `archived (soft-deleted) <-> restored`. No hard delete.
- **Review:** `pending -> published | rejected` (re-decidable), plus `archived <-> restored`.
- **Community locality:** `community (pending) -> curated (verified)` [terminal for promotion] or `dismissed (removed)`.
- **Society claim:** `pending -> approved (claimed) | rejected`. **Resident:** `pending -> verified | rejected`
  (verify blocked by unit conflict). **Suggestion:** `pending -> applied | dismissed`.

## 8. Edge cases, validation & error states
- **Loading:** Content waits on localities + flags; Societies/Localities reload on a `bump` counter.
- **Module/tab gating:** `content.enabled` off -> "Content module is disabled" with Settings link; only flag-on tabs render.
- **Seed drift tolerance:** review/faq rows read `q||question`, `a||answer`, `text||body`, `user||author`.
- **Confirmations:** archive/restore use `window.confirm` (+ optional note prompt) - blocking browser dialogs.
- **Locality dismiss caveat:** the slug stays resolvable in-memory until reload after dismissal (documented, harmless).
- **Society guards:** duplicate claim (`'exists'`) and resident unit conflict (`'conflict'`) surface as error toasts.
- **Empty states:** "No banners/FAQs/announcements/reviews yet", "No community localities awaiting review", etc.
- **Concurrency:** shared store / localStorage, last write wins.
