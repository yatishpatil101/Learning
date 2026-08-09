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
