# 05 — Move business logic to the backend; keep the UI thin

**Owner requirement (verbatim):** *"I want to make sure all business logic gets migrated/shifted to
backend. UI should be kept lightweight and heavy lifting should be done in backend only."*

This is the deepest workstream in the migration. It is **not** the same as retiring the mock.
Retiring the mock swaps *where data comes from*; this swaps *where decisions are made*. A domain can
be fully on the `http` provider and still compute its business rules in the browser — that is the
state of several domains today.

## The rule for what moves

Apply in order; the first that matches decides.

| Test | Verdict |
|------|---------|
| Could a user change the answer in their favour by editing client state? (access, price, gating, permissions, eligibility) | **Backend — mandatory.** Security, not preference. |
| Does the answer need to be the same for everyone, or drive sort/filter/pagination? (scores, ranking, freshness, featured) | **Backend.** A client-computed rank cannot be paged or sorted server-side. |
| Is it a state machine or workflow with transitions and audit? (service requests, deals, KYC, applications) | **Backend.** The server owns the transitions; the client renders the current state. |
| Is it money — amounts, fees, ledgers, receipts, tax? | **Backend.** Never compute money twice in two languages. |
| Is it pure presentation — formatting, layout, animation, i18n, haptics, image sizing? | **Frontend.** Leave it alone. |
| Is it derived purely from data already on screen and has no server referent? | **Frontend.** e.g. the `staged` boolean in `lib/chat.js` (D52) — correctly client-side. |

**Corollary the UI must obey:** if the backend computes it, the API returns it as a **field**, and
the component **renders that field**. No re-deriving in the browser. A component that recomputes a
server value has re-forked the logic.

## Ponytail discipline for this workstream (mandatory)

Per the owner's instruction, the [ponytail](../../README.md) ladder governs every move here. The
single most important rung:

> **Rung 1 — does this need to exist at all?** Before porting any `lib/*` calculation into Java,
> check whether the API **already returns it**. The contract is 126 paths / 160 operations. Several
> of these calculations were written because the mock had no server, not because the server lacks
> the field. **The lazy migration for most of these files is: delete the file, read the field.**

Order of preference for each item:

1. API already returns it → **delete the client code, bind the field.** (Most common outcome.)
2. Server has the data but does not expose it → **add the field to an existing DTO.** No new endpoint.
3. Neither → add the smallest server-side computation, on an existing endpoint. New endpoint is the
   last resort and needs an OpenAPI change.

Do **not** build a "rules engine", a strategy interface, or a shared calculation framework. One
implementation, in the service that owns the entity.

## Inventory of `frontend/src/lib/` (~50 files)

Classified by the rule above. ⚠️ Items marked _verify_ are inferred from filename/role and must be
confirmed against the code and the OpenAPI contract before action.

### A. Business logic — **move to backend**

| File | Concern | Likely disposition |
|------|---------|--------------------|
| `permissions.js` | RBAC / who may do what | ~~**Security-critical.** Server must enforce~~ — **audited: already enforced** (16 atoms, two fences per route). Client speaks a vocabulary V61 deleted. No port; see [Audit result](#audit-result--neither-needs-a-port-both-are-already-enforced-server-side). |
| `contact.js` | Contact-gate logic | ~~**Security-critical.** Gate decision is the server's~~ — **audited: already is.** Gate functions are mock-only and retire with the mock provider. Helpers stay (column B). |
| `qualityScore.js` | Listing quality score | Confirm API field; delete client copy. Drives admin badge (`QualityScoreBadge`). |
| `featured.js` | Featured/boost selection | Must be server-side to be sortable/pageable. |
| `freshness.js` | Listing freshness | Server field; also drives search ranking. |
| `rentPay.js` | Rent payment math | Money → backend. |
| `rentReceipt.js` | Receipt generation | Amounts backend; PDF/render may stay client _verify_. |
| `serviceFlow.js` | Service-request state machine + `defaultDocs()` checklist | Server owns statuses (nine, per V75) and the checklist. Client renders. |
| `groupApplications.js` | Flatmate group application rules | Backend workflow. |
| `kycTrack.js` | KYC progress/state | Backend (KycProvider owns truth). |
| `photoRequests.js` | Photo request workflow | Backend workflow. |
| `leadNotes.js` | Lead notes | Backend persistence _verify_. |
| `visitWhen.js` | Visit scheduling windows | Backend availability rules _verify_. |
| `searchEntities.js` | Query parsing → search entities | Backend, so search behaves identically for every client _verify_. |
| `commuteCache.js` | Commute results caching | Backend (Google Routes seam lives there); also the natural home for a cache. |
| `nearParams.js` | Geo/radius params | Backend query construction _verify_. |

### B. Presentation / platform — **stay in the frontend**

`format.js` · `chrome.js` · `haptics.js` · `share.js` · `imgSrcSet.js` · `timeOfDay.js` ·
`openDoc.js` · `contentLang.js` · `constants.js` · `geoConfig.js` · `mapsConfig.js` · `help.js` ·
`helpUrl.js` · `useHelp.js` · `useHelpSeo.js` · `hooks.js` · `usePullToRefresh.js` ·
`useScrollReveal.js` · `useSheetViewport.js` · `useSwipeDismiss.js` · `useTabParam.js` ·
`useSocietyCatalogue.js` · `store.js` + `store/` (client UI state) · `auth.js` / `authIntent.js`
(client session handling, not authorisation) · `chat.js` (the `staged` derived boolean) ·
`assistant/` · `places.js` _verify_ · `csv.js` (client-side export of data already on screen) ·
`adminModules.js` (registry/config) · `pmf.js` (overlay flag) · `hash.js` _verify — if used for any
security purpose it moves_.

### C. Mock scaffolding — **delete in Phase 5**

`mockApi.js` · `mockApi/` · `persist.js` _verify_ · `frontend/src/data/db.json` (the mock database)
· `services/providers/mock/*` · the Vite `persistPlugin` dev route.

> **Correction to earlier drafts:** `seriousBuyer.js` **does not exist** in the codebase. It was
> carried over from stale notes. If a serious-buyer signal is wanted, it is a *new backend feature*,
> not a migration — and per ponytail rung 1, it should not be built until someone asks for it.

## Backend-side consequences

- **DTO growth, not endpoint growth.** Most of column A becomes extra fields on DTOs that already
  exist. Update `punenest-api.yaml` in the same change — the contract is law, and
  `SpecSchemaParityTest` will catch drift.
- **Ranking moves into the query.** `featured` / `freshness` / `qualityScore` becoming server-side
  means search ordering becomes a SQL concern, not a post-fetch client sort. This is what makes
  pagination correct for the first time.
- **Caching becomes load-bearing.** There is **no caching layer today** (no `@EnableCaching`,
  `@Cacheable`, Redis or Caffeine). Moving heavy lifting server-side puts every one of these
  computations on an uncached Postgres. Flagged in the master plan; measure before adding — per D133
  the standing instruction is *measure the real call count first*, and per ponytail, no cache until
  a profiler says so.
- **`spring.jpa.open-in-view=false`** is already set, so any new computation must load what it needs
  inside the service transaction or it will throw `LazyInitializationException`.

## Bundle-size payoff (and its constraint)

Deleting column A shrinks the client. Current budget headroom is thin — `check:size` had ~1.8 KB of
headroom during wave 14, and the bundle sits at ~437.6 KB after the async provider glob (D208). Each
`lib/*` deletion buys headroom back, which is the argument for doing this **before** any new UI work.

## Migration recipe (per file)

1. Grep every consumer of the file (`vscode_listCodeUsages` / `grep_search`).
2. Check the OpenAPI contract for an existing field that already answers it. **Stop here if found.**
3. If absent: add the field to the owning DTO + service; update `punenest-api.yaml`; add the one
   check that fails if the logic breaks (ponytail: one runnable check, not a suite).
4. Replace consumers with the field. Delete the `lib/` file.
5. Update the domain's e2e spec to assert the rendered field ([04-modules.md](04-modules.md)).
6. Verify: `npm run check` (lint + i18n + help + finance + listing + cycle), `npm run check:size`,
   backend `mvnw test`, then the domain's spec.
7. Review per AGENTS.md: `react-reviewer` → `code-reviewer` → `security-reviewer` for
   `permissions`, `contact`, `kycTrack`, and anything touching money.

## Sequencing

Do this **per domain, immediately after that domain's provider migration** in
[04-modules.md](04-modules.md) — not as a separate big-bang pass. The domain is already open, its
spec is already being rewritten, and the field additions ride along in the same contract change.

**Exception — do these two first, out of order:** `permissions.js` and `contact.js`. They are
authorisation decisions currently computed client-side; that is a security finding, not a tidy-up.

### Audit result — **neither needs a port.** Both are already enforced server-side.

Running this file's own first checklist item against the contract before writing Java answered
"don't". Recorded here because the paragraph above, read alone, instructs work that must not happen.

**`permissions.js` — the server has a stricter model than the one this file describes.**
`security/BackOfficePermissions.java` defines 16 `module:action` atoms, and each route carries
*two independent fences*: `ADMIN_ONLY + " and " + BackOfficePermissions.REQUIRE_USERS_WRITE`. A
stored grant is intersected with a per-role baseline, so a permission document may only ever
**narrow** — it cannot grant above the role. `GET /admin/permission-catalogue` serves the vocabulary
and `GET`/`PUT /users/{id}/permissions` the per-account document.

The client file is not a mirror of that model — it speaks a vocabulary the server **deleted**.
`customRoles`, `roleId`, `moduleAccess` and `properties:verify` were removed in migration V61
(D67/D13); `PUT /admin/settings` now answers **422** for `customRoles` rather than accepting it.
The repo already says so in `providers/mock/teamProvider.js`: *"Console-local, and unwired to
`PUT /users/{id}/permissions` on either provider. They compose a widening union while the server's
permission map may only narrow (D67), so they are navigation tidying, not access."*

So there is no escalation to close — on live API `customRoles` is `[]` and `moduleAccess` is
undefined, making the client fail *closed*. The defect is the opposite of the one assumed: the
console cannot render the real permission model at all.

**`contact.js` — the gate is already the server's, and already quarantined.**
`providers/http/contactProvider.js` is complete (`/contacts/status`, `/contacts/request`,
`/me/contact-requests`, `…/pending-count`) and imports exactly one thing from `lib/contact.js`: the
frozen `NO_CONTACT_GATE` default. No localStorage reaches live mode. Every gate function
(`contactStatus`, `requestContact`, `setContactStatus`, `pendingContactCount`, owner prefs) is
imported **only** by `providers/mock/contactProvider.js`, so it retires with that file in
[04-modules.md](04-modules.md) — `git rm`, not a port. The helpers `digits`, `maskPhone`,
`fmtPhone`, `isFullMobile` and `myMobile` are presentation/validation used by ~15 modules and stay
(column B).

**What actually remains, and it is not security-critical:**

1. `context/AdminFlagsContext.jsx` imports `getCustomRoles` from `lib/mockApi.js` **directly**,
   bypassing the service seam — so the admin console reads access config from `db.json` even in
   live mode. This is a [04-modules.md](04-modules.md) seam violation, not a [05](05-logic-to-backend.md) port.
2. The Team & Access grid should render from `GET /admin/permission-catalogue` — which exists
   precisely so *"a screen cannot offer a permission the server would ignore"*. Rewiring the admin
   console's access model is an architectural change and is **not** started here; it needs its own
   decision, recorded in [README.md](README.md) open decisions.

## Closed: driving the DigiLocker grant from a test

Surfaced converting `platform/auth/verify-funnel` in P5b wave 1. The mock grants the Verified badge
inline, so the spec could assert the rendered pill. Live, `POST /me/verification/aadhaar` answers
**202 with a hosted consent URL** and `MockKycProvider` issues `https://mock.kyc.local/verify/<ref>`
— a host that does not resolve. The badge is granted only when the signed webhook lands.

The converted spec asserts the inverse and stronger property — **starting grants nothing** — which
is the one worth having, since a client that could talk itself into a trust badge is a security
defect. The render half was then recorded here as an open item with three suggested routes to
closing it.

**That entry was wrong, and how it was wrong is the useful part.** One of the three routes — a
dev-profile endpoint that finishes the flow — already existed and had existed since D122:
`POST /me/verification/aadhaar/simulate`, on the `@DevOnly` `DevVerificationController`, built for
exactly this reason ("in http/dev mode a user can start verification but never finish it"). It was
found by reading `VerificationService` for an unrelated question. The doc had been written from the
frontend's view of the problem, where the endpoint is invisible because nothing in the UI calls it —
and nothing ever will, since having no UI is the point.

So the gap is closed, by `grantAadhaarBadge()` in `e2e/helpers/liveAuth.js` and a second test in
`live-verify-funnel`. Worth being precise about why this is not "faking the webhook in the test",
which is what the original entry ruled out on principle: the endpoint drives
`VerificationService.simulateSuccess`, which runs the production `handleWebhook` path, so
one-Aadhaar-one-account dedup and idempotency still apply. The test stands on the real grant,
reached by the one door a developer machine has.

**Rule this earned:** before writing down "we would need to build X", grep the backend for X. A
capability with no caller looks exactly like a capability that does not exist, and a plan that sends
the next person to build something that already ships is worse than no plan.

## Checklist

- [x] Confirm each column-A file against the OpenAPI contract **before** writing any Java.
- [x] `permissions` + `contact` enforced server-side — **verified already true; no Java written.**
- [ ] Ranking fields (`featured`, `freshness`, `qualityScore`) move into the search query.
- [ ] Money (`rentPay`, `rentReceipt` amounts) computed once, on the server.
- [ ] State machines (`serviceFlow`, `groupApplications`, `kycTrack`, `photoRequests`) server-owned.
- [ ] Every column-A file deleted from `frontend/src/lib/`.
- [ ] No component re-derives a value the API returns.
- [ ] Bundle size measured before/after; headroom recorded.
- [ ] Caching deferred until measured (D133).
