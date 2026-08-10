# Flow: Rent Agreement Creation

> The owner-driven (or co-filled) Maharashtra Leave & License agreement wizard: capture property,
> owner, tenant(s), terms, witnesses; compute statutory + platform cost; submit into the ops
> workflow; then track drafting, approval, e-registration and download.
> This is the **L3 deal-verified** step of the trust ladder: hard KYC (both parties' PAN/Aadhaar +
> the registered agreement) legitimately applies **here**, at the money/agreement moment — the one
> place ADR-019 permits a hard identity requirement (browse/post/contact stay at L1). See
> [`../../system/trust-and-verification-model.md`](../../system/trust-and-verification-model.md).
> **Status:** documented from React source · re-synced to ADR-019 (L3 deal-verified) - **Primary role(s):** owner (maker/initiator), tenant
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
  - `?flat=<propertyId|roomId>&reissue=1` - the **joint-agreement reissue** entry, produced by an
    owner's occupied room card in Flatmates (`useFlatmateSupply.reissueAgreement`). One rent
    agreement covers the owner and every flatmate in the flat, so any change to who lives there is
    the moment to reissue it.
    > **Gap (as of this writing):** `useRentAgreement.js` reads only `invite` and `listing`; `flat`
    > and `reissue` are inert, so this link opens the wizard with no flat binding and no supersede
    > context. Either the hook must consume them, or the CTA should be gated until it can.
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
Link to [`../../system/data-model.md`](../../system/data-model.md).
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
- **Draft (`pnDraft:rentAgreement`)** - autosave/restore of the whole wizard *except* PAN and
  Aadhaar. Those are stripped before the draft is written (the same redaction the co-fill payload
  uses), and a draft written before that rule is redacted in place the next time the wizard opens.
  A mid-fill refresh therefore brings back every answer with those two blank, and the restored-draft
  banner says so.
- **Identity numbers (D151)** - `PUT /service-requests/{id}/identities`, once, immediately after the
  live create and before the checkout modal opens. This is the *only* place PAN and Aadhaar leave the
  tab: not in `details` (plaintext `jsonb`, echoed to every staff read), not in the draft, not in the
  co-fill payload, not in `puneNestOwnerKYC`. Built by `identityParties(owner, tenants)` from live
  component state, sent, and not retained; the server answers 204 so there is nothing to echo back.
  On the desk's side only the operator the request is **assigned to** can read them back — an admin
  is refused until they take the request — every read and every refusal is written to `audit_log`,
  and the numbers are blanked when the request completes or is cancelled. A failure here is
  non-fatal: the request exists and is about to be paid for, so the customer is told the team will
  ask for the numbers rather than that their submission was lost. Mock mode drops them on purpose —
  the mock store is `localStorage`, which is the threat the redaction closed.
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

### 5.8 Joint agreement for a split flat
A flat let room by room is covered by **one** agreement naming the owner and every current flatmate,
not one agreement per room - which is why rooms carved from the same listing all share a `propertyId`
(the key that ties them into one flat for both the occupancy ledger and the agreement). When
occupancy changes (`setRoomOccupants`, via the room card's +/- stepper in Flatmates), the existing
document no longer names the people actually living there, so the owner is offered a reissue at that
exact moment. See [`flatmates.md`](./flatmates.md) section 5 and the entry-point gap noted in
section 2.

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
