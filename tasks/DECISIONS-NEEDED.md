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
