# Decisions needed to finish the mock retirement

Every item below is a place where the migration stopped because the answer is a product or
security call, not a mapping. This file opened by saying "each one is already written up in full in
`tasks/todo.md`; this file is the short version" — that was true of the first twenty-five and is
not true of the file as a whole. Items 26 and 28 were found and argued here directly and have no
longer form anywhere; items 27 and 29 do have one in `todo.md` and in `docs/migration/README.md`,
and were added here because a decision reachable only through nine hundred lines of survey notes is
not on a list. Where a longer write-up exists the item says so and points at it. Either way, this
file is the complete set, and the set can be answered in one sitting.

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
## 20. Finance: the console and the endpoint disagree about what money is

**Decision needed.** Not "which transport does the Finance console use" — that turns
out to be the wrong question. The two sides model the business differently, and only
one of them is honest.

### What I found

I set out to flip `/admin/finance` onto the API the way every other console has been
flipped, and stopped when I read both sides.

**The server already has the endpoint, and it is careful.** `GET /admin/finance`
(admin only, `finance:read`) returns `AdminFinance` — `revenue`, `payoutsDue`,
`payoutsCompleted`, `refunds`, a `breakdown` by source, and *three disclosure
booleans*: `payoutsMeasured`, `refundsMeasured`, `serviceOrdersCounted`. Its Javadoc
explains that GST is excluded because collecting tax on the government's behalf is not
income, that `payoutsCompleted` is zero because no payout has ever been executed,
that `refunds` is zero because there is no refund path, and that service orders are
excluded because `service_orders.amount` is a quote rather than a receipt. The
booleans exist so an operator can tell "nothing was refunded" from "refunds do not
exist here". `AdminKpis.revenue30d` is deliberately null for staff so the
staff-visible dashboard cannot leak the admin-only figure.

**Nothing in the frontend has ever called it.** A fully built, documented,
permission-gated, tested endpoint has zero callers.

**What the console shows instead is generated.** In
`frontend/src/lib/data/finance-admin.js`:

- `buildRevenueSeries` returns `db.analytics.revenue` when that array is long
  enough, and otherwise synthesises twelve months from a *deterministic
  pseudo-random function seeded on the month index*. The growth curve an operator
  reads off the chart is arithmetic.
- `buildTransactions` fabricates a ledger from deals, tickets and listings, and
  assigns each row a status by rotating through a hardcoded `STAT` array. The
  "failed" and "refunded" rows in the Transactions tab are at those positions
  because of their index, not because anything failed or was refunded — while the
  server refuses to report a refund figure at all, on the grounds that there is no
  refund path.
- `rentFeeRevenue` sums `db.rentFeeLedger`. **That collection does not exist in
  `db.json`** — zero matches. So the "Rent-pay fees" KPI has always displayed ₹0,
  and has always looked like a measurement.

And the page's own model is arithmetic on top of that: partner payouts are 65% of
revenue, GST is 18% of revenue, "net retained" is what is left. Those are formulas,
not ledgers.

### Why this is not a migration

Flipping the page is not a matter of swapping a provider. The two sides do not
compute the same numbers:

| The console shows | The server can serve |
|---|---|
| 12-month revenue series | current totals only — no time series |
| a transactions ledger | no ledger endpoint |
| MRR, ARPU, subscription counts | not modelled |
| GST and partner payouts as % of revenue | GST excluded on principle; payouts as a real liability |
| refunds and payouts as computed figures | both zero, *with a disclosure saying why* |

Doing it honestly means the growth chart and the transaction table **disappear**, and
the screen becomes four figures and three disclosures. That may well be the right
answer — a finance screen that invents a ledger is worse than a finance screen that
admits it has none — but it is a change to what the business looks at, and I am not
making it on my own.

### Correction

Earlier in this session I recorded that AdminFinance was blocked because "the
platform needs a new admin revenue endpoint". That was wrong, and I had not looked
hard enough when I wrote it: `AdminMetricsController` has carried
`GET /admin/finance` for some time, and `Routes.Admin.FINANCE` names it. The blocker
is not a missing endpoint. It is that the endpoint tells the truth and the screen
does not, and reconciling them removes things people may be used to seeing.

### The options

1. **Flip it and lose the fiction.** Point the console at `/admin/finance`, keep the
   four figures and the three disclosures, delete the chart, the ledger, MRR, ARPU
   and the percentage model. Honest, smaller, and immediately shippable — the
   endpoint is done.
2. **Flip the honest half, keep the rest on the mock, and say so on the screen.** The
   figures the server can vouch for come from the server and are labelled; the chart
   and ledger stay, visibly marked as illustrative. Least disruptive, but a screen
   that mixes measured and illustrative money is exactly the confusion the disclosure
   booleans were built to prevent.
3. **Extend the endpoint first.** Add a monthly revenue series and a real payments
   ledger server-side, then flip everything. That is new product surface and needs
   the payments work that does not exist yet — `payoutsCompleted` is zero because
   there is no remittance path, not because nobody has queried it.

**My recommendation is (1)**, on the grounds that the disclosure booleans already
exist because someone decided this screen must not overstate the business, and a
generated growth chart overstates it more than any zero could.

### Meanwhile

The page stays on the mock provider and keeps its `rawDb` import. It is listed here
rather than left silently unconverted, and this note is the reason the mock-retirement
sweep steps over it.

## 21. The rent-agreement desk: should ops see an enquiry nobody has paid for?

**Decision needed**, and it is small but it has a right answer that only you can give.

### Context

The service landing pages (packers, legal, home loans) now raise their lead ticket
through `POST /tickets`, so the desk sees the enquiry. That was an unambiguous fix:
those forms are free quote requests, the lead *is* the product, and it had been
going to `localStorage` on live installs — so the desk never saw it at all.

I went to apply the same change to the Rent Agreement wizard and stopped.

### Why the same change is wrong here

This desk is priced. `ServiceRequestService` commits a rent-agreement request at
`awaiting-payment`, and `findForQueue` **deliberately excludes that status**. The
Javadoc is explicit about it: an unpaid request "sits in awaiting-payment" and ops
cannot see it. That is a decision somebody made on purpose — the rental desk works
paid matters, not abandoned checkouts.

Raising a server-side ticket at submit time would put that same enquiry on the
rental desk immediately: visible, callable, and indistinguishable from a paid one.
It would route around the exact rule the layer below it enforces.

The ordering makes it worse. A server ticket has to be created *before* the request
so its id can go on as `ticketId` — which inverts the rule the current code already
follows, that the ticket is raised only after the request exists so a failed create
cannot leave admin holding a ticket pointing at nothing.

And the co-fill branch (owner invites tenant to fill their half) creates no live
request at all — it stays on `serviceFlow` because the server scopes every request
to one requester and has no shape for a two-party draft. So there is no id to link
to there under any ordering.

### The options

1. **Raise the ticket from the payment webhook.** When `settle` moves the request
   into the queue, create the desk ticket then. Ops sees exactly what it is meant
   to see, and the invisible-until-paid rule holds. Backend work, small.
2. **Do not raise a ticket at all; let the request be the record.** The ops queue
   already shows paid rent-agreement requests. The admin ticket is arguably a
   duplicate of a record ops can already work — the same duplication we just
   deleted from four admin consoles.
3. **Leave it.** The `TR…` ref keeps pairing the browser-local ticket with the
   browser-local flow record, and the paid request reaches ops through its own
   path regardless. Costs nothing; the admin Service Requests console just keeps
   showing a list that is only complete on the machine the booking was made on.

**My recommendation is (2)**, with (1) as the answer if the rental desk genuinely
works from the ticket board rather than the requests queue. I do not know which,
and that is why this is here rather than done.

### Meanwhile

`useRentAgreement.js` keeps its one `createServiceRequest` import from
`lib/mockApi.js`, with a comment at the call site pointing here. It is the last
consumer-side caller of that function outside `Services.jsx`, which is already
gated on `isHttpDomain('ticket')`.

## 22. The admin command palette searches fixture data on a live deployment

**Decision needed.** This one is a live defect, not just an unmigrated screen, and
the honest short-term fix loses a feature - so I am not taking it unilaterally.

### What happens today

`AdminTopbarTools.jsx` is the Ctrl+K palette in the admin shell. It searches seven
categories. Two are static (`pages`, `features`). The other five - **listings,
users, tickets, enquiries, deals** - come from `rawDb()`, a synchronous read of the
browser store.

`main.jsx:129` awaits `ensureMockDb()` at boot **unconditionally**, with no
reference to the domain allow-list. So on a live deployment the store is still
seeded from `db.json`, and the palette is searching **38 fixture listings and 81
fixture users** rather than the real database.

That is worse than showing nothing. An operator types a name, gets a confident list
of results, clicks one, and lands on a 404 - because the id belongs to a fixture the
server has never had. Nothing on screen says the results came from anywhere other
than the system they are administering.

The notification bell has the same problem: its "pending listings" and "new tickets"
counts are counted off the same fixture rows.

### Why this is not a small flip

There is no admin global-search endpoint. `Routes.java` has no `SEARCH` constant and
nothing resembling one; the public faceted property search is a different operation
with a different audience.

The pieces to build one exist - `/admin/users`, the moderation property list,
`/tickets`, `/service-requests` all take a query - so a palette could fan out across
four or five calls and merge. But that is a **new cross-domain capability**, with
real questions attached: does it debounce per keystroke across five endpoints, what
happens when one of the five 403s for a staff-scoped caller, and does a global admin
search need its own audit trail. Those are product questions.

### The options

1. **Build the fan-out.** The palette calls the four or five existing admin list
   endpoints in parallel and merges. Most work, best outcome, and it is the only
   option that keeps the feature.
2. **Gate the five data categories on mock mode.** Keep `pages` and `features`,
   which are static and correct everywhere, and hide the rest with a line saying
   they need the live API. Small, honest, and immediately stops the 404s - but the
   palette becomes a nav-jumper only.
3. **Add one narrow endpoint** - say a `GET /admin/search?q=` that covers only
   listings and users, the two categories an operator actually reaches for - and
   drop tickets, enquiries and deals from the palette.

**My recommendation is (2) now and (1) or (3) later.** Showing an operator fixture
rows dressed as production data is the kind of thing that gets acted on before it
gets noticed, and it costs nothing to stop today.

### Note

This is the same class of defect as the service-landing lead ticket fixed earlier:
a screen that behaves identically in both modes while only one of them is telling
the truth. The pattern to look for is a synchronous `rawDb()` read inside a
component that has no `isHttpDomain` branch. There are four more -
`lib/chat.js`, `lib/geoConfig.js`, `lib/store/billing.js` and `AdminFinance.jsx`
(the last already covered by item 20).

## 23. An owner's listing is blocked, or cleared, by a comparison against fixtures

**Decision needed.** Same shape as item 22, but this one can stop a real person from
posting a real property, so it is worth a separate entry.

### What happens today

`persistListing` in `pages/consumer/list-property/submit.js` runs a browser-side
duplicate check before it writes anything:

```js
const dedup = evaluateListingDedup({ mobile: mob, fields: form, excludeId: editId, photoHashes });
if (!editId && dedup.blocked) {
  return { ok: false, blocked: true, existingId: dedup.existingId };
}
```

`evaluateListingDedup` is in `lib/data/propertyIdentity.js`, and both of its
searches - `findListingClaims` and `findImageClaims` - iterate `rawDb().listings`.
That is the browser store, seeded from `db.json`, on every deployment including live.

So on a live install the check is comparing a real submission against **38 fixture
listings**. Two failure modes follow, and they point in opposite directions:

1. **It clears duplicates it should catch.** An owner's own genuine earlier listing
   lives in PostgreSQL, not in that store. Same meter number, same flat, posted
   twice - and the browser sees no claim, because the earlier listing was never in
   `db.json`.
2. **It blocks submissions it should not.** If a fixture happens to share a
   normalised address key, an owner is told "you have already listed this property"
   and offered a link to a listing id the server has never heard of.

The second is the one that costs a listing. The owner has no way to argue with it.

### Why this is not simply "port it to the API"

The server has a duplicate probe - `ListingDuplicateProbe`, wired into
`POST /me/listings` - and its Javadoc is emphatic that it **deliberately does not
refuse the listing**:

> A collision is a suspicion, not a finding. Two owners genuinely share an address
> key when a bungalow is split into two tenancies, when a society reuses flat
> numbers across wings, and every time `AddressKey`'s normaliser is a little too
> eager. Refusing the submission would make an honest owner argue with a string
> comparison, having been told by an error message that they are lying.

The browser rule and the server rule are not the same rule, and the difference is
principled on the server's side. The browser blocks on **self**-duplication (same
mobile, same unit) and only flags on a different owner; the server flags in both
cases and files a staff-only case note. Blocking on self-duplication is defensible -
"you already listed this, here it is, edit that one" is a kindness, not an
accusation - but there is no endpoint that answers it, and the probe's findings are
staff-only by design, precisely so a submitter cannot use them to discover whose
listings exist.

There is also no server-side photo hash comparison at all; `findImageClaims` has no
counterpart.

### The options

1. **Add a narrow "have I already listed this?" endpoint** scoped to the caller's
   own listings, and blocked only on that. It leaks nothing - it can only tell you
   about listings you posted - and it is the rule the browser was trying to enforce.
   Most work, best outcome.
2. **Drop the browser block on live and let the server's flag be the whole answer.**
   Duplicates then reach a moderator instead of being stopped at the form, which is
   what the probe was designed for. One `isHttpDomain` branch. The cost is that an
   owner who double-posts finds out from a rejection later rather than at submit.
3. **Leave it.** Not defensible now that it is written down: option 2 is a few lines
   and removes a false block.

**My recommendation is (2) now, (1) if double-posting turns out to be common.**

### Note

`findImageClaims` only ever flags, never blocks, so on live it is inert rather than
harmful - it flags against fixtures nobody reads. It goes with whichever option is
picked.

## 24. The locality curation queue is one browser's localStorage

**Where:** `frontend/src/pages/admin/AdminLocalities.jsx` (the "Pending" tab),
`frontend/src/lib/store/community.js:112-134`,
`backend/src/main/java/com/punenest/api/catalog/locality/LocalityResolver.java`.

### What happens today

When an owner's Google place-pick matches no canonical locality, the listing wizard mints a
`community`-tier locality into `localStorage['pnCommunityLocalities']` and drops a lead into
`localStorage['pnLocalityLeads']`. `community.js` calls that record "the system of record".

The server disagrees, and says so in `LocalityResolver`'s Javadoc:

> Why `null` rather than a coined slug. `properties.locality_slug` is FK-constrained to
> `localities(slug)`, so inventing `slugify(name)` would either violate the constraint or force
> auto-creating locality rows from owner typos — permanently polluting the reference table (and the
> sitemap) with junk pages. Returning `null` keeps the catalogue honest: the listing is `pending`
> moderation anyway, so an unresolved locality is a curation task for a human, not a
> data-integrity problem. This is the one place the client's behaviour is deliberately *not*
> mirrored — it may fall back to a coined slug because it has no FK to satisfy.

The server is right and the data is safe. The FK holds, nothing is polluted, and the listing sits
in `pending` with a null `locality_slug`.

What does not happen is the curation task. The Javadoc hands the problem to a human; the screen
that human opens is `/admin/localities`, and its Pending tab reads `pendingCommunityLocalities()` —
the *admin's own browser*. The owner minted the record on their laptop. The moderator will never
see it. `verifyCommunityLocality(slug, by)` flips a tier in a store nobody else reads, and
`allLocalities()` — the Directory tab — is a bundled JS constant, not the 155 rows in `localities`.

So the sequence the two halves describe together is: owner types a locality the catalogue does not
have → server correctly declines to coin a slug → listing goes to moderation with no market
attached → the queue meant to resolve it is empty on every machine except the one that created it →
the listing is approved without a locality and is invisible to search facets, `/locality/{slug}`,
saved-search alerts and the society join, exactly as `LocalityResolver` warns. "Silent, and it
costs the owner their leads."

### Why this is not a port

`POST /admin/localities` and `PATCH /admin/localities/{slug}` already exist and already work. The
missing piece is not the write — it is the **queue**, and the queue is a different object than the
one the browser keeps.

The browser's queue is *localities somebody coined*. The server has no `tier` column, no
community-submission table and no notion of a provisional locality; adding one would recreate
precisely the reference-table pollution the resolver refuses.

The server's queue is *listings whose `locality_slug` is null*. That is a question about
properties, not about localities, and it needs no new table — only a filter on a table we already
moderate.

### Options

1. **Re-point the queue at the real thing.** Add a moderation filter for
   `locality_slug IS NULL` and show the pending listing with the owner's typed
   `locality` string. The moderator either picks an existing locality (a `PATCH` on the property)
   or creates a curated one via the endpoint that already exists and then picks it. The community
   tier disappears; `community.js`'s locality half is deleted. **Recommended.** It matches what the
   server already believes, it deletes a fiction rather than syncing one, and the moderator is
   looking at the thing that is actually stuck.

2. **Give the server a provisional-locality table.** Faithful to the current UI, and wrong for the
   reason the resolver already argued: it makes owner typos into rows, and rows into sitemap
   entries, before a human has agreed they are places.

3. **Leave it.** The queue stays empty, listings keep getting approved with no market attached, and
   the cost lands on owners as missing leads — the failure mode the resolver's Javadoc was written
   to prevent.

**Recommendation: (1).** Note the ordering constraint: until this is done, approving a listing with
a null `locality_slug` should probably be blocked or at least warned about in the moderation
console, because approval is the moment the invisibility becomes permanent.

### Related

`registerCommunitySocieties` / `addSocietyLead` are the same design one entity over, and they are
blocked behind item 19 (the society catalogue). Whatever is decided here should be decided for both
at once — they were built as a matched pair and `community.js` treats them as one idea.

---

## 25. The admin Enquiries desk has no server surface, and building one is an access-control decision

**Where:** `frontend/src/pages/admin/AdminEnquiries.jsx`,
`frontend/src/pages/admin/enquiries/helpers.js`,
`backend/.../common/web/Routes.java` (`Deals`, `Visits`).

### What happens today

The desk reads `listEnquiries()`, `listVisits()` and `listDeals()` from `mockApi.js` and writes
through `updateCollection(col, id, patch)` — a `mutateDb` that finds a row by id in a named
collection and `Object.assign`s a patch onto it. Four tabs, four KPI tiles including a Deal GMV
figure, a CSV export, a reschedule modal.

Every corresponding server route is caller-scoped, by construction:

| Surface | Route | Audience |
|---|---|---|
| Deals | `/me/deals` | all deals on **the caller's own** listings |
| Visits | `/visits` | the **visitor's** own visits |
| Visits | `/me/visit-requests` | visits on **the caller's own** listings |

There is no cross-user read anywhere in the three, and that is not an oversight — `Routes.Deals`
and `Routes.Visits` annotate every constant with whose data it returns.

### Why this is not a straight port

An admin Enquiries desk is a cross-user read of the most sensitive table set the product has.
An enquiry is a named person's phone number attached to their interest in a specific property.
The contact gate exists to control exactly that disclosure; a desk that lists every enquiry is a
standing exemption from it.

That is a policy question, not a mapping question, and it has sub-questions the code cannot answer:

- **Who?** `admin` only, or ops teams too? The service desks are team-scoped (`tickets_team_check`);
  this would not be.
- **How much?** Full mobile numbers, or masked until a reason is given? The moderation console
  already withholds fields deliberately (`PropertyResponse.adminPipeline` is NON_NULL-omitted so the
  response shape does not advertise the withholding).
- **Written down?** A cross-user PII read is the canonical thing to record — and the audit seam was
  dissolved on purpose (item 8), so there is currently nowhere to record it.
- **Deal GMV.** The tile sums `d.value` across all deals. `value` is an ops annotation, the same
  field item 6 settled for tickets. Whether the desk should show a platform-wide revenue figure
  derived from staff-entered numbers is the same argument as item 20 (Finance).

### Options

1. **Build `GET /admin/enquiries`, `/admin/visits`, `/admin/deals` with masked contact detail**,
   unmasked only on an explicit per-row reveal. Honest, and the most work.
2. **Build them unmasked for `admin` only.** Fastest, and quietly repeals the contact gate for one
   role.
3. **Cut the desk down to what already has a server home.** Visits and deals both have owner-side
   surfaces; a moderator working a specific property could reach them through the property. Loses
   the platform-wide funnel view.
4. **Leave it on the mock.** The desk keeps working against `db.json`'s 82 enquiry rows and shows
   an ops team numbers that describe nothing.

**No recommendation.** (1) is the right shape if the desk is wanted at all, but whether it is wanted
— and by whom, at what fidelity — is yours. Until then this is the largest remaining block of
`mutateDb` in the admin console, and `db.json`'s 60 fixture enquiry rows (`E7000`–`E7059`) cannot be
deleted while it stands.

---

## What this round changes

Two items shrink to nothing (13 removes work rather than adding it; 14 turns out to be one
missing notify call rather than a feature). One item — the audit seam — is the largest
remaining structural blocker to retiring `lib/mockApi.js`, because fifteen files import
`logAudit` from it and no amount of work on the other domains removes that import.
## 26. The `services` CMS type is built on the server, wired through the client seam, and reachable from neither end.

**Where:** `content/ContentTypes.java:7`, `content/ContentController.java:31` (`GET /services`),
`services/adminContentService.js:46` (`CONTENT_TYPES`), `providers/{mock,http}/adminContentProvider.js`,
`pages/admin/AdminContent.jsx:18` (`TABS`).

### What happens today

`ContentTypes` opens with the comment "The four CMS lists ops manages". There are four:
`announcements`, `services`, `faqs`, `banners`. Ops manages three.

The gap is not a missing endpoint. Every layer exists: `cms_services` table, `CmsServiceEntity`,
`CmsServiceRepository`, `CmsServiceResponse(id, name, icon, description, link, translations)`, a
public `GET /services`, `AdminContentService`'s five `SERVICES` branches for the writes, the
`content.services` permission in `BackOfficePermissions`, `CONTENT_TYPES` on the client service, and
a `case 'services'` in *both* the mock and http providers. The only thing missing is the entry in
`AdminContent.jsx`'s `TABS` array — which is why this reads at first glance like four lines of work.

It is not, because the other end is missing too. Nothing in `frontend/src` calls `GET /services`.
The `/services` landing pages (`PackersMovers.jsx` and its siblings) are hand-written React with
hard-coded copy; they do not read the CMS. `cms_services` seeds zero rows. So the type is authored
by nobody and rendered to nobody, and the two halves fail in opposite directions:

- Adding the console tab alone gives ops a form that writes records no visitor will ever see.
- Pointing the `/services` landing pages at the CMS alone gives visitors a page fed by a table
  nobody can edit, which would render empty on the day it shipped.

Adding either one by itself is worse than adding neither, which is presumably how it ended up here.

### Why this is not a port

There is nothing to port. The mock provider already handles `services`; so does the http one. This
is the rare case where the *seam* is finished and the product is not. The question is not "how does
this move to the server" but "should the services directory be editorial content at all".

That is a real question and not an obvious yes. The six service landings are not a list — each is a
distinct flow (`ServiceLanding` with a `team` and a `flowType`, feeding the live ticket API). A CMS
row carries `name`, `icon`, `description`, `link` and `translations`: enough to render a *directory
card*, nowhere near enough to render a landing. So the honest scope is the `/services` index page's
tiles, not the pages behind them — a much smaller thing than "the services CMS" sounds like.

### Options

1. **Delete the type.** Drop `cms_services`, the entity, repository, response, the public read, the
   `SERVICES` branches, the permission, and the `case 'services'` in both providers. This is the
   smallest honest state: nothing writes it, nothing reads it, and a table that exists only to be
   discovered later by somebody who assumes it is load-bearing costs more than it saves.
2. **Finish both ends in one change** — the console tab *and* the `/services` index tiles reading
   from it, seeded with the six services that exist today. This is the only version where the
   feature is real on the day it lands. It is also the only one that needs someone to decide the
   directory copy is editorial rather than code, which is a maintenance question (a translator can
   change a tile; only a deploy can change a landing page) more than a technical one.
3. **Leave it, and say so in `ContentTypes`.** Correct the "four CMS lists ops manages" comment to
   name the three that are managed and record that the fourth is reserved. Cheapest, and keeps the
   option open — but a reserved-for-later table with no user is the thing option 1 exists to prevent.

**Recommendation: (1) unless the `/services` index is wanted as editorial content**, in which case
(2) — but not (2)'s first half on its own. If neither is decided now, (3) is strictly better than
silence, because the misleading comment is the part actively costing time.

### Related

Item 22 (the admin command palette searches fixtures) touches the same console. Unrelated in cause,
but both would be resolved by the same pass over `pages/admin`.

## 27. The console's pipeline stages and the server's are two different funnels sharing one column.

**Where:** `pages/admin/properties/constants.js` (`PIPELINE_STAGES`), `AdminProperties.jsx:353,483`,
`PropertyReviewModal.jsx:115-116,233`, `PipelineStage.ORDER`, `properties_pipeline_stage_check` (V3).

This one is written up in full in `tasks/todo.md` and was, until now, only there — which broke this
file's own promise that it is the short version of the whole set. It is a product decision and it
belongs on the list to be answered in one sitting.

### What happens today

`PIPELINE_STAGES` offers **contacted / info_collected / listed / docs_submitted / under_review /
live**. The server's check constraint allows **listed / docs_submitted / photos_uploaded /
aadhaar_verified / claim_sent / claimed**. They agree on two values out of six.

The disagreement is not a typo. The console's funnel tracks *how staff acquired the listing* — we
contacted them, we collected the details, it went live. The server's tracks *what has come back from
the owner* — documents, photos, identity, claim. Both are reasonable and only one can own the
column.

So `setPipelineStage` is the one write on that screen still going to the browser store, and
`AdminProperties.jsx:322` says so in a comment: "still local ... Recorded, not reconciled". Pointing
it at the live service unchanged would send the server a value its constraint rejects.

### Why this is not a port

The server half is already built: `POST /admin/properties` (post-on-behalf) and
`POST /properties/{id}/pipeline` both exist. There is no backend work in any of the options below
except (a). What is missing is the answer to "which funnel is the column", and that is a question
about how the desk works, not about the schema.

### Options

1. **The server grows the console's two extra stages** (`contacted`, `info_collected`), and the
   hand-back milestones (`photos_uploaded`, `aadhaar_verified`, `claim_sent`, `claimed`) move to
   their own column. Keeps the console's vocabulary, which is the one staff speak; costs a migration
   and leaves `PipelineStage.reached` reading across two columns.
2. **The console adopts the server's six**, and the acquisition funnel becomes a separate field if
   it is wanted at all. Smallest change and no migration; the desk loses the two stages that
   describe the part of the job staff actually do by hand.
3. **They stay separate and the console's funnel is retired as a demo artefact.** Honest if nobody
   is using the acquisition stages to make decisions — and worth checking before assuming they are,
   since the values have only ever been written to one browser's localStorage, so no one has ever
   seen a colleague's.

**Recommendation: (3) if nothing reads the acquisition stages, otherwise (1).** (2) is the cheapest
and the one to reach for if the answer is "we do not care about the acquisition funnel" — but that
is the same answer as (3) with a worse ending, because it leaves a dropdown on the screen whose
options no longer mean what the labels say.

### Related

Item 24 (the locality curation queue) has the same shape: a console control writing to a browser
store that no colleague can see, where the fix is a decision about which object the queue is for.

## 28. The owner's dashboard offers to WhatsApp the owner a chaser from the platform, signed by the platform, that the owner sends to themselves.

**Where:** `pages/consumer/dashboard/MyListingsPanel.jsx:262-267` (`handleWaReminder`),
`pages/consumer/dashboard/myListings/ListingCard.jsx:99-101` (the control),
`lib/mockApi/whatsappTemplates.js:63-67` (`wa-dormant`),
`V78__outbound_messages.sql:140` (the server's copy of the same template).

### What happens today

On the owner's own dashboard, any listing whose freshness state is `stale` or `dormant` grows an
in-row control labelled **"WhatsApp reminder"** — deliberately in the row rather than the overflow
menu, per the comment above it, "important enough to sit in the row (not buried in More)". Clicking
it calls `sendWhatsappTemplate(l.id, 'wa-dormant')` and opens the returned `wa.me` URL.

`wa-dormant` is a staff-to-owner chaser. It reads:

> Hi {owner_name}, ⏰ Your listing "{title}" in {locality} has been *paused* because it hasn't been
> confirmed as available in a while … Just reply "YES" and we'll make it live again instantly. If
> it's already rented/sold, reply "DONE" and we'll close it for you. — PuneNest Team

So the owner is handed a pre-composed message, addressed to them, signed by PuneNest, asking them to
reply "YES" — and they are the one sending it. There is nobody on the other end of that thread. The
toast even says "WhatsApp reminder opened", which is true and tells them nothing about who it went
to.

### Why this is not a port

There is no live path and there should not be. `POST /properties/{id}/outreach` is staff-only and
403s for the owner, on purpose: outreach is the platform speaking to an owner, and an owner is not
the platform. Pointing this button at the server would mean either weakening that rule or inventing
a second, owner-authored outreach concept for a message written in the platform's voice.

It is also redundant. The single thing this chaser asks for — "reply YES to confirm it is still
available" — is already a one-tap control on the same card: `onConfirmFresh` →
`confirmListingFresh`, the live freshness endpoint shipped in `b230be8`. The owner is being offered
a WhatsApp round trip to themselves to trigger an action whose button is a few pixels away.

### Options

1. **Delete the control and `handleWaReminder`.** The confirm action it is trying to produce already
   exists on the same card and is already live. This is the one that leaves the screen more honest
   than it found it.
2. **Repoint it at the freshness confirm** — same icon and position, but it calls
   `confirmListingFresh` directly. Identical to the button already next to it, so this is (1) with
   an extra button.
3. **Keep it and change the audience:** the owner presses it and *staff* are asked to chase. That is
   a new capability (an owner-initiated outreach request), needs a queue and a rate limit, and
   inverts the direction of a feature whose whole point is that the platform decides when to chase.

**Recommendation: (1).** The template is not wrong — it is a good chaser and the server already has
it at `V78:140`, where staff can send it from the moderation console and it lands in the ledger.
What is wrong is the button that lets its intended recipient send it.

### Related

Item 26 (`services`) is the same class of thing seen from the other side: a feature built on one
half of a seam. This one is built on both halves and pointed at the wrong person.

## 29. There is no server-side internal-notes facility, and four moderation decisions are recorded only in the browser that made them.

**Where:** `components/ui/InternalNote.jsx` (the widget and `submitNote`),
`lib/mockApi/audit.js:42,63` (`addInternalNote` / `getInternalNotes`),
`AdminProperties.jsx:402,414`, `PropertyReviewModal.jsx:240,259,601`,
`PropertyModals.jsx:86,110`, `AdminReports.jsx:162`, `AdminContent.jsx:180,187`.

This is the same omission as item 27: it is written up in full and marked **OPEN, needs a product
decision** in `docs/migration/README.md:925` and `tasks/todo.md:783`, and it was never put on the
list this file exists to be. It is probably the largest single thing still standing between here and
deleting `lib/mockApi.js`, so it should not be the one item you have to go looking for.

### What happens today

Four moderation actions offer the moderator a private note box, and three of them show the note
history above it (`showHistory`):

| Action | Call | Note key |
|---|---|---|
| Archive a listing | `AdminProperties.jsx:402` | `listing:<id>` |
| Flag a listing | `AdminProperties.jsx:414` | `listing:<id>` |
| Approve / reject a listing | `PropertyReviewModal.jsx:240,259` | `listing:<id>` |
| Resolve an abuse report | `AdminReports.jsx:162` | `report:<id>` |
| Archive / restore a review | `AdminContent.jsx:180,187` | `review:<id>` |

Every one of those writes goes to `db.internalNotes` in `localStorage`. The moderation decision
beside it is a real API call and lands in the server's audit log; the note explaining *why* the
moderator decided that way does not leave their laptop. A colleague opening the same listing sees
the flag and not the reason for it, which is the half of the record that matters when the decision
is questioned later.

`lib/mockApi/users.js:109` still reads `user:<id>` notes into the user timeline, and nothing writes
that key any more — so that section is already permanently empty even on the mock. It should go
whichever way this decision lands.

### Why this is not a port

There is nothing on the server to point at. The nearest thing is
`PropertyReview.addInternalNote(body)`, and the README is right that it is narrower in two ways that
both matter: it is reachable only for a listing under verification, and it writes
`review_messages.sender_id` as NULL because it records *system* notes rather than a named
colleague's. A note whose author is structurally unrecorded cannot answer "who decided this and
why", which is the only question the feature exists for.

So this is a table, a permission atom, an endpoint and a retention policy that have never been
designed. Two questions have to be answered before any of it can be written, and both are yours:

- **Is an internal note evidence or scratch?** Evidence means immutable, retained, and exportable
  when a decision is disputed. Scratch means editable and deletable, which is friendlier to use and
  worthless the moment someone asks what happened. The widget's current behaviour implies evidence
  (`unshift` onto an append-only list, never edited, never deleted) but nothing enforces it.
- **Are notes on a *person* in scope at all?** A free-text field attached to a named user is the
  highest-risk column this product would own, and the entity types actually in use today are
  `listing`, `report` and `review` — none of them a person. Answering "no" costs nothing now and
  closes off a whole class of problem.

### Options

1. **Build it for the three entity types in use** — `listing`, `report`, `review` — as an
   append-only table with a real author id, one `notes:write` / `notes:read` pair, and no
   person-scoped notes. Deletes `addInternalNote`, `getInternalNotes` and the dead `user:` reader,
   and unblocks four screens.
2. **Build the general facility** the widget's API already implies, person-scoped notes included.
   More useful and much more to get wrong; needs the retention answer before a line is written.
3. **Delete the note boxes.** Honest, and cheaper than it sounds — the moderation *reason* is
   already sent to the server on archive (`archiveListing(id, reason)`) and on flag, so the decision
   is not unrecorded, only the moderator's free-text colour is. This is the option to take if the
   answer to "evidence or scratch" turns out to be "nobody has ever read one".

**Recommendation: (1).** It matches the entity types actually in use, avoids the one column worth
being frightened of, and the evidence-shaped behaviour is what the widget already pretends to have.
(3) is the honest fallback and should be preferred over leaving this open indefinitely, because a
note box that silently discards what is typed into it is worse than no note box.

### Related

Item 18 (the audit reader) shares the retention question — both need an answer to "what is a record
ops is allowed to remove". Item 24 and item 27 share the shape: a console control writing where no
colleague can read.

## 30. The review moderation queue exists on the server, the console still moderates the browser copy, and the server has already written down why one of the console's buttons is wrong.

**Where:** `ReviewModerationController.java:31-58,70-88` (`GET /admin/reviews`,
`PATCH /reviews/{id}/status`), `Routes.Moderation.ADMIN_REVIEWS:1420`,
`ReviewResponse.java:21-32`, `pages/admin/AdminContent.jsx:174-199` (the console),
`services/reviewService.js` (six exports, none of them moderation).

This is the closest thing left to a ready-to-execute flip, and it is here rather than done because
it deletes two buttons and needs one small contract change. On a yes it is an afternoon.

### What happens today

The server has a complete moderation surface. `GET /admin/reviews` is a paged, status-filtered
queue behind `properties:read`; `PATCH /reviews/{id}/status` publishes or rejects behind
`properties:write` and writes an audit row. `frontend-data-seam.md:1103` records the queue endpoint
being added precisely so "the review moderation queue is reachable".

`AdminContent.jsx` reaches none of it. Its Reviews tab reads the mock `listReviews()`, and its four
actions are:

| Button | What it does now |
|---|---|
| Approve | sets `status: 'published'` in `localStorage` via `saveCollection` |
| Reject | sets `status: 'rejected'` in `localStorage` via `saveCollection` |
| Archive | `archiveRecord('reviews', id, …)` + an internal note |
| Restore | `restoreRecord('reviews', id)` + an internal note |

So a moderator takes down a defamatory review, the review stays visible to everyone else, and the
rating it moved stays moved.

### Why this is not quite a port

Two things stand in the way, and one of them is an argument the server has already made.

**Archive and Restore should not be flipped, they should go.** There is no server verb for them and
`ReviewModerationController`'s class Javadoc explains why it refused to build one:

> Adding an `archived` column (as slice 8 assumed would be needed) would have created a second,
> weaker notion of "taken down" that the aggregate did not honour — the review would vanish from the
> page while still dragging the society's rating down.

That is a description of the console's Archive button. `reviews.status` is what every read path
filters on, *including* `ReviewRepository.aggregateFor`, so `rejected` removes a review from the
page and from the score in one write. Archive is the weaker notion the server declined to have, and
it is already in the product, in the browser.

**`ReviewResponse` does not carry `status`.** The queue filters on it and does not return it, so the
console cannot render "Approve" and "Reject" conditionally the way it does today
(`r.status !== 'published'`). Either the field is added — NON_NULL and populated only on the
moderation path, the same shape `PropertyResponse.adminPipeline` already uses for exactly this
problem — or the queue gets its own response type. The first is smaller and has precedent; the
second keeps a consumer DTO free of a moderation concept. This is the only real decision in the
item.

### Options

1. **Flip Approve and Reject to the live endpoints, delete Archive and Restore, add
   `status` to `ReviewResponse` as a NON_NULL back-office field.** Costs a service, two providers, a
   spec and a COVERAGE row. Removes two buttons that implement a notion the server has already
   argued against, and makes review takedown mean the same thing to the rating as it does to the
   page.
2. **Same, but with a dedicated `ReviewModerationResponse`** instead of widening `ReviewResponse`.
   One more type; keeps the consumer contract untouched.
3. **Leave it.** Costs nothing today and keeps a console where the takedown button does not take
   anything down outside one laptop.

**Recommendation: (1).** The NON_NULL back-office field is a pattern this codebase already uses and
tests, and the alternative type would duplicate eleven components to add one. Take (2) instead if
you would rather the public review contract never learn the word "rejected".

### Related

Item 29 — the Archive and Restore paths also write internal notes, so whichever way this lands, two
of the note call sites in item 29's table disappear with them. Item 27 — same shape again: a console
vocabulary that drifted from the server's, where the server's is the one with the argument attached.


## 31. The referral scheme's consumer half is entirely browser-side, the code the product tells people to share is invented in that browser, and the fraud desk sits at the end of a funnel with no entrance.

**Where:** `billing/referral/ReferralsController.java:41-52` (`GET /me/referrals`,
`POST /referrals/redeem`), `ReferralCode.java:14-35`, `ReferralSummaryDto.java:3-11`,
`ReferralQualification.java:57`, `Routes.Referrals:1250-1256` ·
`frontend/src/pages/consumer/Refer.jsx:8,24-29`, `frontend/src/lib/store/referrals.js:7-33,48-58`,
`lib/store/billing.js:59-66`, `lib/store/contactQuota.js:4`, `context/AuthContext.jsx:3` ·
`frontend/src/services/referralService.js` (four exports, all staff-side) ·
`frontend/src/pages/ops/OpsReferrals.jsx:3`.

### What happens today

The server has a complete referral scheme. `referral_codes` (V23) mints one permanent code per
user — "One code per user, forever — rotating it would break every card and forwarded message
already carrying the old one". `POST /referrals/redeem` takes a code and a share channel;
`ReferralQualification` credits the referrer when the referee's *first listing passes ownership
verification*, "because clearing the document gate is the only qualifying action a browser cannot
fake"; `GET /me/referrals` returns `ReferralSummaryDto(code, invited, converted, rewardsEarned,
rewardsPending)` in whole rupees. Both are open to any signed-in user, and the controller's own
Javadoc says so: "Two audiences on one resource."

The client calls neither. `referralService.js` has exactly four exports — `listReferralQueue`,
`approveReferral`, `rejectReferral`, `clawbackReferral` — and its only importer is `OpsReferrals`.
The staff half is live. The consumer half has never been wired.

So `Refer.jsx` runs on `lib/store/referrals.js`, and the sharp end of that is `referralCode()`:

```js
const base = u?.name ? u.name.replace(/[^a-z]/gi, '').toUpperCase().slice(0, 4) : 'PUNE';
c = base + (myMobile() ? myMobile().slice(-4) : Math.floor(1000 + Math.random() * 9000));
```

Four letters of the user's name and four digits of their mobile, stored under
`pnReferralCode:<mobile>` in localStorage. The server's code is a different string in a different
format (`PUNE-AB12`). **Every referral link the product has ever produced carries a code
`POST /referrals/redeem` could not resolve** — which is academic only because nothing calls that
endpoint either. The loop is closed browser-side by `creditReferrer` / `claimReferralCredits`, on
counters the same browser increments.

The consequence at the far end: `referrals` holds five seeded rows in the e2e database
(`pending 2, rewarded 1, rejected 1, clawed-back 1`) and no product path creates a sixth.
`OpsReferrals` is a fraud desk reviewing fixtures.

### Why this is not a port

`lib/store/referrals.js:7-33` already argues the blocker, and argues it correctly:

> These counters are NOT the server's ledger and must not be treated as one. They stay until there
> is a `referral` domain in `services/providers/{mock,http}` **and a product decision mapping the
> server's ₹ credit onto the client's quota** (free listing slots / free contacts) — two different
> currencies today, which is why the seam cannot simply be pointed at the existing endpoints.
> Removing them first would delete a shipped perk with nothing to restore it from.

Half of that precondition is now met — `services/providers/http/referralProvider.js` exists, and
`referral` is a live-only domain (D184). The other half is the decision below, and it is a real
one: the server pays rupees, the browser grants +15 contacts and +1 listing slot. Those are not
the same thing and no arithmetic turns one into the other.

But the comment scopes the problem to *rewards*, and two of the three broken things are not about
rewards at all. The **code** is not a currency question — the server has one and the client
invents one, and only one of them can be right. Neither is **redeem**: a referee arriving on a
link should tell the server whose code they came in on regardless of what anyone is eventually
paid. Those two are a port. Only the quota mapping is a decision.

### Options

1. **Port the code and the redemption now; leave the reward currency alone.** `Refer.jsx` reads
   its code from `GET /me/referrals` instead of minting one; the invite-link landing calls
   `POST /referrals/redeem`; `invited` and `converted` come from the server. `referralBonusListings`
   and `referralBonusContacts` keep running on the local counters exactly as today, and the ₹
   figures are not displayed. **Recommended.** It fixes the two things that are wrong rather than
   ambiguous, it makes the fraud desk mean something, and it leaves the currency question open
   without making it worse — which is what the comment was protecting.
2. **Port everything, and decide the currency.** Display `rewardsEarned` / `rewardsPending` in
   rupees on `Refer.jsx` and either (a) keep the local quota perks alongside them, which means
   telling a user they have earned ₹500 *and* one listing slot for the same referral, or (b) retire
   the quota perks in favour of the rupees, which deletes a shipped benefit. Both need the product
   call the comment is waiting for.
3. **Leave it.** Then the code in every shared link stays unresolvable, `ReferralQualification`'s
   verification hook never fires for a real user, and the fraud desk keeps reviewing seed data.

### Related

Item 20 (finance) owns the other half of "the server counts rupees and the console does not read
them". Item 22 (command palette) is the other case of a screen wired to a source that cannot
answer it.

### Note on how this was found, which changes an earlier claim

The unreached-route survey in `tasks/todo.md` said six routes had no client caller and called six
"a floor, not a total". It is a lower floor than that note realised. The survey extracted route
constants by regex over string literals and found 114; `Routes.java` declares **243**, because
**129 are computed** — `REDEEM = BASE + "/redeem"`, `MINE = BASE + "/mine"`, and so on. The audit
saw 47% of the surface. `POST /referrals/redeem` is one of the 129 it could not see, and it is the
missing entrance described above.

---

## 32. The owner's private property record has a complete server lifecycle, an empty table, and a client that quietly mints a record for every listing you own

**Where:**
- `backend/src/main/java/com/punenest/api/catalog/managed/MeManagedPropertiesController.java` — six routes: `GET`/`POST /me/managed-properties`, `GET`/`PATCH`/`DELETE /me/managed-properties/{id}`, `POST /me/managed-properties/{id}/publish`
- `backend/src/main/resources/db/migration/V33__managed_properties.sql` — the table, seeded with **0 rows**
- `frontend/src/lib/data/managedProperty.js` — the localStorage store, key `puneNestManagedProps:<mobile>`
- Client call sites: `PropertyPassport.jsx:10`, `Dashboard.jsx:23`, `MyListingsPanel.jsx:11`, `RentPanel.jsx:6`, `RentOMeter.jsx:9`, `lib/data/ownerProperties.js:17`

### What happens today

The server side is finished and unusually careful. `ManagedPropertyService`'s Javadoc: publish "does not merge the record into the catalogue — it creates an ordinary *pending* listing through `ListingService#create` (so every trust invariant on a new listing still applies) and links back to it. It is idempotent: a record already carrying a `publishedListingId` is returned unchanged, with no second listing spawned." Ownership comes from the token, never the body; a record that is not the caller's returns 404 rather than 403, "so we don't confirm another owner's record exists". The DTO deliberately carries source data rather than a rendered card — "presentation strings (formatted price, gallery, 'society, locality, Pune' line) are derived on the client, so the wire stays the source data".

`managed_properties` holds zero rows. Nothing in `frontend/src` has ever called any of the six routes. Every managed record any user has ever created lives in that user's browser.

### Why this is not a port

Four of the six operations line up almost exactly, and if that were the whole story this would have been done rather than written down. It is not, for two reasons.

**`publishManagedProp` does three things the server's `publish` does one of.** The client version (`managedProperty.js:123`) mints a listing id from `Date.now()`, writes a fully-formed listing row straight into the mock DB with `status: 'pending'`, marks the managed record published, *and* unshifts a notification into `puneNestNotifications`. The server's `publish` calls `ListingService.create` and links back. Whether the platform should also announce a submitted listing to its own owner is a real question with a real answer, and it is not one this port gets to decide by accident. The notification currently written is client-local: nobody else can see it, it does not survive a browser change, and it exists because the mock had nowhere else to put it.

**`ensureManagedForListing` has no server counterpart at all, and it is not obvious it should.** `ownerProperties.js:35` calls it for every property listing the user genuinely owns, so that "My Properties" can show passport tools on a listing that was posted the normal way. It auto-creates a managed record as a side effect of *rendering a list*. On localStorage that is free. Against the API it is a `POST` per listing on every load of the owner dashboard — and it would leave the table holding one row per listing, which is a different data model from the one V33's comment describes ("the owner's private 'single-player' property record").

There are at least three defensible readings. The bridge is a real feature and the server should own it (a route that returns-or-creates). The bridge is a mock workaround for the passport needing an id, and the passport should accept a listing id directly. Or managed records and listings should have been one table from the start and this is the seam telling us so. Picking one is a product decision about what a managed property *is*, which is exactly the kind of thing that should not be settled inside a migration commit.

### Options

1. **Port the four clean operations now; leave publish and the bridge alone.** `getManagedProps`, `getManagedProp`, `registerManagedProp`, `updateManagedProp` and `deleteManagedProp` go through a new `managedPropertyService.js` with both providers. `publishManagedProp` and `ensureManagedForListing` stay on `lib/` behind the existing seam guard, with a comment saying why. This gets the Rent-o-meter's saves onto the server — the thing a user would actually notice, since today a valuation saved on a phone is invisible on a laptop — without deciding anything. **Recommended.** It is the same shape as the notification-preferences port that just landed: move what is genuinely a move, record what is genuinely a decision.

2. **Port everything and answer both questions.** Requires deciding whether publish notifies, and which of the three readings of the bridge is right. Probably one new server route either way.

3. **Leave all of it.** Defensible only if managed properties are considered a prototype surface. They are not: `V33` is applied, the OpenAPI document declares all six paths, and `SpecCoverageTest` counts them.

### Related

Item 20 (service catalogue — the same "server built, client never called" shape, five routes). Item 31 (referrals — same shape again, and there the *client* had invented a competing identifier). The notification-preferences port (commit `01a69e2`) is the worked example of option 1's argument.

### Note on what makes this one different from 20 and 31

In items 20 and 31 the client had built a *substitute* for a server feature and the substitute was wrong — a referral code minted in the browser that `POST /referrals/redeem` could never resolve. Here the client's version is not wrong. `managedProperty.js` is a competent little store and the passport built on it works. What is wrong is only that it is per-browser, plus one function that does something the server was never asked to do. That is why the recommendation is a partial port rather than a flip: there is no fiction to retire, only a scope to correct.

---

## 33. The saved-search match count on the notifications screen is silently capped at one page, and the endpoint that would fix it does not exist

**Where:**
- `frontend/src/pages/consumer/Notifications.jsx:150` — `listProperties({}).then((props) => …)`
- `frontend/src/pages/consumer/listings/alertCriteria.js` — `countMatches(search, props)`
- `frontend/src/services/providers/http/propertyProvider.js` — `PAGE_SIZE = 100`
- `Routes.Engagement.SAVED_SEARCHES = "/me/saved-searches"`, `SAVED_SEARCH_BY_ID` — **no match-count route**

### What happens today

The notifications screen derives its "N properties match *your saved search*" cards in the browser. It fetches one page of listings and runs each saved search's criteria over the result in JavaScript.

The http provider's `PAGE_SIZE` is 100. The seeded catalogue has 38 approved listings, so today the page *is* the catalogue and the count is exactly right. That is the only reason this is not visibly broken.

At 101 listings it becomes quietly wrong: the count is a number, the number renders, the card looks identical. A user with a broad saved search — "2 BHK rent in Pune" — would be told 100 in a city with 4,000. There is no error state to reach and no empty state to notice, because a smaller number is a plausible number.

The same effect also picks the "still available" card by scanning `props` for a saved id (L169). That one degrades differently: a saved property outside the first page makes the card vanish rather than under-count, so the user simply stops being reminded about the listing they saved.

### Correction — the truncation is not silent, it is inaudible, which is a different problem

The paragraph above first said this was "wrong in a way nothing will report" and that there was "no assertion in the suite that could catch it". Both were written before reading the provider, and both are wrong. `propertyProvider.js` has `warnIfTruncated(page)`, which fires on exactly this condition and names exactly these consumers:

> `${page.totalElements} listings matched but only ${returned} were fetched. Client-side aggregates (Societies, Locality, Compare, LocationInsights) and the admin tables are now reading a partial catalogue and need server-side aggregates or paging.`

So somebody already saw this coming, wrote the detector, and left the list of affected surfaces in the message. The bug is real; the claim that nobody would know was not.

What *is* true is that nothing can hear it:

- It is `console.warn`, and `e2e/helpers/console.js:101` drops every message whose `type()` is not `'error'`. Every `consoleErrors` assertion in the suite is blind to it by construction.
- The warning's own list omits this call site. It names Societies, Locality, Compare, LocationInsights and the admin tables. `Notifications.jsx` is a sixth consumer that was added later and never added to the message — so even a developer reading the warning in a browser console would not be told the notifications counts were affected.
- And the condition never holds against the fixtures. 38 < 100, so the warning has never fired in a test run or a dev session, which is why nothing has ever prompted anyone to notice the list had gone stale.

That last point is the general one, and it survives the correction: **a detector that cannot fire below the fixture ceiling is indistinguishable from no detector at all.** Whichever option below is taken, the cheap independent win is to make this audible — either promote it to `console.error` (it is a correctness failure, not a style note), or seed a fixture set above the ceiling so the detector has a chance to run.

### Why this is not a port

There is nothing to port to. `/me/saved-searches` supports create, list, update and delete; there is no endpoint that answers "how many current listings match this saved search", and no obvious place to add one without deciding what a saved search *means* on the server.

That decision is not small. `countMatches` reads the client's own criteria object — the same shape the filter bar produces — and the server's saved-search row stores a query string. Making the server count means either teaching it to interpret that criteria shape, or agreeing that a saved search is a URL and counting by re-running the listings query with it. The second is much less code and much more honest, but it makes the saved search's meaning depend on the exact filter semantics of whatever version of `/properties` is deployed, which is a different property from "the criteria I chose".

Either way it is a server feature with a data-model question in front of it, not a seam flip.

### Options

1. **Add `GET /me/saved-searches/{id}/match-count`** (or a `matchCount` field on the list response, which costs one query per row and removes a round trip). The server re-runs the stored query against the live catalogue and returns a count. **Recommended if this screen is meant to be trustworthy** — it is the only option that is correct at any catalogue size, and putting the count next to the row that defines it means the two cannot drift.
2. **Ask for a count, not a page.** Keep the derivation client-side but request `size=1` and read the total from the paged envelope, per saved search. Correct for the *count*, but it does not fix the "still available" card, and it is N requests for something the server could answer in one.
3. **Cap it honestly.** Render "100+" when the page came back full. Cheapest, and it stops the screen from asserting a number it cannot know — but it is a smaller lie rather than a true statement, and it leaves the saved-property card still silently dropping listings past the first page.
4. **Leave it.** Defensible only while the catalogue is under 100 listings, which is a condition nothing enforces and nobody will notice crossing.

### Related

The notification-preferences port (commit `01a69e2`) is what brought this code into view — the effect that reads the prefs is the same effect that does this counting. The port deliberately did not touch the counting, because a page-size bug and a preferences seam are two changes.

### Note on how this was found, and what it says about the suite

Not by a failing test. Every test covering this screen runs against the seeded catalogue, where 38 < 100, so the cap is invisible to all of them. It was found by reading the code around an unrelated change.

Worth recording as a pattern: **a bug that only appears above a data-volume threshold is invisible to a suite whose fixtures sit below it**, and no amount of assertion strength helps. The tell is not a red test; it is an unbounded client-side aggregation over a paged fetch. That shape is worth grepping for on its own.

### The grep was run. Here is what it found

Three other places in the frontend aggregate over an unbounded list read, and — to the credit of whoever wrote them — **two were already known and written down before this item existed**:

- `pages/admin/AdminDashboard.jsx:98-114` fetches six collections and derives its tiles from them. Its own comment (added in `01a69e2`) already says the tiles "go wrong the moment a collection is paged", and says that reconciling them with the server's `AdminKpis` is a product decision. Same bug, already recorded, no new item needed.
- `propertyProvider.js:warnIfTruncated` is the detector for exactly this condition. It predates all of this. Corrected in place rather than duplicated here.
- `pages/consumer/Listings.jsx:40` is the interesting near-miss. It looks like the worst instance — the whole browse surface running its filter pipeline over one fetch — but it is not, because `toQuery(filters, sort)` sends the filters to the server and `warnUnsupported` names the ones with no server equivalent. The server filters; the page then caps the *already-filtered* set at 100 and does not paginate. That is an ordinary missing-pagination gap, not a silently-wrong aggregate, and it belongs to whoever picks up paging rather than here.

The conclusion is not "there are more of these"; it is that the codebase already knew about the shape in two places and the third instance still got written anyway. A pattern that is documented at the point of *detection* but not at the point of *use* does not stop the next occurrence. That is the argument for the message change above pointing at this item rather than carrying its own list of callers.
