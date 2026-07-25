# Flow: Rent Agreement Creation

> The owner-driven (or co-filled) Maharashtra Leave & License agreement wizard: capture property,
> owner, tenant(s), terms, witnesses; compute statutory + platform cost; submit into the ops
> workflow; then track drafting, approval, e-registration and download.
> **Status:** documented from React source - **Primary role(s):** owner (maker/initiator), tenant
> (co-filler / invitee), ops "rental" team (checker/drafter)

---

## 1. Purpose & user problem
- **Persona:** an owner/landlord (usually) who needs a legally-registered rent agreement; the tenant
  who must add their KYC; the ops rental team who draft, register and deliver it.
- **Job-to-be-done:** "Fill one guided form (or invite the other party to fill their half), pay the
  statutory + service cost, and get a registered Leave & License delivered - biometric at doorstep,
  no office visit."
- **Why it matters:** a flagship "under one roof" paid service (Rs 999 ticket value; statutory stamp
  + registration passed through). It is a genuine maker-checker + co-fill workflow and the anchor of
  the tenancy relationship that later powers rent payments ([`./rent-tenancy.md`](./rent-tenancy.md)).

## 2. Entry points
- **Routes:** `/services/rent-agreement` (`services/RentAgreement.jsx` -> `useRentAgreement()`).
  Query params:
  - `?listing=<id>` - owner pre-fills property + terms from one of their listings.
  - `?invite=<inviteId>` - a bearer-token deep link that switches the page into **invite mode** for
    the invited tenant (co-fill).
- **Tiles / triggers:** Services hub "Rent Agreement" card; the `Rent a Home` / dashboard rental
  surfaces; the property picker for owners with listings; a WhatsApp/in-app invite from the owner.
- **Source components:** `services/RentAgreement.jsx` (shell + `ServiceTracker`),
  `services/rent-agreement/useRentAgreement.js` (controller), the step components
  `StepProperty/StepOwner/StepTenant/StepTerms/StepWitnesses/StepReview.jsx`, `CostSidebar.jsx`,
  `DocsRequired.jsx`, `useRaFurniture.js`, `constants.js`, `helpers.js`; workflow engine
  `src/lib/serviceFlow.js`; fees `getFees` (`src/lib/store/billing.js`); document vault
  `src/lib/data/documents.js`.

## 3. Actors & roles
- **Owner (maker / initiator):** fills property/owner/terms/witnesses, optionally invites a tenant,
  and generates the request. After submission the owner's create-wizard is **locked** to the submitted
  request (the legal source of truth) unless they `startNewAgreement`.
- **Tenant (co-filler):** either filled inline by the owner, or invited to complete only the tenant
  section via `?invite=`.
- **Ops "rental" team (checker/drafter):** review docs, share the draft, submit for registration,
  upload the final registered copy (back-office, via the same `serviceFlow` record).
- **Guards:** the page is publicly fillable; **generating** requires sign-in
  (`/signin?reason=service&next=...`, draft restored). Invite mode forces sign-in with the invited
  number pre-filled and verifies the signed-in mobile matches the invite. Guards are UX-only
  ([`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 1); the invite id is a
  real bearer token.

## 4. Entities touched
Link to [`../../system/domain-model.md`](../../system/domain-model.md).
- **Service workflow request** - `puneNestServiceReq:<ownerMobile>` via `serviceFlow.create` /
  `createCoFill`. Holds `details`, `docs`, `draft`, `draftDecision`, `finalDoc`, `messages`,
  `timeline`, `parties`, `coFill`, `ticketRef`, `status`. Created here; advanced by ops.
- **Co-fill invite** - `puneNestRAInvite:<tenantMobile>` via `createInvite` (bearer `inviteId`,
  `status: pending|filled|declined`).
- **Admin service ticket** - `createServiceRequest({ team:'rental', service:'Rent Agreement', value:
  cost.total, ref })` (kept in sync with the workflow status).
- **Owner KYC** - `puneNestOwnerKYC:<mobile>` (autofill + persist on submit).
- **Document vault** - `getDocsForProp(mobile, 'personal')` / `addDocument`: owner PAN/Aadhaar/photo/
  ownership proof reused across the wizard and dashboard (`OWNER_VAULT_CAT`).
- **Draft (`pnDraft:rentAgreement`)** - autosave/restore of the whole wizard.
- **Notifications** - `pushNotificationFor(tenantMobile, ...)` on invite; cross-party bell alerts on
  every maker-checker transition (`serviceFlow.notify`).
- **Fees** - `getFees().rentAgreementPlatform` (default 500).

## 5. Business rules & logic  *(the meat)*

### 5.1 Wizard shape (6 steps)
`STEP_LABELS = [Property, Owner, Tenant, Terms, Witnesses, Review]` (`step` 0..5).
- **Step 0 Property:** agreement type (Residential/Commercial), propType, furnish, flat no, society,
  locality, city (default Pune), pincode, area. Pre-filled from `?listing=` (furnish map
  unfurnished/semi/furnished; rent/deposit from listing).
- **Step 1 Owner:** name, age, gender, PAN, Aadhaar, mobile, email, address. Autofilled from
  `puneNestOwnerKYC:<mobile>` or the session user.
- **Step 2 Tenant:** `tenantMode` = `fill` (one or more tenants, `addTenant`/`removeTenant`) or
  `invite` (send a co-fill link). Tenant fields mirror owner KYC.
- **Step 3 Terms:** startDate, months (default 11), rent, deposit, non-refundable deposit,
  increment % (default 5), lock-in (6), notice (2), due day (5), pay mode; maintenance payer;
  registration area (urban/rural); furniture list (`useRaFurniture`) + extra clauses.
- **Step 4 Witnesses:** two witnesses (name + address).
- **Step 5 Review:** a declaration checkbox is required before `generate`.

### 5.2 Cost computation (`cost` useMemo) - Maharashtra Article 36A
This is the money math and MUST move server-side unchanged:
```
rent, dep(refundable), nr(non-refundable) = numeric term inputs
months  = parseInt(terms.months) || 11
years   = ceil(months / 12)
taxable = rent * months + nr + 0.10 * dep * years    // L&L taxable value
stamp   = round(0.0025 * taxable)                    // stamp duty = 0.25% of taxable
reg     = regArea === 'rural' ? 500 : 1000           // registration fee
service = Number(getFees().rentAgreementPlatform) || 0   // platform fee (default 500)
total   = stamp + reg + service
```
- The FAQ states the same rule in words: stamp duty = 0.25% of (rent for the full period +
  non-refundable deposit + 10% of the refundable deposit per year of term); registration Rs 1,000
  urban / Rs 500 rural. `service` is admin-controlled and is the only PuneNest revenue line here.
- The admin **ticket value** uses `cost.total`.

### 5.3 Validation (`stepErrors`)
- Step 0: flatNo, society, locality required; pincode `^\d{6}$`.
- Step 1: oName required; PAN `^[A-Za-z]{5}\d{4}[A-Za-z]$`; Aadhaar `^\d{12}$` (digits-only);
  mobile `^[6-9]\d{9}$`; address required.
- Step 2 (fill): each tenant name/PAN/Aadhaar/mobile/address by the same patterns; (invite): valid
  invite mobile.
- Step 3: startDate, rent, deposit required (rent/deposit must be > 0).
- `generate` re-checks steps 0..3 and the declaration before submitting (jumps to the first bad step).

### 5.4 Document reuse & collection
- **Owner vault reuse:** if PAN/Aadhaar/photo/ownership proof already exist under
  `getDocsForProp(mobile, 'personal')`, those slots pre-fill (`fromVault:true`) so the owner never
  re-uploads. Freshly uploaded owner docs are saved back to the vault (`saveOwnerDocToVault`), skipping
  vault-sourced, oversize, or duplicate files.
- **`collectDocs`** gathers the *real* uploaded files (name + dataUrl) into request `docs` with
  `status:'submitted'` so ops review genuine documents, not placeholders. Owner docs attach on the
  owner submit; the invited tenant's docs attach when they submit their section.
- Required doc lists: `OWNER_DOCS_REQUIRED = [PAN, Aadhaar, Photo, Ownership]`, `TENANT_DOCS_REQUIRED
  = [PAN, Aadhaar, Photo]` (employment proof optional).

### 5.5 Submit (`generate`) - two paths
Assembles `details` (property string, ownerName, tenants label, rent, deposit, months, startDate,
regArea label, and `_state` = the full form snapshot for co-fill/resume).
- **Owner, tenant filled inline:** `createServiceRequest({ team:'rental', ..., value: cost.total, ref:
  ticketRef })` + `persistOwnerKYC()` + `createFlowRequest(ownerMobile, { type:'rental', details,
  docs, ticketRef })`. The request starts at `submitted`.
- **Owner, tenant invited (co-fill):** `createServiceRequest(...)` + `createCoFill(ownerMobile, {
  details, docs, parties:[owner, tenant], invite:{ toMobile, toName, toRole:'tenant', sections:
  ['tenant'] } })`. The request starts at `awaiting_party`; an invite record is created under the
  tenant's mobile; the owner gets a shareable `inviteLink` + `buildInviteWaLink` (WhatsApp), and the
  tenant gets an in-app notification deep-linking to `/dashboard#rental`.
- **Invited tenant path (invite mode):** `submitInviteDetails(tenantMobile, inviteId, details,
  collectDocs(), party)` merges the tenant's non-empty fields + docs into the *owner's* request,
  advances it `awaiting_party -> submitted`, marks the invite `filled`, and notifies the owner. No new
  admin ticket (the owner's ticket already represents this agreement).
- After submit: `clearDraft()`, `setDone(true)`, scroll to the tracker.

### 5.6 Invite resolution & security (`serviceFlow.js`)
- `inviteId = 'INV' + randToken()` uses `crypto.randomUUID`/`getRandomValues` - **unguessable**, so
  it can be a bearer token in a WhatsApp link.
- On landing with `?invite=`: resolve via `findInviteById` (scans all invite buckets). Signed-out ->
  redirect to sign-in with the invited number pre-filled. Then guard: invite must exist
  (`expired`), the signed-in mobile must equal `toMobile` (`wrongNumber`), and status must be
  `pending` (`done`/`expired`). Only then does invite mode load the owner's `_state` and jump to
  step 0.
- `declineInvite` marks the invite `declined`, returns the request to `awaiting_party`, and messages
  the owner ("resend or fill it yourself").

### 5.7 Ops workflow (checker side, `serviceFlow.js`)
- **Status ladder:** `awaiting_party -> submitted -> docs_review -> draft_shared ->
  (changes_requested | approved) -> registration -> completed` (or `cancelled`).
  Stepper `STEPS = [Submitted, Documents, Draft & approval, Registration, Ready]`;
  `progressPct` = 25/50/75/100.
- Staff actions: `markDocsVerified` (submitted -> docs_review), `shareDraft` (versioned draft ->
  draft_shared, notifies customer), customer `decideDraft('accepted' -> approved | 'rejected' ->
  changes_requested)`, `submitRegistration` (-> registration), `uploadFinal` (-> completed with
  `finalDoc` to download). Each writes a `timeline` entry, a `messages` thread entry, and a
  cross-party notification.
- **Ticket sync:** `TICKET_STATUS` maps workflow status -> admin ticket (`new`/`in_progress`/`done`/
  `cancelled`) so the linked `ticketRef` never shows a stale "new".

## 6. Maker-checker / approval
Yes - two nested loops (see [`../../system/cross-cutting.md`](../../system/cross-cutting.md)
section 2):
1. **Co-fill (owner <-> tenant):** owner proposes an agreement and invites the tenant (maker); the
   tenant completes their half (co-maker). Only when both halves exist does the request enter
   `submitted` and reach ops.
2. **Draft approval (customer <-> ops):** ops share a draft (`draft_shared`); the customer is the
   checker - `accepted` advances to `approved`/registration, `rejected` returns to
   `changes_requested` for a new draft version. Registration and final upload are ops side-effects.

## 7. State machine
```
Co-fill invite:  pending --tenant submits--> filled
                    |  \--tenant declines--> declined (request -> awaiting_party)
                    +--(owner cancels/ resends)

Request (serviceFlow):
  (co-fill) awaiting_party --both parties complete--> submitted
  (inline)  submitted
  submitted --ops verify docs--> docs_review --ops--> draft_shared
     draft_shared --customer accept--> approved --ops--> registration --ops upload--> completed (download)
     draft_shared --customer reject--> changes_requested --ops new draft--> draft_shared (loop)
  any active --ops cancel--> cancelled
```
- Terminal: `completed` (registered, `finalDoc` downloadable) and `cancelled`. `isActive` = neither.
- The owner's create-wizard is `locked` while an active (`isActive`) rental request exists;
  `startNewAgreement` clears the draft and unlocks a fresh form for a different property.

## 8. Edge cases, validation & error states
- **Not signed in:** fillable, but `generate`/invite bounce to sign-in (draft restored). Invite mode
  forces sign-in with the invited number.
- **Wrong number / expired / already-done invite:** `inviteError` renders a specific state
  (`wrongNumber` / `expired` / `done`); no data is exposed.
- **Owner already has an active request:** wizard is locked to the tracker (Messages / draft
  approval); `startNew` is the explicit escape hatch.
- **Field validation:** PAN/Aadhaar/mobile/pincode regexes above; declaration required at Review.
- **Document size/dupes:** oversize files (`tooLarge`) are excluded from `collectDocs` and vault
  saves; duplicate vault docs (same category+name) are skipped.
- **Submit failure:** `generate` wraps persistence in try/catch and toasts `saveError` without
  advancing.
- **Autosave scope:** draft ignores `oName`, `oMobile`, `step` and is disabled in invite mode / after
  `done`.
- **Concurrency:** both parties write the same request record via localStorage keys; a real backend
  must serialize the two-sided merge (`submitInviteDetails` last-writer-wins on non-empty fields).

## 9. Current mock implementation
- **Controller:** `services/rent-agreement/useRentAgreement.js` (`cost`, `stepErrors`, `generate`,
  `collectDocs`, invite handling, KYC autofill/persist, vault reuse).
- **Workflow engine:** `src/lib/serviceFlow.js` (`create`, `createCoFill`, `createInvite`,
  `findInviteById`, `inviteContext`, `submitInviteDetails`, `declineInvite`, `markDocsVerified`,
  `shareDraft`, `decideDraft`, `submitRegistration`, `uploadFinal`, `seedDemo`/`makeSampleRequest`,
  `sampleDocFile`). Keys `puneNestServiceReq:<mobile>`, `puneNestRAInvite:<mobile>`.
- **Ticketing:** `createServiceRequest` + `syncServiceTicket` (`src/lib/mockApi.js`).
- **Fees:** `getFees` / `FEE_DEFAULTS.rentAgreementPlatform = 500` (`src/lib/store/billing.js`).
- **Docs vault:** `getDocsForProp` / `addDocument` (`src/lib/data/documents.js`); slot map
  `OWNER_VAULT_CAT` (`constants.js`).
- **Seed:** `serviceFlow.seedDemo()` seeds sample rental requests (Baner/Wakad/Kharadi) at various
  stages (docs_review, draft, approved+registration) with `demoDocs()`; `seedService('legal'|
  'interior'|'packers'|'valuation')` seeds the other teams.
- **Constants:** `constants.js` (`STEP_LABELS`, `OWNER_DOCS`, `TENANT_DOCS`, `SERVICES`, `FAQ` with
  the exact stamp-duty rule).

## 10. Target API endpoints
Map to [`../../system/api-contract.md`](../../system/api-contract.md):
- Service workflow (section 27): `POST /service-requests` (create), `GET /service-requests` /
  `:id` (tracker + timeline), `POST /service-requests/:id/docs`, `POST /service-requests/:id/draft`
  (staff), `POST /service-requests/:id/draft/decision` (customer accept/reject),
  `POST /service-requests/:id/final-doc` (staff), `PATCH /service-requests/:id/status`,
  `POST /service-requests/:id/messages`.
- `POST /tickets` (section 13) - the linked admin ticket.
- `GET /fees` (section 33) - `rentAgreementPlatform`.
- `GET/POST /me/rent-agreements` (section 28) - the registered-agreement record.
- Documents (section 16) - vault reuse.
- **Missing but implied:** a co-fill invite resource (`POST /service-requests/:id/invite`,
  `GET /invites/:inviteId`, `POST /invites/:inviteId/submit`, `POST /invites/:inviteId/decline`) and
  server-side stamp/registration/service cost calculation.

## 11. Backend responsibilities
- **Own the cost math:** compute stamp (0.25% of the Article 36A taxable value), registration
  (1000/500), and read the platform fee server-side; never trust the client `value`/`total`.
- **Own invite security:** issue and validate the bearer `inviteId`, bind it to the invited mobile,
  enforce single-use/expiry, and reject a mismatched signed-in number - server-side, not via a
  localStorage scan.
- **Authorize transitions:** only the assigned rental staff may verify docs / share draft / register /
  upload final; only the customer may accept/reject the draft; only the request owner (or invited
  tenant for their section) may write their half. Apply the co-fill merge transactionally.
- **KYC & documents:** verify owner/tenant KYC and store documents securely (not base64 in
  localStorage); enforce the required-doc checklist before drafting.
- **Audit & notify:** write an audit row and cross-party notification on every transition, and keep
  the linked admin ticket status in sync (cross-cutting sections 4 & 7).
- **Feed downstream:** on completion, create/register the tenancy that
  [`./rent-tenancy.md`](./rent-tenancy.md) depends on.
