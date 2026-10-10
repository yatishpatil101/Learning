# Flow: Rent Agreement Creation

> The owner-driven (or co-filled) Maharashtra Leave & License agreement wizard: capture property,
> owner, tenant(s), terms, witnesses; compute statutory + platform cost; submit into the ops
> workflow; then track drafting, approval, e-registration and download.
> The identity documents collected here (both parties' PAN/Aadhaar + the registered agreement) are a
> **statutory requirement of the instrument**, not a tier of the trust ladder: a registrable rent
> agreement names and identifies its parties, so the paperwork is the product. This is the one place
> in the app a document is genuinely required, and it has nothing to do with the Verified badge —
> that badge gates nothing, anywhere (ADR-019), and browse/post/contact stay at L1. See
> [`../../system/platform-architecture.md`](../../system/platform-architecture.md) §6.4 / ADR-019.
> **Status:** documented from React source - **Primary role(s):** owner (maker/initiator), tenant
> (co-filler / invitee), ops "rental" team (checker/drafter)

> **Runtime correction (2026-08-28).** The browser-local `serviceFlow.js` described below has been
> deleted. The current flow is server-owned: the client creates and reads
> requests, creates/claims/accepts co-fill invitations, records identity numbers, withdraws an
> unanswered invite, and records read receipts through `/service-requests`. Historical sections
> that name `draazyServiceReq:*`, `draazyRAInvite:*`, or `serviceFlow` explain the migration
> starting point, not an active storage or security boundary.

---

## 1. Purpose & user problem
- **Persona:** an owner/landlord (usually) who needs a legally-registered rent agreement; the tenant
  who must add their KYC; the ops rental team who draft, register and deliver it.
- **Job-to-be-done:** "Fill one guided form (or invite the other party to fill their half), pay the
  statutory + service cost, and get a registered Leave & License delivered - biometric at doorstep,
  no office visit."
- **Why it matters:** a flagship "under one roof" paid service (Rs 999 ticket value; statutory stamp
  + registration passed through). It is a genuine maker-checker + co-fill workflow and the anchor of
  the tenancy relationship the rent flow then tracks ([`./rent-tenancy.md`](./rent-tenancy.md)).

## 2. Entry points
- **Routes:** `/services/rent-agreement` (`services/RentAgreement.jsx` -> `useRentAgreement()`).
  - `?flat=<propertyId|roomId>&reissue=1` - the **joint-agreement reissue** entry, produced by an
    owner's occupied room card in Flatmates (`useFlatmateSupply.reissueAgreement`). One rent
    agreement covers the owner and every flatmate in the flat, so any change to who lives there is
    the moment to reissue it. Both are live: `flat` is read as an alias of `listing` (the same
    prefill, and the same `propertyId` binding on the created request), and `reissue=1` adds a toast
    saying the property was prefilled for the reissue.
  Query params:
  - `?listing=<id>` - owner pre-fills property + terms from one of their listings. It fills
    **blanks only**: the listing resolves after the draft restore, and what the owner already typed
    is an answer while the listing is a suggestion. A draft that already names a *different* flat
    number or society is left whole and the request is not bound to the link (the owner is told, and
    can still pick the listing explicitly).
  - `?party=<partyId>&request=<requestId>` - the account-scoped co-fill deep link that switches the
    page into **invite mode** for the invited tenant. It is not a credential: it is resolved only
    after sign-in, against the caller's own `GET /me/service-request-invites` and a request read that
    404s for anyone who is not a party. The code never reads an `invite` param.
- **Tiles / triggers:** Services hub "Rent Agreement" card; the `Rent a Home` / dashboard rental
  surfaces; the property picker for owners with listings; a WhatsApp/in-app invite from the owner.
- **Source components:** `services/RentAgreement.jsx` (shell + `ServiceTracker`),
  `services/rent-agreement/useRentAgreement.js` (controller), the step components
  `StepProperty/StepOwner/StepTenant/StepTerms/StepWitnesses/StepReview.jsx`, `CostSidebar.jsx`,
  `DocsRequired.jsx`, `useRaFurniture.js`, `constants.js`, `helpers.js`; workflow engine
  `src/services/serviceRequestService.js`; status and invite URL helpers
  `src/lib/serviceRequestStatus.js`.

## 3. Actors & roles
- **Owner (maker / initiator):** fills property/owner/terms/witnesses, optionally invites a tenant,
  and generates the request. After submission the owner's create-wizard is **locked** to the submitted
  request (the legal source of truth) unless they `startNewAgreement`.
- **Tenant (co-filler):** either filled inline by the owner, or invited to complete only the tenant
  section via `?party=&request=`. Their own name, mobile and email (and remembered KYC) are seeded
  into the blanks of their step from the signed-in account.
- **Ops "rental" team (checker/drafter):** review docs, share the draft, submit for registration,
  upload the final registered copy (back-office, on the same server request). The upload carries the
  registration record from the Sub-Registrar's endorsement and the GRAS challan — document number,
  SRO, date, GRN, stamp duty and fee paid — and is refused (422) without it or (409) when that GRN or
  document number is already on another request. The second operator's Registration check shows the
  record beside the duty and fee the customer was quoted, and flags a difference.
  Before drafting, the desk's **Overlap check** lists other paid, uncancelled agreements on the same
  listing — or, for an unlisted flat, the same flat number + society + pincode — whose months
  overlap this one, and calls out a licensor named differently. It is advisory: an early renewal
  overlaps too, so the drafter decides. A flat typed two ways ("Flat No. 0402" and "402") is one flat, and an agreement
  filed outside any request on the same listing (`match: record`) is compared too.
  The desk shows the **Deed particulars** the customer typed (property, terms, licensors with their
  capacity and power of attorney, licensees, witnesses — mobiles masked), and a rent-agreement draft
  is shared only once the drafter ticks five checks: ID numbers match the scans, the ownership proof
  names every licensor, any POA is checked, the flat address matches, and the terms match. The
  server refuses the draft (422) without all five and audits them.
  Each paper on the checklist gets a **verdict** from the operator holding the request (or an
  admin): *Verify*, or *Reject* with a reason of up to 300 characters. The verdict attaches to that
  exact upload, so a re-upload arrives unreviewed, and a verdict sent against an older copy is a
  409. A rejection notifies whoever files that side: the accepted co-fill party whose side it is,
  else the requester. Each checklist item carries `canUpload` for the viewer (the rule the upload
  route enforces), and the desk's reason on another side's PAN, Aadhaar or photo reads `null`, as
  private as the scan. The rent-agreement tracker lists only the rejected papers the viewer can
  re-upload, with their reasons and an upload button.
  A rent agreement's draft and its registered copy are both refused (409, naming the papers) until
  every paper on the checklist is verified. Other service types keep the presence-only checklist.
  Paid rent agreements carry a **desk SLA**, measured from when the request entered its current
  status: pick up within 4 hours, first draft within 48 hours, a revision within 24 hours, and
  registration within 7 days of approval. A shared draft is the customer's turn and is not timed.
  The queue row shows "Due in…", "Overdue by…" or "Customer's turn", and *Overdue only* filters the
  queue in SQL (`?overdue=true`). The clock is computed on read — nothing sweeps or notifies
  (ADR-011) — and it uses wall-clock hours without pausing while a rejected paper is awaited.
  If rent, deposits, term or the yearly increase turn out wrong after payment, the holder
  **revises the priced terms** (*Priced terms* on the desk, `POST …/amendments`, a reason the
  customer reads). The server re-prices them, and only the requester can accept (*Revised terms*
  on the tracker). A higher fee is paid through its own checkout, and the terms apply when that
  payment's webhook settles. A lower fee applies on acceptance, and the overpayment stays on record
  until it is refunded. One revision is open at a time, only while drafting, and the
  draft cannot be shared while it is open. The holder can withdraw it. Revisions are priced against what
  is net paid (paid less approved refunds), and the other co-fill parties are told when one is proposed or
  applied. If a checkout's order has expired, accepting again opens a fresh one (an order already paid is
  refused). A payment that lands on withdrawn terms is kept as credit and flagged to the desk for a refund.
  **Refunds** (D-b, *Refunds* on the desk, `…/refunds`). Everything paid can be refunded until the
  stamp duty is paid on GRAS; after that, only what exceeds the quoted statutory charges comes back.
  A registered copy proves the duty was paid; before that, the maker states it with the GRN. The
  holder asks, and a different operator approves (the maker gets 403) or rejects with a note. Only
  on approval does the gateway refund the order the money came in on. `refund.approved` is written
  to the timeline and the customer is notified. A refund that returns everything paid cancels the request
  (`refund.cancelled-request`); a partial one does not. The gateway's refund webhook (Cashfree
  `REFUND_STATUS_WEBHOOK`) is applied too: a `CANCELLED` or `FAILED` refund is marked `failed`,
  written to the timeline and audit, and the customer is told, so the desk can ask again.
  **Draft approvals** (MC-4/MC-8). Every executing party approves the current draft version:
  in-app for account holders, by OTP for inline parties (witnesses are not asked). Any rejection
  sends it back to changes-requested, and a new version resets every approval. A risky draft
  (rent ≥ ₹50k, a co-owner or POA, an NRI/foreign party, an overlap) stays hidden from the customer
  until a different `services:write` operator releases it or sends it back.
  **Police intimation** (LEG-2). After the registered copy, the tracker links the Pune City and
  Pimpri-Chinchwad Police portals; the step stays pending until ops records the owner's
  confirmation (optional reference number and date).
- **Guards:** the page is publicly fillable; **generating** requires sign-in
  (`/signin?reason=service&next=...`, draft restored). Invite mode forces sign-in (`reason=invite`,
  no mobile in the URL) and then resolves the invitation against the signed-in account. Guards are
  UX-only ([`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 1); the server's
  party check is the authority.

## 4. Entities touched
Link to [`../../system/data-model.md`](../../system/data-model.md).
- **Service workflow request** - a server `service_requests` record, created through
  `serviceRequestService.createServiceRequest` or the co-fill endpoint. It holds `details`,
  `documents`, `messages`, `timeline`, `parties` and `status`; the requester and drafting desk read
  the same record through their scoped endpoints.
- **Co-fill invite** - a server `service_request_parties` record addressed to the tenant mobile;
  it is claimed at sign-in, then accepted or declined through the invite endpoint.
- **Admin service ticket** - none for a rent agreement. The server request itself is the drafting
  desk record; the browser does not maintain a ticket mirror.
- **Owner KYC** - `draazyOwnerKYC:<mobile>` (autofill + persist on submit).
- **Document vault** - `documentService` over `GET`/`POST /me/documents/personal`: owner
  PAN/Aadhaar/photo/ownership proof reused across the wizard and dashboard (`OWNER_VAULT_CAT`). A
  vault row carries a signed URL, not bytes, so a reused slot is held by `vaultDocId` and filed onto
  the request server-side by `POST /service-requests/{id}/docs/from-vault`.
- **Draft (`dzDraft:rentAgreement`)** - autosave/restore of the whole wizard *except* PAN and
  Aadhaar. Those are stripped before the draft is written (the same redaction the co-fill payload
  uses), and a draft written before that rule is redacted in place the next time the wizard opens.
  A mid-fill refresh therefore brings back every answer with those two blank, and the restored-draft
  banner says so. Attached papers are kept as `docRefs` — never bytes: a vault-backed slot comes back
  whole, any other comes back as a "Re-attach <name>" marker that does not count as uploaded.
- **Identity numbers (D151)** - `PUT /service-requests/{id}/identities`, once, immediately after the
  live create and before the checkout modal opens. This is the *only* place PAN and Aadhaar leave the
  tab: not in `details` (plaintext `jsonb`, echoed to every staff read), not in the draft, not in the
  co-fill payload, not in `draazyOwnerKYC`. Built by `identityParties(owner, tenants)` from live
  component state, sent, and not retained; the server answers 204 so there is nothing to echo back.
  On the desk's side only the operator the request is **assigned to** can read them back — an admin
  is refused until they take the request — every read and every refusal is written to `audit_log`,
  and the numbers are blanked when the request completes or is cancelled. A failure here is
  non-fatal: the request exists and is about to be paid for, so the customer is told the team will
  ask for the numbers rather than that their submission was lost.
- **Notifications** - server-owned notifications and request messages; the browser has no
  cross-party notification store.
- **Fees** - `getDealFees('rent').platformFee` (`feesService`, the published fee schedule).

## 5. Business rules & logic  *(the meat)*

### 5.1 Wizard shape (6 steps)
`STEP_LABELS = [Property, Owner, Tenant, Terms, Witnesses, Review]` (`step` 0..5).
- **Step 0 Property:** propType (`RESIDENTIAL_PROPERTY_TYPES` only), furnish, flat no, society,
  locality, city (default Pune), taluka and village/city for Pune district, optional road name and
  police station, pincode; area (required, 1..1,00,000, two decimals) with its basis (`areaBasis`
  carpet | built-up, default carpet) and unit (`areaUnit` sqft | sqm), floor (optional, 0..200, 0 =
  ground), repeatable CTS / survey / plot / property attribute rows, and optional gallery/balcony
  area. The wing rides in the flat number (*B-1204*). Society is the list-property wizard's
  `SocietySelect` (curated + MahaRERA catalogue, binding `societyId`) and locality is a
  `LocalitySelect` over `localityNames()` that fills a blank pincode from the chosen locality.
  Choosing one of the owner's own listings reads it with `myListing` (the list row lacks the address
  parts) and overwrites with its non-empty values; `?listing=`/`?flat=` fills blanks only and leaves a
  restored furnishing alone (furnish map unfurnished/semi/furnished; rent/deposit from listing).
  The listing's carpet area wins over its built-up one and sets the basis to match; a listing
  measured in another unit leaves the area to type, and the basis and unit only move with the area.
  There is no Residential/Commercial toggle:
  a commercial licence differs on GST, TDS (194-I, not 194-IB) and clause set, so commercial premises
  are sent to `/services/property-legal` instead of being drafted on residential terms.
- **Step 1 Owner:** the primary licensor — name, mother's name, DOB (which derives age),
  optional alias, gender, PAN, Aadhaar, mobile, email, address —
  plus `capacity` (owner / co-owner / POA holder; a POA holder adds principal, POA registration
  no., SRO and date, `PoaFields.jsx`). `coOwners[]` (`CoOwnerBlock.jsx`) adds every other owner on
  title: all of them execute the deed. Autofilled from `draazyOwnerKYC:<mobile>` or the session user.
- **Step 2 Tenant:** `tenantMode` = `fill` (one or more tenants, `addTenant`/`removeTenant`) or
  `invite` (send a co-fill link). Tenant fields mirror owner KYC, including mother's name, DOB and
  alias, then add the IGR police record under `tenant.police`: permanent/previous address toggles
  (pincode, village/city, police station, address), address proof type for permanent and for a
  different previous address, workplace address + work ID proof type, and optional family/co-occupant
  rows whose added fields are all mandatory.
- **Step 3 Terms:** startDate, months (a preset 11/12/22/24/36/60, default 11, or *Other…* for any
  1..60 — a restored non-preset term reopens as *Other…*), rent, deposit, non-refundable deposit,
  increment % (default 5; labelled *Increase on Renewal* for a term of 11 months or less) and, for a
  longer term, how often it applies (every 11 or 12 months, default 11), lock-in (6), notice (2),
  due day (5), pay mode; how the refundable deposit was paid (`depositPayments`, see § validation);
  maintenance payer; the deed's who-pays clauses, pre-answered with the Pune
  norm — electricity & water (`utilitiesBy`, Tenant), property tax (`taxBy`, Owner), stamp duty &
  registration (`costBy`, Split | Tenant | Owner); parking (`none` | `two-wheeler` | `car` |
  `both`) with optional parking area when parking is included; optional occupant count; the registration area, shown read-only because it follows the
  locality (see § 5.2); deed language (`language`,
  English | Marathi, default English); the biometric-visit preference — where (`visitAt`, property |
  licensor | licensee, default property), an optional preferred date (`visitDate`, tomorrow to 90
  days ahead) and a slot (`visitSlot`, any | morning | afternoon | evening). The server refuses a
  value outside those sets, and a past visit date only when the request is filed, so a date that
  lapses before the invited side submits never blocks them. The desk sees all of it in
  `DeedParticulars`. Furniture list
  (`useRaFurniture`) + extra clauses.
- **Step 4 Witnesses:** two attesting witnesses, both required (name, mobile, Aadhaar, address);
  e-registration identifies each by Aadhaar biometrics.
- **Step 5 Review:** a declaration checkbox is required before `generate`. It is the authority to
  draft and e-register plus consent to the Aadhaar and PAN being used for this deed only (Aadhaar Act
  s.8, DPDP Act 2023 s.6), and checkout sends its version (`DECLARATION_VERSION`); see *Payment opens
  only once the agreement is registrable*.

**`LAST_PUBLIC_STEP` (`constants.js`)** is the index of the last step a signed-out visitor may
reach. Step 0 asks only about the building, so the Estimated Total is visible before any commitment;
every later step collects PAN, Aadhaar and scans, which must not be taken from a session with no
account behind it — no consent record, no audit trail, nobody to attribute the data to (Aadhaar Act
s.29). It is a named constant rather than a literal because three places must agree: the gate in
`useRentAgreement.next`, the clamp that restores a signed-out visitor, and the padlocks the progress
rail draws.

**The progress rail's padlocks (`RentAgreement.jsx`)** read that same `gated` flag rather than
re-deriving `mode === 'owner' && !isIn`. The clamp waits out `loading`; a re-derived copy does not,
so during a restored draft mid-boot the padlocks and the active dot disagreed — the panel on screen
was padlocked and no dot was active. The padlock outranks `pending` and `done` because it is the
stronger claim: a signed-out visitor cannot reach those steps at all, so showing step 2 as "awaiting
the tenant" would describe a queue they are not in.

### 5.2 Cost computation (`cost` useMemo) - Maharashtra Article 36A
Server-side in `LeaveAndLicenceCharges`; the wizard mirrors it so the estimate equals the charge:
```
rent, dep(refundable), nr(non-refundable) = numeric term inputs
months  = parseInt(terms.months) || 11
every   = terms.incrementEvery (11 | 12, default 11)
years   = ceil(months / 12)
rentForTerm = Σ monthly rent × months it is paid, the rent rising by increment% every `every`
              months, compounding, each escalated rent rounded half-up to the rupee
taxable = rentForTerm + nr + 0.10 * dep * years      // L&L taxable value
stamp   = max(100, ceil(0.0025 * taxable / 100) * 100) // 0.25%, up to the next ₹100, ₹100 floor
reg     = isGramPanchayat(prop.locality) ? 500 : 1000 // registration fee
dhc     = 300                                        // document handling charge
service = feeRow.platformFee                         // getDealFees('rent').platformFee
gst     = feeRow.gst                                 // GST on the service fee only
total   = stamp + reg + dhc + service + gst
```
- The registration area is not the customer's choice (D-h). The fee halves for a Gram Panchayat
  area, so a toggle invited a false "rural". On create, `RegistrationArea` resolves
  `_state.prop.locality` and stamps `regArea` ("Rural" / "Municipal / Urban") plus `_state.regArea`
  over whatever the client sent. The locality's `registration_body` column (V46, set in the R__
  seed) marks the twelve gram-panchayat localities; any other or unknown locality prices urban.
  `data/localities.js` mirrors that list only for the preview. Pricing reads one value, the
  top-level `regArea`, so a `_state.terms.regArea` cannot pick the cheaper fee. The desk corrects the
  area from the Index II at pickup as a priced-terms amendment (`regArea: urban | rural`); the
  customer accepts it, and pays the ₹500 difference or has it left on record for a refund.
- The duty is billed as GRAS collects it (D-a): the IGR calculator rounds up to the next ₹100 and
  never charges less than ₹100, so a ₹917.50 duty bills ₹1,000. The ceiling reads the unrounded duty
  (₹100.01 bills ₹200); the wizard does it in integer tenths of a rupee so no float lands a whole
  hundred one step high. The server keeps the formula's own figure as `Charges.exactDuty`.
- The FAQ states the same rule in words: stamp duty = 0.25% of (rent for the full period, including
  agreed increases, + non-refundable deposit + 10% of the refundable deposit per year of term);
  rounded up to the next ₹100, minimum ₹100); registration Rs 1,000 urban / Rs 500 rural; DHC ₹300. `service` is admin-controlled and is the only Draazy
  revenue line here; `gst` is charged on it and not on the government levies, which pass through.
- The increment and its interval live only in `_state.terms` (`increment`, `incrementEvery`); the
  server refuses an interval other than 11 or 12 and an increment with more than two decimals.
- The admin **ticket value** uses `cost.total`.

### 5.3 Validation (`validation.js` → `stepErrors`)
- Step 0: residential propType, flatNo, society, locality and area required (server: area 1..100000,
  basis, unit and floor 0..200 when stated, and the area is named at checkout); pincode `^\d{6}$` and in
  Maharashtra — 40–44, not Goa's 403 (`MH_PINCODE`; the server refuses `_state.prop.pincode`
  outside it with a 422).
- Step 1: every licensor's name, age 18..120 (a minor's agreement is void; the server refuses a
  stated age under 18 with a 422 and a missing one at checkout), PAN `^[A-Za-z]{5}\d{4}[A-Za-z]$`,
  Aadhaar (12 digits, not starting 0/1, Verhoeff check digit — `helpers.isAadhaar`), mobile
  `^[6-9]\d{9}$`, address; owner email format; capacity, and the POA details when capacity is POA;
  the four owner documents. Gender starts unchosen and stays optional; occupation is optional.
- Step 2 (fill): each tenant by the same patterns plus their three documents; (invite): valid invite
  mobile.
- Step 3: startDate within today−30..today+180 (IST), months 1..60, rent > 0, deposit stated (0 is
  a valid deposit), lock-in and notice ≤ months, due day 1..28 (server too), increment 0..100,
  occupants 1..20 when stated (server too; the server also refuses a payer, cost bearer or parking
  value the wizard does not offer). A deposit above ₹0 needs `depositPayments` — one to ten rows,
  each in an IGR portal mode (`upi`: ref/UTR, amount, date; `netbanking`: bank, branch, ref, amount,
  date; `dd`: bank, branch, DD/cheque date and number, amount; `cash`: date, amount), ref 4–30 letters
  or digits, date not after today, amounts adding up to the deposit exactly. The server
  (`DepositPaymentRules`) re-checks the shape and the sum but not presence, so requests filed before
  the section existed still pass; the details guard checks a well-formed `ref` on a UPI / Internet
  Banking / DD row for a PAN only, since a 12-digit UTR can pass the Aadhaar checksum.
  Advisory, never blocking: *Cash* with any sum ≥ ₹2 lakh shows the s.269ST note; rent over
  ₹50,000/month shows the s.194-IB TDS note. The furniture list is checked against step 1's
  furnishing: *Unfurnished* with a preset beyond the usual fittings (`FIXTURES` — fans, lights,
  geyser, modular kitchen…) offers a one-tap *Mark it Semi-Furnished*; *Semi-/Furnished* with an
  empty list asks for one, since it is what the deposit is settled against.
- Step 4: both witnesses' name, mobile, Aadhaar, address.
- Across steps: no two parties share a mobile or an Aadhaar.
- `generate` re-checks steps 0..4 and the declaration before submitting (jumps to the first bad step).
- **A refused step shows where:** the first flagged control on the active panel is scrolled into view
  and focused, and from then on that step re-validates as the customer types, so a fixed answer
  clears without pressing Next again.
- **The server holds the same line** (a client can skip the wizard): the create and the co-fill
  party-details write run `RentAgreementDetailsRules` on `details._state` (422), the identities write
  checks role, Verhoeff and distinct Aadhaar per body (422), and pricing refuses a term over 60
  months — past five years it is no longer an Art. 36A leave and licence.

### 5.4 Document reuse & collection
- **Owner vault reuse:** if PAN/Aadhaar/photo/ownership proof already exist in the owner's personal
  vault, those slots pre-fill by reference (`vaultDocId`, `fromVault:true`) so the owner never
  re-uploads; at submit such a slot is filed with `POST /service-requests/{id}/docs/from-vault`
  (owner-scoped: the server refuses another account's vault row). Freshly uploaded owner docs are
  saved back to the vault (`saveOwnerDocToVault`), which also stamps the slot's `vaultDocId` so a
  reload keeps it.
- **`collectDocs`** gathers the uploaded files (name + dataUrl, or the vault reference) into request
  `docs` so ops review genuine documents, not placeholders. The co-fill hand-off always files the
  owner's papers, even when the identities write fails, and the invited tenant's docs attach when
  they submit their section.
- Required docs (`documents.js`, validated per step): each licensor `licensor-{i}-pan|aadhaar|photo`
  (+ `licensor-{i}-poa` for a POA holder), `ownership-proof` once, each tenant
  `tenant-{j}-pan|aadhaar|photo` (employment proof optional). Those categories are what the
  server's checkout gate looks for.

### 5.5 Submit (`generate`) - two paths
Assembles `details` (property string, ownerName, tenants label, rent, deposit, months, startDate,
regArea label (overwritten server-side from the locality), and `_state` = the full form snapshot for co-fill/resume).
- **Owner, tenant filled inline:** the review button reads "Pay ₹X & Submit".
  `createServiceRequestLive(...)` files the request at `awaiting-payment`, `handOff` records
  identities and uploads papers, and `openServiceRequestCheckout` opens payment (section 5.10).
  The request reaches the desk only once the payment webhook settles it. Until then the tracker
  reads "Unpaid · not submitted" and lights no step.
- **Owner, tenant invited (co-fill):** `createCoFillServiceRequest({ request, role:'tenant', mobile })`
  files the request at `awaiting-payment` with a `service_request_parties` row addressed to the
  tenant's mobile, then hands off the owner's side. The owner gets a shareable link and a WhatsApp
  link; the server notifies the tenant (`service.party-invited`).
- **Invited tenant path (invite mode):** `submitServiceRequestPartyDetails(requestId, details)`
  writes the tenant's half (`PUT …/party-details`), then hands off the tenant's identities and papers.
  The owner is notified and pays from the locked panel.
- **Tenant starts, owner invited (co-fill the other way):** step 2 offers "I'm the tenant — invite
  the owner". The owner fields and co-owners give way to the owner's mobile (plus an optional name
  and note), the step dot stays pending, and the first tenant row starts as the signed-in requester.
  `captureFormState` sends the licensor blank but for the invited mobile (`_state.ownerMode:
  'invite'`), so the tenant's autofilled self never travels as the owner and the server's
  distinct-mobile rule still covers it. `createCoFillServiceRequest({ …, role:'owner' })` files it;
  the requester hands off only tenants and witnesses. The invited owner lands on step 2 (the only
  editable one, prefilled from their account and remembered KYC), and `ownSide('owner')` keeps
  only `ownerName`, `owner` and `coOwners`. The requester (the tenant) pays from the locked panel;
  the declined/re-invite panel, top-up and pay copy switch to their `_owner` i18next context.
- After submit: `clearDraft()`, `setDone(true)`, scroll to the tracker.

### 5.6 Invite resolution & security (`useRentAgreement.js` invite init)
- The deep link is `?party=<partyId>&request=<requestId>` and is **not** a bearer token: holding it
  grants nothing. Signed-out -> `/signin?reason=invite&next=…`, with no mobile in the URL.
- Signed in: the row is looked up in the caller's own `GET /me/service-request-invites`; a pending
  row is accepted (`POST /me/service-request-invites/{partyId}`), and then `GET /service-requests/{id}`
  decides — it 404s for anyone who is not a party, so a stranger gets the neutral "no longer
  available" panel. An accepted invite leaves the pending list, so absence there is not expiry.
- Invite mode loads the owner's `_state`, seeds the tenant's blanks from the signed-in account, and
  jumps to step 0. The tenant's PAN/Aadhaar go through `PUT /identities`, which accepts an accepted
  party for their own side.
- **A declined invite is recoverable.** Declining leaves the party row `declined`, which used to hold
  the unique `(request_id, role)` slot while checkout waited forever on an accepted party. The
  owner's locked panel now detects a co-fill request (`_state.tenantMode` or `_state.ownerMode` is
  `'invite'`) with no invited or accepted party on that side and offers `DeclinedInvitePanel`: invite another number (withdraw the
  declined row — `CoFillParties.withdraw` accepts `declined` — then `POST /{id}/parties`), or cancel
  the unpaid request.
- **Paying once the tenant is in.** When the tenant submits their half, `CoFillServiceRequests`
  notifies the owner (`service.party-details-submitted`, linking to `/services/rent-agreement`).
  The owner's locked panel shows `ReadyToPayPanel` for any `awaiting_payment` request with no
  `invited` party. Its Pay button stays disabled until the declaration is ticked again — the tenant's
  answers arrived after the owner's review-step tick — then it calls `POST /{id}/checkout` and then the same `payAndConfirm` as the inline
  submit. A refusal (missing paper, Aadhaar or witness) is shown as the server's 409 message.
- **The tenant cannot re-price.** The amount is fixed from the owner's terms at create, so a
  party-details write that would change the priced terms (rent, deposits, months, increment,
  interval, area) is refused 409; blank keys still keep the owner's values.
- **The tenant writes only the tenant half.** Everything else in the party-details payload — the
  licensor, the flat, non-priced terms, witnesses, `ownerName` — is dropped before the merge
  (`CoFillServiceRequests.ownSide`); an owner-side party would keep `ownerName`, `owner` and
  `coOwners`. A submit carrying no rows of the caller's side is 422, so the
  `party.details-submitted` event always means the tenant wrote the tenant rows.
- **No tenant OTP.** A typed tenant is not asked to confirm by code. The owner's declaration and
  payment are the commitment, and the tenant's identity is checked by the desk with the papers. The
  V45/V51 `rent_agreement_tenant_consents` table was dropped in V99.
- **One invitation per tenant** (UX-6). Each tenant row can be invited separately (V52
  `service_request_parties.party_index`); an invitee writes, uploads and is recovered only for
  their own row. An old invite-mode draft's `invite.invMobile` is moved onto `tenants[0]` on restore.
- **Companies, NRIs and foreigners** (LEG-1/LEG-3). A company or firm party (`type: entity`) is
  routed to the legal-desk quote flow. An NRI or foreign party (`residency`) takes the SRO route:
  passport instead of Aadhaar, visa/OCI and an optional FRRO number for a foreigner, and staff book
  the SRO visit. A foreign tenant is reminded that the owner files Form C on indiafrro.gov.in
  within 24 hours.
- **Identity numbers after a refresh** (UX-7). Autosave keeps only markers; after a reload,
  `IdentityReminderNote` names the PAN/Aadhaar fields to re-enter.
- **A closed checkout is resumed.** Closing the Cashfree sheet sends no webhook and leaves
  `paymentRef` set. A later `POST /{id}/checkout` asks the gateway for a fresh session on that same
  order (`PaymentGateway.resumeSession`, Cashfree `GET /pg/orders/{id}`, `ACTIVE` only) rather than
  opening a second one. If the order can no longer take a payment (expired, or paid and awaiting its
  webhook), the call is a 409. Both the locked panel and the amber "couldn't confirm" panel's
  "Complete payment" take this path.
- **Finishing a filing after a reload.** A filing whose identities or papers fell short, with no
  checkout open, is locked after a reload. The locked panel's "Add what's missing" reopens it: the
  draft (or, on another device, `details._state`) restores the answers, and every paper already on
  the request fills its slot by reference (`filedOn`), on any device, over a vault copy too, so it
  is neither re-picked nor re-sent. Only the statutory numbers are retyped, because they never
  leave the tab.
  - *Plain filing.* The next submit reuses the request when the answers are unchanged (`filingKey`
    compares key-order-independent, since jsonb re-sorts keys). If they changed, it cancels and
    refiles, but first it releases the by-reference papers for re-attaching (`docsReattach`),
    because cancelling would take the only copy with it. It never hits the one-unpaid 409.
  - *Co-fill filing* (a tenant still invited or accepted). It is only topped up: the owner's
    identities and missing papers go onto the same request, and nothing is cancelled or refiled.
    The answers are shared with the tenant and stay as filed, as the panel's hint says. A
    requester's `PUT /identities` never replaces an accepted party's roles.

### 5.7 Ops workflow (server-owned, `ServiceRequestStatus`)
- **Status ladder** (wire values; the tracker's names in brackets, `serviceRequestMapper.js`):
  `awaiting-payment -> new [submitted] -> assigned | in-progress [docs_review] -> draft-shared ->
  (changes-requested | approved) -> completed` (or `cancelled`). There is no `awaiting_party` or
  `registration` status: a co-fill request waits at `awaiting-payment`, and the window between
  `approved` and the registered copy is not a state. The transition table is in
  [`../ops/service-queues.md`](../ops/service-queues.md) section 7.2.
- Stepper `STEPS = [Submitted, Documents, Draft & approval, Registration, Ready]`
  (`lib/serviceRequestStatus.js`); `approved` shows as *Registration*.
- Desk actions: verify or reject each checklist paper (`PUT …/checklist/{category}`), revise the
  priced terms (`POST …/amendments`), share a versioned draft (`POST …/draft`, refused until every
  paper is verified and no revision is open), and upload the registered copy with its particulars
  (`POST …/final-doc`, `approved -> completed`). The customer opens and decides the draft
  (`POST …/draft/opened`, `POST …/draft/decision`). Each writes a timeline entry and notifies the
  other side.

### 5.8 Joint agreement for a split flat
A flat let room by room is covered by **one** agreement naming the owner and every current flatmate,
not one agreement per room - which is why rooms carved from the same listing all share a `propertyId`
(the key that ties them into one flat for both the occupancy ledger and the agreement). When
occupancy changes (`setRoomOccupants`, via the room card's +/- stepper in Flatmates), the existing
document no longer names the people actually living there, so the owner is offered a reissue at that
exact moment. See [`flatmates.md`](./flatmates.md) section 5 and the `?flat=&reissue=1` entry in
section 2.

### 5.9 Identity numbers never leave the tab (`captureShareableState`, `DRAFT_KEY` purge)

`captureFormState` is also the co-fill payload: it is posted as `details._state` so an invited
tenant can open the owner's half-filled form. But `details` is stored as plaintext jsonb and echoed
verbatim by `ServiceRequestMapper` on **every** read — including the paged ops queue — so sending
the raw state would hand the owner's PAN and Aadhaar, and every tenant's, to the invited stranger
and to any staff account that listed the queue. That is a bulk identity-document dump, and Aadhaar
in particular is not ours to spread (Aadhaar Act s.29).

The `dzDraft:rentAgreement` autosave is the same threat model on a shorter path: `localStorage`,
same origin, written on every keystroke and never expired. Both callers therefore get
`captureShareableState()`; the raw capture is used for the submission and for resolving
`useFormDraft`'s functional updater against live state, and for nothing else. Redaction happens in
the browser so the numbers never cross the wire at all — the server-side `details` allowlist is the
belt to that pair of braces.

Two purges run **on read**, not merely on write, because every owner who used the wizard before the
numbers were kept out already has a PAN and an Aadhaar sitting in their browser, and nothing else
ever revisits those keys:

- The `DRAFT_KEY` purge effect **must stay above the `useFormDraft` call**. Effects fire in the
  order their hooks were called during render, so declaring it first is what guarantees the entry is
  rewritten before the restore reads it back into the form. Reordering the two would put the numbers
  back on screen for one keystroke's worth of time.
- The `draazyOwnerKYC:<mobile>` purge rewrites the entry during the owner-KYC autofill — the only
  moment the app is guaranteed to touch that key.

A mid-form refresh therefore brings back every answer except those two, which the owner retypes; the
restored-draft banner says so rather than claiming everything came back.

### 5.10 Submit-time channels: identities, documents, payment confirmation

**No admin lead ticket is raised here.** `ServiceRequestService` commits the request at
`awaiting-payment` and `findForQueue` deliberately excludes that status, so an unpaid rent-agreement
request is invisible to ops on purpose. A ticket raised at submit would put the same enquiry on the
rental desk immediately — visible, callable, and indistinguishable from a paid one — defeating the
rule one layer down. (`ServiceLanding` posts a ticket because there the lead *is* the point: a free
quote enquiry. This desk is priced.) **BACKEND GAP:** the ticket should be raised server-side from
the payment webhook, where the request has actually been paid for. Until then the request itself is
the record, and the desk sees it when payment moves it out of `awaiting-payment`.

**Identity numbers ride their own narrow channel (D151).** `details` carries none — the wizard
redacts them and the server refuses them at any nesting depth, because `details` is plaintext
`jsonb` echoed verbatim to every staff read. But a Leave & License names each party by PAN and
Aadhaar, so `PUT /service-requests/{id}/identities` exists: it answers 204 (nothing to echo), stores
the rows outside `details`, refuses every reader except the operator the request is assigned to (an
admin included, until they take it), writes an audit row for each read *and* each refusal, and
blanks the numbers when the request completes or is cancelled. Nothing touches `localStorage` on the
way. It is separate from and after the create (the id must exist, and a create body carrying an
Aadhaar would put one on the response the tracker renders and logs), and before the checkout modal
(which can outlive the page). It is non-fatal: the request exists and is about to be paid for, so
throwing would tell a charged customer their submission was lost.

**Documents are a second call per file.** `createServiceRequest` carries `docs` no further than the
wizard — `toCreate` builds `{type, details, propertyId?, ticketId?}` and `POST /service-requests`
has no multipart half. Each file goes to `POST /service-requests/{id}/docs` with its `category`;
a request with no listing files them against the request alone (V40 made
`documents.property_id` nullable, with a CHECK that a row names a property or a request), so a
wizard opened cold from `/services/rent-agreement` uploads the same papers as one opened from a
listing.

**Payment opens only once the agreement is registrable.** A priced create commits the request at
`awaiting-payment` with no gateway order. The wizard then records identities, uploads documents and
calls `POST /service-requests/{id}/checkout`, which `RentAgreementReadiness` refuses (409, naming
what is missing) until every licensor and licensee has an Aadhaar-bearing identity row and their
papers, the tenant police address/work proof uploads required by the IGR portal, the flat has an ownership proof, both witnesses are recorded, and no Aadhaar repeats across
parties. Last, it refuses a deed missing its own particulars — a monthly rent (without one there is
no stamp duty to charge), the start date, flat number, society, locality, pincode, a residential
property type, the area, every licensor's and licensee's name, age and address, and each witness's name, age and
address — because create
takes a partial form so a draft can be filed and priced. Only then is the declaration checked: the
body must name the current `declaration` version (`RentAgreementDeclaration.VERSION`, matched by
`DECLARATION_VERSION` in `constants.js` and guarded by `RentAgreementDeclarationTest`), or the call
is a 409 "Accept the declaration…". Acceptance is written to the audit log as
`service-request.declaration-accepted` with the version and a SHA-256 of the English text, so who
authorised the filing, and to which words, survives the browser. A failure keeps the filed request, so a
retry resumes it instead of filing a second; a retry
whose details were edited meanwhile cancels that request (`POST /service-requests/{id}/cancel`) and
files the edited one, because the server takes no requester edits to `details` after the create. A
co-fill invite whose identities or papers fail is not shared until a retry lands them. In co-fill
each side writes only its own identity rows and files only its own side's papers (a tenant invitee
the `tenant` rows and `tenant-*` papers, 403 otherwise), so neither half can erase or impersonate
the other; an invitee's identity rows freeze once checkout opens (409). Once the invitee accepts,
each side's PAN, Aadhaar and photo scans carry a download link only for that side and ops; the other
side sees the paper listed as filed with its `url`, `fileName`, `sizeBytes` and `mimeType` null. Ownership proof and a POA stay readable to
both, since checking them is the tenant's due diligence. Checkout itself runs the
readiness gate, calls the gateway outside any transaction, then re-checks under the row lock before
binding the order, so a second tap loses with a 409 rather than opening a second payable order.

**The checkout modal closing is not proof of payment.** Only the signature-verified webhook moves
the request to `new` (or cancels it), and being server-to-server it lands seconds after the customer
is back on the page. A single re-read therefore reads `awaiting_payment` on almost every
*successful* payment, so the reward for paying was an amber "it didn't go through" panel and an
invitation to pay twice. The page polls instead (`PAYMENT_POLL_BACKOFF_MS`) and treats "still
awaiting" as not-yet-known until the budget is gone. Within the loop: only a status actually
received overwrites the last one, so a dropped request mid-poll cannot erase a verdict already read;
the loop `break`s rather than `return`s on unmount so it still falls through to `clearDraft()` — a
paid request that leaves its draft behind re-offers a form the owner has already been charged for.

**Local mock payments.** With `CASHFREE_ENABLED=false` the gateway is `MockPaymentGateway` and no
webhook ever arrives. In a dev build, `useRaPayment` asks "Local mock payment: mark this rent
agreement as paid?" and calls the `@LocalOnly` `POST /service-requests/{id}/payment/simulate?outcome=paid`
(requester only, `mock_order_*` only), which runs the same `applyWebhookOutcome` as the webhook.
Playwright dismisses the dialog, so e2e keeps the unpaid path.

## 6. Maker-checker / approval
Four loops (the shared pattern is [`../../system/cross-cutting.md`](../../system/cross-cutting.md)
section 2; the desk side is [`../ops/service-queues.md`](../ops/service-queues.md) section 6):
1. **Co-fill (owner <-> tenant):** the owner files and invites the tenant (maker); the tenant
   accepts and completes their half from their own account (co-maker). Checkout stays shut until the
   tenant has accepted and the deed is registrable.
2. **Papers (customer <-> desk):** the desk verifies or rejects each paper with a reason; a rejected
   paper goes back to the customer, and the draft cannot be shared until every paper is verified.
3. **Draft approval (desk <-> customer):** the desk shares a draft (`draft-shared`); the customer is
   the checker and must open the current version first. `approved` moves on to registration;
   `changes-requested` returns it for a new version. Revised priced terms are accepted, and any
   difference paid, by the customer before the draft can go out.
4. **Registration (operator <-> second operator):** the operator who uploads the registered copy
   prepares the tenancy rows; a different operator marks each `registered`.

## 7. State machine
```
Co-fill party:   invited --tenant accepts--> accepted --tenant submits their section
                    |  \--tenant declines--> declined --owner withdraws + re-invites--> invited
                    +--(owner withdraws / cancels the unpaid request)

Request (server wire values):
  awaiting-payment --signed webhook--> new --desk--> assigned | in-progress
  assigned | in-progress --share draft--> draft-shared
     draft-shared --customer approves--> approved --registered copy uploaded--> completed
     draft-shared --customer rejects--> changes-requested --new draft--> draft-shared (loop)
  any non-terminal --cancel--> cancelled
```
- Terminal: `completed` (registered, final document downloadable) and `cancelled`. `isActive` is
  neither.
- The owner's create-wizard is `locked` while an active (`isActive`) rental request exists;
  `startNewAgreement` clears the draft and unlocks a fresh form for a different property.

## 8. Edge cases, validation & error states
- **Not signed in:** fillable, but `generate`/invite bounce to sign-in (draft restored). Invite mode
  forces sign-in; the invited number is never put in the URL.
- **Not a party / expired / declined invite:** `inviteError` renders the neutral "no longer
  available" state; the request read 404s, so no data is exposed.
- **Owner's invite was declined:** the locked panel offers re-invite or cancel (5.6).
- **Tenant has accepted or finished:** the locked panel offers Pay; checkout's 409 is shown (5.6).
- **Owner already has an active request:** wizard is locked to the tracker (Messages / draft
  approval); `startNew` is the explicit escape hatch.
- **Field validation:** the rules in 5.3; declaration required at Review.
- **Unfinished paperwork:** checkout 409 names the missing party, paper or witness; the request stays
  `awaiting-payment` with no order. The sweep retires it 30 days after its last change, which frees
  the one-unpaid-request slot and discards its identity rows; the customer can cancel it sooner. A
  row whose checkout opened is retired on the abandoned-checkout TTL, counted from that opening.
- **Document size/dupes:** oversize files (`tooLarge`) are excluded from `collectDocs` and vault
  saves; duplicate vault docs (same category+name) are skipped.
- **Submit failure:** `generate` wraps persistence in try/catch and toasts `saveError` without
  advancing.
- **Autosave scope:** draft ignores `oName`, `oMobile`, `step` and is disabled in invite mode / after
  `done`.
- **Concurrency:** the two sides never write the same keys. The requester cannot edit `details`
  after the create, the invited tenant's `PUT …/party-details` writes only the tenant half and
  cannot move the priced terms, and checkout re-checks readiness under the row lock.
