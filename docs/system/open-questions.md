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

### Q1 — What is a valid mobile on input? *(blocks D23)*

Two components in the codebase already disagree.

- The DTO annotations enforce `^[6-9][0-9]{9}$` — **rejects** `+91 9821000123`.
- `common.trust.MobileMask.normalise()` **accepts** it and canonicalises to `9821000123`,
  deliberately tolerating `+91` / `0091` / `0` prefixes because "that is a normal way to type a
  number" (its own Javadoc).

Both cannot be the rule. The shared `@IndianMobile` annotation cannot be written until one is chosen.

| Option | Consequence |
|---|---|
| **A. Normalise, then validate** | Best UX — users paste numbers with country codes and spaces constantly. Requires a `ConstraintValidator` (not a bare `@Pattern` meta-annotation), and a decision about whether the *stored* value is the normalised form (it should be). |
| **B. Tighten `normalise()` to match the strict pattern** | Simplest; one regex everywhere. Rejects input users will genuinely type, pushing the burden to the client. |

**Recommendation: A.** The strict pattern is the *storage* invariant; input tolerance is a separate,
kinder concern, and `normalise()` already exists and fails closed. **Note:** the OpenAPI `Mobile`
schema documents the *stored/returned* shape, so option A does not require a spec change — worth
stating explicitly in the schema description either way.

**Owner:** backend + product. **Status:** OPEN.

### Q2 — Can owners hide their number even after approving a request? *(blocks D5)*

The frontend mock has a `hideNumber` preference; there is no `users.hide_number` column and no
contract field. The question is whether the product wants it at all.

Against: approving a contact request *is* the act of sharing a number — a preference that silently
un-does it makes the approve button mean two different things, and buyers will read it as a bug.
For: some owners want in-app chat only, which is a coherent (and different) product.

Note this overlaps Q5 — if the answer to Q5 is chat-first, this preference may be the wrong shape
for the requirement entirely.

**Owner:** product. **Status:** OPEN.

### Q3 — Legacy `enquiries`: implement or formally deprecate? *(blocks D17)*

`GET /enquiries` is the pre-ADR-019 lead model. V4's header calls the schema deprecated but retained
for back-compat; it is in the spec, unimplemented, and not marked deprecated — the worst of the three
possible states, because a client author cannot tell which way it will go.

Options: (a) implement it as specified; (b) mark `deprecated: true` with a sunset version and leave it
unimplemented; (c) remove it from the spec entirely. **(b) or (c) is almost certainly right** — the
contact-request model replaced it — but the admin enquiries funnel flow doc still references it, so
this is a product call, not a cleanup.

**Owner:** product + backend. **Status:** OPEN.

### Q4 — Should there be a cap on saved-searches *count* per user?

The saved-search blob is already size-bounded. A cap on how many a user may create is a new product
rule, not a bug fix, and needs a number somebody is willing to defend.

**Owner:** product. **Status:** OPEN.

### Q5 — `reels.locality`: display names or slugs? *(relates to D16)*

The column holds display names. The filter is case-insensitive, so either works today, and nothing
has decided which the frontend will send once `VITE_API_MODE=http`. Deciding late means one side
retrofits.

**Owner:** frontend integration slice. **Status:** OPEN.

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

## Closed

*(none yet — as questions are answered, move them here with the answer and the date.)*
