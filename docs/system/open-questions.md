# PuneNest — Open Questions

**Status:** living document. Companion to [`tech-debt.md`](./tech-debt.md).

**What belongs here.** Anything blocked on a *decision* rather than on engineering time — product
calls, unresolved contradictions between two parts of the system, and questions whose answer changes
what we build rather than when.

**Why it is separate from the tech-debt register.** A backlog reader picks up the top item and
starts. An item that reads "decide whether owners can hide their number even after approving" cannot
be started by that person, so in a mixed list it is scrolled past every time — permanently. Keeping
the two apart means the register stays 100% actionable and this file stays 100% a decision queue.

**Lifecycle.** Answer → record the answer here with its date → move the resulting work into
`tech-debt.md` (or straight into a slice) → mark the question **CLOSED**. A question is never
deleted; the answer is the valuable part.

---

## Engineering decisions blocking specific work

### Q2 — Can owners hide their number even after approving a request? *(blocks D5)*

The frontend mock has a `hideNumber` preference; there is no `users.hide_number` column and no
contract field. The question is whether the product wants it at all.

Against: approving a contact request *is* the act of sharing a number — a preference that silently
un-does it makes the approve button mean two different things, and buyers will read it as a bug.
For: some owners want in-app chat only, which is a coherent (and different) product.

Note this overlaps Q5 — if the answer to Q5 is chat-first, this preference may be the wrong shape
for the requirement entirely.

**Owner:** product. **Status:** OPEN.

---

### Q13 — Should scoped back-office accounts exist server-side at all? *(blocks D13)*

Raised 2026-08-11 while removing `settings.customRoles` (D67). The admin console has a whole
Team & Access model — a per-user `roleId`, a `moduleAccess` list, named custom-role bundles — and
**none of it exists on the server**: no `users.role_id`, no `module_access`, no claim, no
team-member endpoint. It lives in browser storage. So this is not an unfinished feature; it is a
feature that was only ever drawn.

Three answers are needed before anyone writes code, and the first is the one that decides the
other two:

1. **Do we want per-account scoping at all, or is per-team scoping the model?** Today access is
   `role` plus `users.team` plus the `permissions` allow-list, which is enforced and narrows
   correctly. Per-account scoping means a team-member management slice — invite, assign, revoke,
   audit — not a column.
2. **If custom roles return, must they only narrow?** `PermissionMap`'s rule is that a stored
   document can only ever remove access; the console computes `BASE ∪ role-bundle ∪ moduleAccess`,
   which adds it. A widening document is a privilege-escalation surface — an operator would be
   granting through settings what the role guard was written to withhold — so it cannot be adopted
   as drawn. Narrowing-only is implementable today; widening needs a story for who may grant what,
   and a guarantee that nobody can grant beyond their own authority.
3. **What does a "module" grant mean server-side?** The bundles name client modules
   (`enquiries`, `content`, `properties:verify`); the server's vocabulary is four `Capabilities`,
   three of them enforced. Either modules map onto capabilities — which means agreeing that mapping
   as policy — or a new route-level vocabulary gets designed. Neither is a backend chore.

Until then the answer is visible rather than silent: the key is deleted (`V61`) and writing it is
refused with 422, so the console cannot accumulate access rules that nothing honours. The client
was brought into line on 2026-08-10: custom roles moved out of the settings document into their own
console-local collection, so nothing the mock would hand to `PUT /admin/settings` carries the key,
and the Custom roles tab is labelled *console-only — not enforced by the server*. The editor was
labelled rather than deleted precisely because question 1 is open; removing the UI would answer it
by attrition.

**Owner:** product, then backend. **Status:** OPEN.

---

### Q14 — Does an owner's edit take the listing offline, or does it stay live and get flagged? *(blocked D76)*

Raised 2026-08-10. There are two coherent designs for what happens after an owner edits an approved
listing, and the codebase has been shipping one of each.

- **The server's:** `ListingService.update` calls `Property.revertToPending()` whenever a foundation
  field changes, so the listing leaves search until a moderator re-approves it. Safe, and the
  strongest possible anti bait-and-switch — nobody sees the changed listing until somebody has
  looked at it.
- **The client's Tier A/B model:** the edit stays live and is flagged for a fast re-check. Kinder to
  the owner, and much kinder to the number the platform actually lives on — a listing that goes dark
  for a day every time its price moves teaches owners not to move the price, which is the opposite
  of what a marketplace wants.

Both are defensible; they are different products, not a bug and a fix. What was *not* defensible was
the client describing the second while the server did the first, so the owner-facing banner now
reports the server's rule truthfully (D76) and `npm run check:listing` keeps it that way. The
question left is which contract we want:

1. **Does a price change really need to cost a takedown?** Price is the most-edited field on any
   marketplace and the one an owner is most often asked to move. A revert on price is the harshest
   rule with the weakest bait-and-switch argument — the buyer sees the new price either way.
2. **If some foundation edits stay live, which?** Locality and property type are identity; price and
   furnishing are not. A split set is implementable (`apply` already returns one boolean; it would
   return two) but it is a policy decision about what a moderator is protecting against.
3. **Is "live but flagged" enough of a control?** It needs a queue that is actually worked, and an
   SLA — otherwise it is a flag nobody reads and the anti bait-and-switch rule has quietly become
   opt-in.

**Answered 2026-08-11 — neither design wholesale; the set splits.**

- **Stays live, re-checked in the background:** `price`, `furnishing`, `possession`.
- **Goes off search, reverts to `pending` as before:** `locality`, `propertyType`, `bhk`, `deal`.

The line is what the edit does to the *claim*, not how much the value moved. The second group changes
what the listing fundamentally is, so a stale index entry would actively mislead searchers — a 2BHK
appearing under 3BHK, or a rental under sale, is a wrong answer, not a slightly stale one. The first
group changes an attribute of a listing that is still the same property, so the worst case is a
briefly out-of-date number on a listing that is still genuinely what it claims to be. Fraud risk is
handled by the re-check either way; the difference is only whether the listing earns while it waits.

That answers the three sub-questions in order. (1) No — price is the most-edited field and the one
with the weakest bait-and-switch argument, since the buyer sees the new price either way. (2) The
split above; `apply` now returns an `EditImpact` record rather than one boolean, which is exactly the
shape sub-question 2 predicted. (3) "Live but flagged" needed a work item that was not the `pending`
status itself and not `flagged` (which also removes the listing from search), so `V62` adds
`properties.recheck_requested_at` + `recheck_reason` beside the existing `flag_reason`, `GET
/admin/properties?recheck=true` is the queue, and `PATCH /properties/{id}/status` with `approved`
clears it. ~~**The SLA and the admin UI for that queue are not part of this answer**~~ — **the UI
shipped 2026-08-11**, on the reasoning that a stays-live re-check nobody is shown is not a
rebalanced control but a loosened one. `/admin/properties` gained a **Re-check Queue** tab (oldest
first, showing the changed fields and the waiting age, pass or reject via the existing status
transitions, count surfaced in the tab label and a KPI). **The SLA itself is still not answered**:
the tab escalates its age colour at 24h and calls a row overdue past 72h, but those two numbers were
chosen to make the age legible, not agreed as a commitment — nothing enforces them, nothing alerts
on them, and no one is paged. Deciding the real SLA (and whether breaching it should auto-revert the
listing to `pending`) remains open and is carried on D76.

Work landed in `tech-debt.md` **D76**.

**Owner:** product, then backend. **Status:** CLOSED (2026-08-11).

---

## Product / GTM questions (from the trust-model pivot)

These predate the backend work and are recorded here so they stop living as an unticked checkbox
halfway down a 2,700-line worklog. Source: `docs/system/trust-and-verification-model.md`, ADR-019.

### Q6 — Freshness ping cadence

"Still available?" pings plus auto-expiry are the **top-priority anti-spam lever** in the badge-not-gate
model — the thing that replaces mandatory KYC as the staleness defence. The cadence (and what happens
on no reply) is undecided, and it has a backing-column consequence: there is currently no freshness
column, which is why the `dormant` status is unimplemented.

**Owner:** product. **Status:** OPEN.

### Q7 — L1 contact-reveal vs chat-only

Does an L1 (mobile-verified) user get the owner's number on approval, or in-app chat only? This is
the same decision as Q2 seen from the buyer's side, and it determines whether the contact gate's
payoff is a phone number or a thread.

**Owner:** product. **Status:** OPEN.

### Q8 — Broker-lane timing

Brokers are explicitly *not* excluded by the thesis (the incumbent analysis concluded brokers are
paying customers and liquidity beats purity). When the broker lane opens — and whether it is a
distinct role or a flag — is undecided.

**Owner:** product. **Status:** OPEN.

### Q9 — Which five localities launch first?

Corridor GTM (Hinjewadi–Wakad–Baner) is the recommendation on record; the actual five are not
chosen. Seed data and the locality reference table are already built, so this is a data decision, not
a schema one.

**Owner:** product. **Status:** OPEN.

### Q10 — Phase 0 gate: 50 hand-recruited Pune owners

The trust-model roadmap sets this as a **gate before further product build**: hand-recruit 50 real
owners with real listings, to validate that supply can be acquired without brokers. The backend has
since been built well past that gate.

That is not necessarily wrong — the backend is a fixed cost that had to be paid — but the gate should
be either honoured or consciously retired, not silently passed. **Recording it as passed-by-default
is the thing to avoid.**

**Owner:** founder. **Status:** OPEN.

---

### Q11 — Flatmates: what is the gate, and does it monetise?

Rescued 2026-08-08 from `docs/feature review/02-flatmates-market-and-feature-review.md` before that
document was deleted. Q9 records the corridor recommendation and Q10 records the *buy/rent* supply
gate; neither carries the flatmates-specific number, its window, or the monetisation half — which is
the part that decides what Flatmates *is*.

The proposed gate: **100 verified rooms/groups across Hinjewadi–Wakad–Baner within 60 days, with at
least one paid move-in service sold.** The two halves are deliberately separate, and the second is
the one that matters:

- Listings arrive **and** something sells → Flatmates is a product line.
- Listings arrive but **nothing sells** → Flatmates is a cheap acquisition funnel for the rent
  business, and should be staffed and prioritised as one — not given its own roadmap.

This matters now because the build has gone well past the discovery surface: groups, applications,
moderation and host verification all shipped. Deciding after more machinery is built is deciding by
sunk cost.

**Owner:** founder. **Status:** OPEN.

---

### Q12 — Flatmates: matching quality vs more moderation machinery

Also rescued from the same deleted review. The stated differentiator over a WhatsApp group is
"shows me people I'd actually live with" — i.e. **compatibility matching**, not filtering. Today
neither exists server-side: D116 records that the three flatmate controllers accept ten compatibility
facets and silently ignore all of them.

So the next unit of Flatmates work is a fork:

- **Matching** — make the ten facets real, then rank rather than filter.
- **Moderation** — more host verification, more queue tooling, more review states.

The review's position was that moderation was being built ahead of the thing users came for. That is
a prioritisation call, not a defect, so it lives here rather than in the debt register. D116 fixes the
contract bug either way; this decides whether anything is built *on top of* it.

**Owner:** founder / product. **Status:** OPEN.

---

## Closed

### Q15 — What must a listing carry before it can claim "verified"? *(closed 2026-08-11)*

**Answer: three required artefacts — ownership proof, owner identity, physical existence.** RERA
cross-check was *not* selected (it only applies to new projects, and the registry integration is a
project of its own). Moderator discretion alone was explicitly rejected.

| Artefact | Accepted evidence |
| --- | --- |
| Ownership proof | Property tax receipt, electricity bill, or Index II |
| Owner identity | Aadhaar or PAN on the posting account |
| Physical existence | Timestamped photos or a video walkthrough |

**Why this matters more than it looks.** Today `ListingService` has *no* document gate — "verified"
is a moderator's opinion with no required evidence behind it. That is how a "Society Verified" badge
came to render for buildings nobody had confirmed exist (the catalogue was fabricating
`registration: true` for unknown slugs, D101). A badge that can be granted without evidence is not a
trust signal, it is decoration, and the badge-not-gate thesis in ADR-019 rests entirely on the badge
meaning something.

**Consequence:** verification becomes a *checklist with state*, not a boolean. Each artefact needs
its own upload, review outcome and expiry — a tax receipt from 2019 is not proof of anything today.
Work tracked as **D190**.

### Q16 — Which surface is the primary revenue engine? *(closed 2026-08-11)*

**Answer: none of the four yet — deliberately.** The cold-start problem outranks monetisation. Owners
and seekers must both be active before any surface is worth charging for, so the **referral programme
exists specifically to route around the paywall** during the liquidity build. Of the paid surfaces,
**the rent-agreement service is the main revenue source for now.**

This is a real decision, not a deferral, and it has three immediate consequences:

1. **The owner paywall is a growth *tax* during this phase, not a revenue line.** Anything that makes
   the free tier harder to reach is working against the primary goal. The one-free-listing limit
   should be measured on suppression, not on conversion.
2. **Rent agreement is the surface that must not break.** It is the only one taking real money today,
   which promotes its failure modes from "bug" to "revenue incident". Its fee maths is already gated
   by `check:finance` (26 checks); that gate is load-bearing and should stay strict.
3. **Contact reveals, subscriptions and boosted placement stay built but stay quiet.** They are not
   removed — they are the mix we return to once liquidity exists (see Q16a below).

**Follow-on, still open (Q16a):** what liquidity level flips monetisation on? Q10's "50 hand-recruited
owners" gate and Q11's flatmates gate are the two numbers already on record; this needs the
equivalent for the rent business. **Owner:** founder. **Status:** OPEN.

### Q17 — What counts as a genuine referral? *(closed 2026-08-11)*

**Answer: credit only on a qualifying action.** Not verified-mobile (a SIM costs less than the credit
it mints), not referee identity verification (too much friction on the exact surface we are using to
buy liquidity), not manual review (does not scale and delays the reward that makes referrals work).

**This answer interlocks with Q15 and Q16, and that is the point.** Referral credits offset the
paywall (Q16), so a fraudulent referral costs us listing quota rather than cash — but it buys the
fraudster *supply-side spam capacity*, which is the one thing the whole trust model is built to keep
out. Since Q15 now requires real documents before a listing is verified, the natural qualifying
action is the one that is already expensive to fake:

> **A referral credits the referrer when the referee's first listing passes verification** — i.e.
> clears the Q15 document gate.

That makes minting a credit require a genuine property with genuine ownership proof, which is not
worth doing for a free listing slot. No new fraud machinery is needed; the document gate does the
work twice.

**Current state:** `pnReferralStats` counts `invited` / `joined` / `listed` and issues credits off
those raw counters, with no distinctness check at all. Work tracked as **D191**.

### Q18 — What should the ops console be allowed to see and act on? *(closed 2026-08-11)*

**Answer: scope by team, with admin-defined per-user permission sets.** The admin creates each ops
user and chooses that user's permissions directly, rather than picking from fixed role bundles.

**This is the feature `settings.customRoles` was reaching for — and it must be rebuilt on the other
side of the wire.** That field was removed this wave because the admin console computed a *widening*
permission set (`BASE ∪ role-bundle ∪ moduleAccess`) while the server's `PermissionMap` may only ever
*narrow*. Honouring the client's set would have been privilege escalation, so the client-side version
was not a partial implementation of this answer — it was the inverse of it.

Rebuilding it properly needs, server-side and in this order:

1. A **permission catalogue** — the closed set of things an ops user may be granted. It must be
   derived from `PermissionMap` so that a grant can never exceed what the server already enforces.
2. **Persistence** — a per-user grant set. `roleId` and `moduleAccess` exist nowhere server-side
   today: no column, no claim, no endpoint.
3. **The claim** — grants must reach the request as a verified claim, not as anything the browser can
   assert.
4. **Admin UI** — user creation with a permission picker, following the existing console patterns.
5. **Enforcement stays server-side.** The UI hides what a user cannot do; the server *refuses* it.
   The UI is a convenience, never the control.

Until this lands there is **one flat admin role**: every moderator sees every listing, every user and
every payment. Work tracked as **D192**.

### Q3 — Legacy `enquiries`: implement or formally deprecate? *(closed 2026-08-09)*

**Answer: (c) remove it from the spec entirely.** On inspection the removal was already done — the
`GET /enquiries` path and the `Enquiry` schema were dropped from the OpenAPI spec in slice-12 (S45)
and the `enquiries` table was dropped in V22. So this needed no spec or backend change: only doc
hygiene, which is complete — the stale `Enquiry`-schema row and `enquiries` ER relationship were
removed from `data-model.md`, and register item **D17 was deleted**. The frontend `/admin/enquiries`
funnel is a separate deals/leads *metric* surface and is deliberately untouched.

### Q4 — Should there be a cap on saved-searches *count* per user? *(closed 2026-08-09)*

**Answer: yes — max 10 per user.** Implemented in `SavedSearchService.create`: a user already holding
ten gets `409 Conflict` ("delete one to add another"), a well-formed request that conflicts only
with their own state. Ten is far beyond a genuine set of standing alerts while still bounding the
standing workload any future scheduler re-runs. Documented on `POST /me/saved-searches` and covered
by `SavedSearchCapTest`. No register item — shipped inline, not deferred.

### Q5 — `reels.locality`: display names or slugs? *(closed 2026-08-09)*

**Answer: (A) carry both — a display caption and a slug, mirroring `Property`.** A reel's caption
stays a display label ("Koregaon Park") because that is what the clip says on screen; the feed
filter moves to a new `reels.locality_slug` column ("koregaon-park"), the same locality vocabulary
every other surface keys on. This is the only shape that is consistent both ways: the frontend
sends the slug it already holds, and the caption is not forced into a machine key. Shipped in V38
(add column + backfill by joining the curated `localities` table + index), the `R__` seed now
carries a slug per reel, `ReelController` filters on `findByLocalitySlugIgnoreCaseOrderByCreatedAtDesc`,
the `/reels` `locality` param is documented as a slug, and `ReelSlugFilterTest` covers it. Register
item **D16 was deleted**.

### Q1 — What is a valid mobile on input? *(closed 2026-08-09)*

**Answer: (A) normalise, then validate — tolerant input, strict storage.** A new `@IndianMobile`
composed constraint (backed by `IndianMobileValidator`) replaces `@Pattern(Formats.MOBILE)` on every
mobile *input* field. It accepts what people actually type — spacing and a `+91`/`0091`/`0` country
code — by delegating to `MobileMask.normalise()`, then gates the *normalised* value against the
stored `Formats.MOBILE` shape (`^[6-9][0-9]{9}$`). That second gate matters: `normalise()` fails
closed on length only, so without it a ten-digit number with a leading 1-5 would pass the edge and
then be rejected by a column CHECK as a 500. Because a `ConstraintValidator` cannot mutate, each
consuming service normalises at the persist/lookup edge — `AuthService.login`,
`ConversationService.start`, `DealService.addParty`, `SocietyLeadService`, `CityService`,
`RentAgreementService`, `FlatmateSupplyService.ownerConsent`, `UserAdminService.addStaff`, plus the
finalization/close paths that already did. The OpenAPI `Mobile` schema keeps its strict pattern as
the stored/returned shape and now carries a description noting the input tolerance. The frontend was
already hardened: the shared `MobileField` renders a fixed `+91` chip and accepts only ten digits.
Covered by `IndianMobileValidatorTest` plus updated edge tests in `DealEndpointsTest` and
`ConversationEndpointsTest`. Register item **D23 resolved**.
