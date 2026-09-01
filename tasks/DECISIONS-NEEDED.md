# Decisions needed to finish the mock retirement

Every item below is a place where the migration stopped because the answer is a product or
security call, not a mapping. Each one is already written up in full in `tasks/todo.md`; this file
is the short version, so the whole set can be answered in one sitting.

Nothing here is blocking test-suite work — the branch is green. These are what stand between the
current state and **P5c, deleting `lib/mockApi.js`**.

---

## 1. Reels: how does the feed get its photos?

The reels page still reads the mock catalogue because `GET /properties` sends `coverImage` and no
`images` array, and the page needs three photos per listing before it will show one. Sixteen
approved listings currently qualify.

- **(a)** The list response grows an `images` array. Simplest; makes every list response bigger for
  every caller, including search.
- **(b)** The list row grows an `imageCount`, and the feed fetches details for the ~15 rows that
  pass. Keeps the list small; costs one round trip per reel.
- **(c)** A dedicated feed endpoint that returns the already-gated set. Most work; the feed stops
  being a filtered search and becomes its own thing, which it arguably already is.

**My recommendation: (b).** It keeps the list endpoint honest for its main caller (search), and the
feed is a small, scroll-paced surface where a per-item fetch is cheap.

---

## 2. Admin-editable content: where do translations live?

The help FAQ page localises each row (`q_mr`, `a_mr`, …) but `FaqResponse` has no translation
fields. No seeded FAQ has a Marathi variant today, so moving the page would look fine and then
silently regress the first time someone writes one.

- **(a)** Suffixed columns — `question_mr`, `answer_mr`. Matches what the frontend already expects.
- **(b)** A `translations: { mr: { … } }` sub-object on the response.

This should be answered **once for all admin-editable content**, not just FAQs — announcements,
services and banners have the same shape.

**My recommendation: (b)**, because adding a third language under (a) means new columns on every
content table, and the frontend's `localizeRecord` helper can be taught the nested shape in one place.

**DECIDED (b) — shipped.** `V84__content_translations.sql` adds `translations jsonb not null
default '{}'` to `faqs`, `announcements`, `banners` and `cms_services`, keyed language → wire field
name. `HelpFaq.jsx` now reads `services/contentService` and `lib/contentLang.js` reads only the
nested shape; the mock provider converts its suffixed fields on the way out. Proved by
`ContentTranslationsTest` (6) and `live-faq-translations.spec.js` (3). Two of the nine seeded FAQs
are translated, one of them only partly, so the per-field fallback has a fixture that can fail.
Two things the decision did not settle and that are written up in `tasks/todo.md`: `AdminContent.jsx`
still cannot write a translation because that screen is on the mock, and `ContentWrite.translations`
replaces rather than merges — the one deliberate departure from that record's "null means leave
alone" rule, without which a language could never be removed.

---

## 3. Is a customer's accepted quote the same number as ops' deal value?

The Move-in Pack booking writes a ticket carrying the pack total. `TicketCreate` deliberately
refuses to let a client set `value`, on the stated grounds that "a client that could set its own
deal value would be writing the pipeline report."

Right now that lead is **lost entirely** in live mode — it only ever existed in the mock.

- **(a)** They are the same. Let the booking set `value`.
- **(b)** They are different. `TicketCreate` gains a separate `quotedValue`, and ops still own
  `value`.

**My recommendation: (b).** A published pack price and a negotiated deal value are different facts,
and collapsing them makes the pipeline report unauditable.

**DECIDED (b) — shipped.** `V83` adds `tickets.quoted_value`; the field is write-once and rupees,
not paise (the entity's paise Javadoc was wrong and is corrected). Along the way: `tickets.value`
turns out to have no write path at all — no client, no PATCH schema, no seed sets it — so ops do not
in fact own it yet. Recorded in `tasks/todo.md`, not fixed here.

---

## 4. How does an anonymous waitlist signup reach the server?

The "notify me" form on Services deliberately does not require sign-in — its own comment says
"no forced sign-up — we only need a valid mobile to follow up". There is no way to map it onto
`POST /tickets`: sending it authenticated locks out the visitor the form exists for, and sending it
as the signed-in user attributes a stranger's lead to whoever last used the browser *and* throws
away the mobile that was the entire point.

This needs a **public, rate-limited lead route** (`POST /leads`, mobile + interest + optional name).
It is the only item on this list that is also a security decision — a public write endpoint needs
its own throttle and its own abuse story.

**My recommendation: build it**, but as its own small piece of work with a rate limit designed in,
not as part of a migration commit.

**DECIDED — shipped.** `POST /service-waitlist`, public, taking `{ service, name?, mobile }` and
writing a ticket onto the desk that owns the service. Three corrections to the framing above came
out of the research:

1. **The throttle did not need designing.** The platform already has three rate-limiting mechanisms
   — `WriteRateLimitFilter` (per IP, every mutating request), `RateLimitLock` (a Postgres advisory
   lock plus a count-in-window, in the shared kernel) and `BotDefenceFilter` (Cloudflare Turnstile,
   whose `CHALLENGED` set was already exactly the anonymous writes). The work was three lines and
   one new enum value, `RateLimitLock.Limit.SERVICE_WAITLIST`, not a design.
2. **Not `POST /leads`.** A `service_waitlist` table beside `city_waitlist` would have solved the
   storage question and left the actual complaint — the lead is lost — unresolved, because nothing
   would read it. The ops board already exists and ops already work it, and the Move-in Pack's real
   bookings already land there (D3), so the follow-up call happens in the same place either way.
3. **Its own controller and its own top-level path**, not a method on `TicketsController` or a
   `/tickets/waitlist` suffix. Everything else under `/tickets` is ops-only; one `/tickets/**`
   matcher added in either direction would open the board or close the form, as a one-line change
   with no test to fail.

What the caller controls is a service slug from a closed set (`ServiceWaitlists`) and a
120-character name. Team, subject, priority and status are all derived server-side. Answers 201
whether or not a row was written, and never returns an id. `V85` adds `idx_tickets_mobile_created`,
without which the budget count would be a sequential scan on an unauthenticated path.

Covered by `ServiceWaitlistTest` (12) and `live-move-in-pack-waitlist.spec.js` (4). Two things
deliberately left: the pack's prices and its coming-soon switch are still read from browser storage,
and the demand-gap signal (`addDemandAlert`, a different feature) still has no server home at all —
both recorded in `tasks/todo.md`.

---

## 5. Should the interior and valuation forms still raise a board ticket?

These two forms currently create *both* a mock ticket and a real service request. The service
request half already reaches Postgres, so **no lead is being lost** — they land on the ops service
queue rather than the ticket board.

Adding the ticket back would create two unlinked rows: `TicketCreate` has no service-request field,
and the service request the seam sends carries no `ticketId` (though the column and a
`?ticketId=` filter both exist).

- **(a)** Drop the ticket. The ops queue is the real system now.
- **(b)** Keep both, and link them — the service request sends its `ticketId`.

**My recommendation: (a)**, unless ops actually work the board. Worth asking them.

---

## 6. Two counters that need small server endpoints

Both are recorded, neither is built. Both are the same shape as the locality `listingCount`
decision that was already made (D7.2), so if that ruling stands these are just work, not decisions:

- **Homepage trust counters** — `{ verifiedListings, totalListings, verifiedOwners }`, optionally
  per locality. Cannot be computed on the client: the distinct-owner count needs `ownerId`, which
  the list response does not send, and counting distinct owners across one page of results is a
  wrong number that looks right.
- **Public owner profile** — needs a deliberately-shaped projection, because the mock returns the
  user record spread whole and D5/Q2 says a buyer never sees an owner's raw mobile pre-deal. The
  real question is what a stranger may learn about an owner from a guessable URL.

---

## What happens to each answer

1, 2, 6 unblock four consumer pages. 3, 4, 5 unblock the services cluster. With all six answered,
`lib/mockApi.js` can be deleted; without them it cannot, because these pages would lose data or
show wrong numbers rather than simply failing.

---

# Round 2 — answered

The six above are closed (1, 2, 3, 4, 5 shipped; 6b shipped as D6b). What follows is the
second round, put to the product owner once the first round's work had run out of
unblocked items. **All six were answered "build it" except the last.** They are recorded
here in the same form, so that the reasoning behind each is recoverable later from
something other than a commit message.

A note on why this round exists at all. The first round's items were mostly *mappings* —
a page read something the server did not yet send. This round's are different in kind:
each one is a place where the mock provider **invented a capability the server was never
asked for**, and the question is whether that capability was ever real. Answering "retire
it" would have been cheaper in every case, and was recommended in three of them. It was
declined in three of those, which is a product judgement about what the app is for and
not something the migration could have decided on its own.

## 7. The consumer dashboard's Enquiries panel reads a view that was never modelled

`useDashboardData.js:287` reads `listEnquiries`, whose mock (`collections.js:5-9`) returns
the raw localStorage array **unfiltered by user**. `Routes.java:1437` is blunt about why
there is nothing to repoint to: "There is no `enquiries` table; the console's Enquiries
page was a mock-side union of contact requests, chat threads, visits and deals."

- **(a)** Model an enquiries projection server-side.
- **(b)** Retire the panel with the mock. *(recommended)*

**DECIDED (a).** The recommendation was to retire, on the grounds that the buyer already
has Contact Requests, Visits and Messages as separate panels and this one is a union of
things they can already see. That was overruled, and the override is the right one for a
reason the recommendation undervalued: the panels are separate *because of how the server
stores them*, which is not a reason a buyer should have to care about. One list answering
"who have I been talking to, about what, and what happened next" is a different product
from three lists that happen to contain the same rows.

Two obstacles are already known and must not be rediscovered:

1. `AdminEnquiryDto.requesterMobile` is **always masked, with no unmask parameter**, and
   the consumer panel's `tenDigits` check (`EnquiriesPanel.jsx:19-22`) silently discards
   masked numbers. Reusing the admin DTO would make the verified badge *vanish* rather
   than fail. The consumer projection must therefore be its own shape, not a re-guard of
   the admin one — and because it is scoped to `@CurrentUser`, the masking question mostly
   dissolves: the counterparty is the owner, whose mobile is masked pre-deal by ADR-019
   regardless.
2. Building the union **client-side** would cost four reads per dashboard load and would
   reimplement, in the browser, a join the server has deliberately not committed to. The
   projection is a server-side read or it is nothing.

Seven directory sweeps confirmed the negative before this was raised: `controller/`,
`web/`, `api/`, and the `leads`, `engagement`, `deals` and `moderation` modules.

## 8. The homepage trust counters have no server to read

`Featured.jsx:11` calls `verifiedStats(localitySlug)` for
`{ verifiedListings, totalListings, verifiedOwners }`.

- **(a)** A small counts endpoint. *(recommended)*
- **(b)** Drop the counters.
- **(c)** Approximate two client-side, hide the third.

**DECIDED (a).** Two of the three could be computed on the client, and that is exactly the
trap: `verifiedOwners` is a **distinct count of owners**, `GET /properties` does not send
`ownerId`, and counting distinct owners among the rows that happened to land on one page
produces a number that is wrong in a way nobody would notice. On a trust badge, on the
highest-traffic page, a wrong number is worse than an absent one.

This is the same shape as the locality `listingCount` ruling (D7.2) and should reuse its
machinery: `catalog.property.ListingCounts` already computes counts on read rather than
denormalising them onto a column, precisely because the denormalised copy on `City` went
stale and had to be abandoned (`City.java:20`).

## 9. Move-in Pack prices are read from browser storage

`useMovePackConfig` calls `rawDb()` directly, so `settings.movePack` — the prices and the
coming-soon switch — does not come from the server even when the `settings` domain is
live. **The write is real; the read is not.**

- **(a)** Add the pack keys to `GET /flags`. *(recommended)*
- **(b)** A public projection of the settings document.
- **(c)** Leave the read client-side.

**DECIDED (a).** The page cannot simply read `/admin/settings`: that route is
`hasRole('ADMIN')` on **both** verbs, deliberately, because the document holds the fee
table and the permission map. Widening it to serve a price list would be trading a
security boundary for a convenience.

`GET /flags` is already public and already fetched on boot, so this adds no route, no
round trip and no new cache. The cost is that `flags` stops being purely boolean, which is
worth naming: it becomes "the public configuration document" rather than "the feature
switches". That is a fair description of what it already was — the coming-soon switch for
this very pack is a feature flag by any reading, and separating it from the prices it
gates would put one page's configuration in two places.

### Built as: its own public route, `GET /move-pack`. Deviation from (a), recorded.

The decision was sound and the mechanism was not, which only became visible on reading
`AppFlagsController`. Two things blocked it:

**Mechanical.** `flags()` returns `Map<String, Boolean>` and *deliberately drops every
non-boolean*, because the client's test is `flags[key] !== false` and a hand-edited
`"false"` string would read as enabled either way — forwarding it would buy no behaviour
and make the response disagree with its own schema. `movePack.items` is a price map.
Carrying it means changing the endpoint's return type, which `SpecSchemaParityTest`
guards and which would cost the one property that makes `/flags` safe to read blindly.

**Design.** The endpoint's Javadoc had already anticipated and refused this exact request,
and named the alternative: *"The next block that needs an anonymous reader gets its own
route and has to make its own case."* It points at `FeeController` — public, its own
route, its own shape, no service layer. `Routes.Flags` carries the same sentence.

So: `GET /move-pack` serving `{ enabled, items }`, permitted in `SecurityConfig` beside
`/fees`, seeded as a `movePack` block in `R__seed_reference_data.sql`, contract path +
`MovePackConfig` schema in the OpenAPI, `getMovePack()` on the existing `settings` seam
(both providers), and `useMovePackConfig` repointed at it.

**What was preserved from the decision, and what changed.** The reasoning that mattered —
"separating the coming-soon switch from the prices it gates would put one page's
configuration in two places" — is *why the switch travels on this route with the prices
rather than joining the flags*. That was the load-bearing half of (a) and it survived
intact. What changed is only which public route carries it. The alternative that was
actually rejected here is the one nobody proposed: splitting `enabled` onto `/flags` and
the prices somewhere else.

**One rule this endpoint deliberately does not share with `/flags`: absent means OFF.**
There, a flag nobody has configured is enabled, so shipping a feature is a code change
rather than a code change plus a config row. Applying that to a price would have an
unconfigured install offering to sell at a number nobody chose. A missing, malformed or
unreachable block therefore answers `{ enabled: false, items: {} }` — coming-soon mode,
which shows no numbers and takes no money. Both ends fail in that direction: the server
defaults that way, and so does the provider when the fetch fails.

Two consequences worth knowing:

- The seed ships `enabled: false` **with the prices already filled in**, so launching the
  pack is one boolean rather than a data-entry exercise. A launch that requires retyping
  six numbers is a launch that eventually happens with one of them wrong.
- `DEFAULT_PACK_PRICES` was deleted from `Services.jsx` rather than kept as a fallback. A
  client-side price copy is exactly the second source of truth that let this page disagree
  with the admin console for as long as it did, and nothing renders a price before the
  server answers, so there was nothing left for it to do.

The two live specs (`live-move-in-pack.spec.js`, `live-move-in-pack-waitlist.spec.js`)
used to switch the pack on and off by writing `settings.movePack` into localStorage, with
a comment in each explaining that this was a read gap. They now `PUT /admin/settings`
through the same route the console uses. That is a strengthening, not a port: the prices
the booking spec asserts are now ones an administrator actually published, and the
arithmetic crosses the network twice before anything is checked.

## 10. The "tell me when something matches" signal has no server home

`NotifyMeCard.jsx:50` calls `addDemandAlert`. There is no `demand_alerts` table, entity,
repository, controller or route anywhere in the backend; a sweep confirmed it.

- **(a)** Build it properly — table, matcher, notification path.
- **(b)** Retire the card.
- **(c)** Reshape it as a one-shot lead, reusing the waitlist pattern. *(recommended)*

**DECIDED (a).** This is the largest item in the round and the recommendation was the
cheap reshape, on the grounds that a one-shot lead needs no matcher. The override is
justified by the thing that makes this feature different from the service waitlist that
shipped as D4: **a waitlist entry is a lead somebody rings back once; this is a standing
subscription that has to be re-evaluated every time the catalogue changes.** Reshaping it
as a lead would have kept the form and thrown away the promise the form makes.

The notification half is **already solved and must not be rebuilt**:
`common.trust.Notifier` exists as a port precisely so that a caller outside `engagement`
can tell a user something happened without depending on how notifications are stored
(`Notifier.java:8`), and `engagement.notification` supplies the inbox, the preferences and
the mark-read route behind it. The matcher publishes through the port. Building an
alternative delivery path would be reintroducing the coupling the port was extracted to
prevent.

What is genuinely new is the table and the matcher, and the matcher is where the care
goes: it runs on catalogue change, so it must not turn every listing publish into a scan
of every saved search.

## 11. `tickets.value` has no write path at all

`TicketCreate` drops it by design, `TicketUpdate` has no such field, and the seed never
sets it — the column V7 declared in 2024 **has been filled by nothing, ever**. The
Javadoc's claim that it is "ops-owned" is aspirational: ops have no way to own it.

- **(a)** The ops board owns it; add it to `TicketUpdate`.
- **(b)** The deals screen owns it. *(chosen)*
- **(c)** Drop the column.

**DECIDED (b).** A deal value belongs to the deal, not to the support ticket that happened
to start it. Putting the field on `TicketUpdate` would have been the smaller change and
the wrong one: it would make the board the system of record for a number the board does
not otherwise reason about, and it would leave two candidate answers to "what did this
deal close at" once the deals screen inevitably grew its own.

This also settles what `TicketQuotedValueTest.theQuoteSurvivesUnrelatedWork` was reaching
for. That test was written to assert that a desk setting `value` leaves `quoted_value`
alone, and had to be weakened to "working the ticket leaves the quote alone" because the
first half was unreachable. Under (b) it stays weakened, correctly: no desk will ever set
`value`, because the board is not where that number lives.

`quoted_value` (D3, shipped) is a **different number** — the customer's accepted quote,
write-once — and the distinction is the whole point of having answered both.

Note also the correction already made in place: the entity Javadoc said "deal value in
paise" and was simply wrong. Every other money field is whole rupees, the contract types
money as `int64` rupees, and `OpsQueue` renders this column straight through `fmtINR`.
Nothing converted anywhere; the comment survived only because the column has never held a
value.

## 12. The listing-freshness confirmation is browser-local

A search for `fresh|Fresh|confirm-fresh|lastConfirmed` across the backend returns only
unrelated matches — webhook replay windows, refresh tokens, and prose. There is no
freshness endpoint, no route constant and no column being written. This closes FINDING 7.

- **(a)** Add `lastConfirmedAt` and a confirm endpoint. *(recommended)*
- **(b)** Retire the badge.

**DECIDED (a).** Today the badge means "**this browser** confirmed it", not "the owner
confirmed it" — so it clears when the owner opens the site on their phone, and it silently
misleads a buyer looking at a listing that has not been touched in months. A trust badge
that is wrong in the reassuring direction is worse than no badge, and stale listings are
the specific pain point the Indian market complains about loudest.

The shape is small: one column, one authenticated POST scoped to the owner, and the
staleness computed server-side on read so that every client agrees about it.

---

## What this round unblocks

7 and 10 are the last two consumer surfaces reading the mock; 8, 9 and 12 are three
smaller ones. 11 is a decision **not** to build, which closes the item without work beyond
correcting what the code claims about itself. With these answered there is no remaining
consumer read that has nowhere to go, and `lib/mockApi.js` can retire once the work lands.

---

# Round 3 — answered

Three of these are new questions. Two are corrections. Rounds 1 and 2 asked you to decide
things on premises that turned out to be wrong, and a register that records only the
answers would leave the next reader believing the questions were sound. Both corrections
point the same way: I described a fixture as if it were a feature.

## 13. Enquiries: the projection I proposed does not need to exist

**Supersedes item 7.** Round 2 asked whether to model an enquiries projection server-side.
The answer was yes. The answer was right for the question, and the question was wrong.

**What I got wrong.** I described the enquiries collection as a consumer surface reading
the mock — which implies rows the app produces, and therefore rows a server would have to
start producing. It is nothing of the kind. `frontend/src/data/db.json` carries 60 rows
from `E7000` to `E7059`, and **nothing in the entire mock layer ever writes that
collection**: there is no `addEnquiry`, no `createEnquiry`, no mutation of any kind. Every
one of those rows was typed into a fixture file by hand and has been read-only ever since.
They are decoration, and they have been decoration for the whole life of the file.

**Why that changes the answer.** A projection would have had to invent the write path
first, and the surface it would feed already exists. The Leads inbox lists number requests,
photo requests, document requests and flatmate requests — four kinds of lead, all of them
real, all of them already routed through live services. A "general Enquiries" tab sitting
alongside those four was a fifth name for the same idea, populated by fiction. Building the
projection would have meant shipping a server-side concept whose only job was to justify a
tab that duplicated its neighbours.

**DECIDED: retire.** *(Your words: "Retire it — delete the fixtures and the panel branch.")*

What this actually cost, once traced, was larger than "a panel branch" — worth recording,
because the size of it is the argument:

- The owner dashboard's headline **Enquiries** stat tile was `enquiries.length` against a
  fixture slice. An owner with no activity whatsoever was shown a confident number. That
  tile now counts real leads and is labelled **Leads**, computed by the same expression the
  panel uses for its own total, so the two cannot drift apart.
- The Overview tab opened with a **Recent Enquiries** card showing three invented names —
  the same three names, to every owner on the site, on the first screen they saw.
- An entire batched network round-trip died with it. The badge on a lead row read the
  server's `verified` bit, falling back to a `tenantsVerified()` lookup keyed on the row's
  phone number. That fallback existed *for the enquiry rows*, which carried a mobile and
  nothing else. With them gone the lookup key is permanently empty, so the request could
  only ever return nothing. Deleted rather than left dormant: a call that cannot affect the
  render is worse than no call, because the next person to touch that file has to prove
  that before they can move anything near it.

**Deliberately not done.** The 60 fixture rows stay in `db.json` for now, and so does
`listEnquiries` in the mock collections. `AdminEnquiries.jsx` and `AdminDashboard.jsx`
still read them, and those pages are separately on the retirement list. Deleting the rows
today would break an admin funnel that has passing coverage, to save a file nobody is
reading. They go when the admin pages flip.

## 14. Demand alerts: most of what I asked for is already built

**Supersedes item 10.** Round 2 asked whether to "build demand alerts properly" and the
answer was yes. Most of it exists.

**What I got wrong.** I presented saved searches and demand alerts as one unbuilt feature.
They are two features, one of which is largely shipped and the other of which is not about
alerts at all:

- **Saved searches exist.** `SavedSearch` is a real entity on a real table, with
  `alertFrequency`, `channel` and `newCount` columns, full CRUD at `/me/saved-searches`,
  and a `recomputeNewCounts` that already matches new listings against stored criteria.
- **`addDemandAlert` is a different concern entirely.** It feeds the admin **Supply-Gap**
  board — anonymous market intelligence about what people searched for and could not find.
  It is not a notification channel and never was. I conflated the two because they share
  the word "alert".

**What is actually missing** is smaller and sharper than "build demand alerts": the
recompute stores `newCount` on the row and **stops there**. Nothing is ever sent. A user
who asked for a daily WhatsApp alert gets a number that quietly increments in a database.
That is the whole gap, and it is logged as **D94**.

**DECIDED: notify first, then the demand signal.** *(Your words: "Notify first (2), then
the demand signal (1)".)* The notify path is where a user is currently being promised
something the system does not do; the demand signal is an internal board nobody has been
promised. Promise-breaking outranks missing telemetry.

**Explicitly out of scope: instant matching on publish.** The `instant` frequency will keep
behaving as the scheduled path does until someone asks for more. There is no event bus in
the backend today — no `ApplicationEventPublisher`, no `@TransactionalEventListener` — so
"instant" means introducing an eventing seam and a matcher that runs inside the approval
transaction. That is a real architectural decision and it should be made deliberately, on
its own, not smuggled in as the third bullet of an alerts ticket.

## 15. The audit seam: build the writer, leave the reader

**New.** Fifteen admin pages call `logAudit` straight into localStorage. There is no
`auditService`, no provider, no entry in the domain allow-list — the seam every other
domain has simply does not exist here, while the backend has had `/admin/audit-log` routed
the whole time.

**DECIDED: build the seam, wire the writer, leave the reader flagged.** *(Your words.)*

The asymmetry is deliberate and worth stating, because a later reader will find it odd. An
audit trail that is *written* to the server is immediately worth having: it survives the
browser, it survives the machine, and it is the record you want to exist before you need
it. An audit trail that is *read* from the server is a screen, and the screen that reads it
(`AdminSettings`) also offers **clear** — which against a real server-side ledger is a
different and much more serious operation than emptying a localStorage key. Wiring the read
without deciding what "clear" means on a durable audit log would be shipping the dangerous
half first.

## 16. Autonomy on deletions

**New.** **DECIDED: delete freely where the code is provably dead, and narrate it in the
commit.** *(Your words.)*

"Provably" is doing real work in that sentence and is being read strictly: a grep showing
the only remaining references are the definition itself and the code being removed in the
same change. The narration is the other half of the deal — a deletion that is explained is
reviewable, and a deletion that is not is indistinguishable from an accident.

## 17. Scope: there is no five-hour box

**New.** The plan was originally cut to fit an unattended window.

**DECIDED: no hard stop.** *(Your words: "its fine there is no hard stop at 5 hrs ... finish
everything you can do on your own".)* So the ordering principle is no longer "what fits",
it is **what unblocks the most**, with anything genuinely needing a decision surfaced here
rather than guessed at.

---


## 18. The audit seam: correcting item 15 before building it

**Supersedes item 15, and this one is a security correction rather than a scoping one.**

I proposed building `auditService` + an http provider posting to `/admin/audit-log`, and
you approved it. It should not be built, and I stopped before writing it.

**What I got wrong.** I described `logAudit` as a domain missing its seam — fifteen admin
pages writing to localStorage because no provider had been written yet. That framing is
wrong in a way that matters: the server does not have a gap here, it has a **deliberate
refusal**.

- `AuditLogController` exposes exactly one method, a `GET`. Its Javadoc states the property
  outright: *"Read-only by construction: there is no write endpoint, no update and no
  delete. Rows arrive only through `AuditService`."*
- `BackOfficePermissions` defines `audit:read`. There is **no `audit:write`**. The
  permission model has no concept of a client writing an audit row.
- `AuditService` is called from twenty-odd backend services, always from *inside* the
  transaction of the thing being recorded, with the actor read from the authenticated
  principal — *"never client-supplied"*.
- `AuditLog` has no `updated_at` and marks every column `updatable = false`.

**Why the seam would have been a regression.** An audit log's only value is that it cannot
be edited by the party it incriminates. A `POST /admin/audit-log` hands every authenticated
back-office client the ability to write arbitrary rows into it — to author entries that did
not happen, and, if the client supplies the actor, to attribute them to someone else. The
frontend cannot be trusted to state what the frontend did; that is the entire premise of
the table. I would have been building the exact attack the existing design spends four
paragraphs of Javadoc preventing, and I would have been building it *because the design was
so consistent that I mistook the absence of a write route for an oversight*.

**What `logAudit` actually is.** Not a domain awaiting a provider — a client-side
reimplementation of something the server already does, better and unforgeably. The proof is
already on screen in `AdminSettings.jsx`: the save calls the live `updateSettings`, the
backend writes a real `settings.update` audit row inside that transaction, and *then* the
page writes a second, decorative row into localStorage. That action is already
double-logging today, and only one of the two records is worth anything.

**DECIDED (revised): build nothing. The calls die on their own.**

Each `logAudit` call is removed when its own page's action flips to a live endpoint,
because the endpoint already records it. There is no seam to write, no allow-list entry to
add, and no fifteen-file repoint. The item is not deferred — it is **dissolved**, and the
work it described is already inside the other migration items.

**What still needs a decision, later and separately.** The audit *reader* stays on mock for
now, which is what you already chose. It cannot simply be repointed, because the same
screen offers **Clear log** next to it. Against localStorage that empties a browser key.
Against the real table it is a request to destroy the maker-checker trail — which the
backend does not implement, deliberately, and should not grow just because a button on an
admin page currently exists. When that screen is flipped, "Clear" almost certainly stops
being a button rather than becoming an endpoint. Flagging it here rather than deciding it
alone.

**A note on how this was caught.** The seam was approved, planned and next in the queue.
What stopped it was reading `AuditService` before writing the provider, and finding that
every property I would have needed to violate was already written down as intentional. That
is the argument for the house style: the Javadoc on that class is the only reason this did
not ship.

## 19. Societies: the flip is blocked, and the reason is worse than the flip

**This was item 11 on the migration list, scoped as "repoint six importers onto the
existing `societyProvider`". It is not six importers, and repointing them would not fix
what is actually wrong.**

**The catalogue itself is ready.** `societies` holds 348 rows — 320 `source='rera'` plus 28
`source='curated'` — which is exactly the 320 rows in `data/societies-rera.js` plus the 28
in `data/societies.js`. `SocietyService`, `SocietySpecs`, `SocietySort`, `SocietyMapper`,
`GET /societies`, `GET /societies/{slug}` and both providers all exist. Parity is not the
problem.

**The binding is the problem, and it does not exist.**

```
select count(*) from properties where society_id is not null;   ->  0   (of 38)
grep '"societyId"' frontend/src/data/db.json                    ->  0
```

Not "few". None, in either mode, ever. Now read what the client does with that:

```js
// Deterministically map a listing to a society. Prefers an explicit `societyId`
// binding (curated or community) so the assignment is honest; only when a listing
// is truly unbound (legacy data) does it fall back to a locality-scoped, id-stable
// hash so the Society Hub still has something to show.
export function societyForListing(p) {
  if (p.societyId) { ... }                       // <- never taken. not once.
  const pool = societiesInLocality(p.localitySlug);
  return set[fnvHash(p.id || '') % set.length];  // <- this is the whole function
}
```

**Every clause of that comment is false in practice.** The explicit branch is dead code.
"Legacy data" describes 100% of the data. The fallback is not a fallback; it is the
implementation. And "so the Society Hub still has something to show" is the tell — it says
out loud that the purpose is to avoid an empty state, not to be right.

**What that renders.** `SocietySection` is on every property page, and off the hash-picked
society it prints the society's **name and builder**, its **unit count**, **tower count**,
**year built** and **occupancy percentage**, plus a verified badge computed from
`registration && conveyance`. These are specific, checkable claims about a real, named,
existing building in Pune — "Skyline Heights, Kolte-Patil, 420 homes, 5 towers, 2018, 92%
occupied" — attached to a listing that is not in it. A buyer can act on that. It is a
different and more serious class of fiction than the enquiry rows retired in D13, which
were at least fictional *people* rather than false statements about real places.

The same file already carries a long SEAM NOTE about a fabricated `4.2` star rating that
was fixed for precisely this reason — *"a reader had no way to tell 4.2-because-people-
said-so from 4.2-because-a-developer-typed-it"*. The rating was corrected. The building it
is a rating **of** is still picked by hash.

**Why flipping the catalogue would not help, and might hurt.** Repointing `allSocieties()`
at `GET /societies` changes which 348 rows the hash indexes into — it re-rolls the dice, it
does not stop rolling them. And `societyForListing` is called **synchronously** inside
render paths (`listingsResultsPipeline.js`, `SocietySection.jsx`), while the provider is
async, so the flip is a re-architecture of those pipelines in service of no improvement in
truthfulness.

**NEEDS A DECISION — I have not changed anything here.** Three options, and this is a
product call about what a listing page says, not a migration detail:

1. **Bind for real.** `properties.society_id` exists with a FK, and `ListingCreate` already
   documents it as "a curated id rather than free text, so it cannot be fudged by
   spelling". Nothing populates it because the listing form never asks. Add the question,
   and the section becomes true for new listings and honestly absent for old ones.
2. **Show the section only when bound.** One-line change to `societyForListing`, and the
   Society section disappears from every property page today — which is the correct
   rendering of "we do not know", and would look like a large regression to anyone who does
   not know it was never real.
3. **Keep the hash and label it.** I do not recommend this. There is no honest label for
   "this is probably the wrong building".

I would do 1 then 2, in that order. But (2) alone removes a visible section from every
listing on the site, and (1) adds a field to the posting flow — both are outside "do not
build new product capabilities unilaterally", so **the item is parked here rather than
half-done.**

**Not blocking anything else.** The society *catalogue* surfaces (directory, hub header,
locality lists) could flip independently of the binding question, since they never touch
`societyForListing`. That is the salvageable half, and it is small.
## What this round changes

Two items shrink to nothing (13 removes work rather than adding it; 14 turns out to be one
missing notify call rather than a feature). One item — the audit seam — is the largest
remaining structural blocker to retiring `lib/mockApi.js`, because fifteen files import
`logAudit` from it and no amount of work on the other domains removes that import.
