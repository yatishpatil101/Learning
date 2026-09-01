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
