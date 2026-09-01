# Lessons

## Fixing a bug can make a second one visible by removing its disguise (2026-08-15, wave 4a)

Flatmate reports were being filed with `kind: 'user'` — the wrong target type, which meant they were
labelled with the owner vocabulary in the admin queue. Wrong, but *there*. Correcting the mapping to
`kind: 'share'` was unambiguously right and it made every one of those reports vanish from the
screen, because the queue split its rows two ways over a wire that carries four target types and
`share` matched neither branch.

So the mislabelling had not been a cosmetic bug sitting next to a structural one. It had been
**load-bearing**: it was the only reason the reports were reachable at all. The visible defect was
the disguise on an invisible one, and the fix was what took the disguise off.

Two things follow. First, when you correct a value that routes something, check where it routes to
*now* — a mapping fix is a re-route, and the new destination may not exist. Second, the gap was not
found by looking; it was found by **arithmetic**. The spec asserts `open + closed` equals
`listings + users + posts`, two partitions of the same set, and those two sums could not be made to
agree while a target type had a row and no tile. An assertion that two independently-computed
totals match will find a whole missing category, which no amount of "does this element render"
ever will.

## A deleted file can be load-bearing for a test that never mentions it in code (2026-08-15, wave 4a)

Retiring `e2e/tests/admin/reports.spec.js` removed a spec that was named in
`SourceTreeHygieneTest.MOJIBAKE_EXEMPT`. Nothing failed. The repo-wide encoding guard skips files on
a path list, and a path that no longer exists is simply never matched — a stale exemption is silent
by construction. The frontend and e2e gates cannot see a Java constant, and the backend suite went
green because the guard's job is to find damaged files, not to police its own exemption list.

Two things were wrong, and only one of them was the dangling path:

- The exemption existed because the old spec asserted the queue renders no mojibake, and it did so
  by typing the broken sequences as literals — which meant the file had to be excluded from the very
  guard that looks for them. **An exemption is a hole in a guard.** The replacement builds the same
  needles with `String.fromCharCode`, so it asserts the same thing while staying protected.
- The assertion itself was nearly lost. It was in the deleted spec's tail, past the part I had read
  when deciding what the 55 tests were worth keeping. It survived because the exemption named the
  file and the name looked stale — the dangling reference is what surfaced the coverage.

Then the guard caught the replacement: writing a comment *explaining* mojibake with a literal
example is itself mojibake in a source file. Rewording the comment was right; adding the file back
to the exemption list would have been the same hole in a new place.

**Takeaway: when you delete a file, grep the whole repo for its name, not just its imports.** Path
strings in config, exemption lists, CI globs and docs are references that no compiler or linter
checks, and every one of them fails open. `grep_search` for the bare filename across all languages
takes seconds; this one turned up a real assertion worth porting.

## One string, five places, four rounds of "fixed it" (2026-08-15, mock retirement Phase 5, wave 4a)

The admin reports queue rendered `'Anonymous'` as the fallback for a reporter's name. Live, that
fallback is the *only* branch — `ReportResponse` deliberately omits `reporterId`, so the mapper
resolves `reportedBy` to `''` on every row. The copy was wrong on the merits, too: the reporter is
not anonymous. `reports.reporter_id` is NOT NULL and drives the duplicate-report index. The platform
knows exactly who filed it. "Anonymous" tells a moderator the complaint is unattributable, which is
a much easier one to wave away; "Withheld" says the true thing.

It took four passes to change one word, because the string had been copied to five places:

1. the table column,
2. `REASON_OPTS`' neighbour in the same file — found while fixing #1,
3. the detail drawer,
4. the mobile stacked card,
5. `lib/data/reports.js`, the mock seed (left alone deliberately — it dies at P5c).

Passes 1–3 were each "the fix". Pass 4 was found only because the new live spec asserted
`getByText('Anonymous')` had **count 0** rather than asserting the good string was present.

Two things worth keeping:

- **Assert the absence of the wrong value, not just the presence of the right one.** A row can
  render "Withheld" in the column and "Anonymous" in the card, and every positive assertion passes.
  The negative assertion is what found the fourth copy — and it found it in markup the desktop
  viewport does not even display, which no amount of careful reading of the rendered page would
  have caught.
- **When you fix a duplicated string, grep for the old value before declaring done.** Three separate
  times the fix was verified by re-reading the code that had just been edited, which can only ever
  confirm the copy you already knew about.

The same shape produced the sibling defect in this domain: a hand-copied `REASON_LABELS` table that
had drifted from the vocabularies it was copied from. The durable fix in both cases was to delete
the duplicate rather than synchronise it — the labels now live in one module (`lib/reportReasons.js`)
that the modal, the admin filter and both providers import.

## Six ways a suite that was never run had already rotted (2026-08-14, mock retirement Phase 5, D219)

The live suite had 739 tests in 63 files and had never been executed end to end — only ever a file
at a time. The first full run was 730 passed, 6 failed. Not one of the six was a product bug in the
work under way; every one was a defect **in the tests**, latent for weeks, and every one was
structurally invisible to per-file runs. The six sort into three mechanisms, and the mechanisms are
the lesson, not the fixes.

**A seeded column that nothing read, until something did.** `users.status` shipped in V2 and was
decorative. V77 made login enforce it. At that instant two specs broke, because they had picked
fixture names off the seed without checking a column that had never mattered — `Sakshi Iyer` and
`Riya Rao` are both `suspended`. Nothing announced it. The migration was correct, the specs were
correct when written, and the pair was wrong. *When a column stops being decorative, every consumer
that predates the enforcement is a suspect, including test fixtures.*

**Cross-spec mutation on a database that persists for the whole run.** `globalSetup` resets once per
run, not per file, so any spec that mutates a shared seeded account poisons every later spec reading
it. `live-property-integration` signed in as Omkar Kulkarni and called the Aadhaar simulate
endpoint, which sets `users.verified` *and back-fills the badge onto every listing he owns*. He owns
`p5007` — the anchor `live-verify-payoff` uses as its **unverified** owner. One spec republished
another spec's control, forty tests earlier. Both files pass alone; together, one fails on an
assertion about a badge it never touched.

The rule was already written down, in the docstring of `signedInAsNew` in the very helper that spec
imports: a spec that flips a seeded actor's state is breaking the next spec's premise rather than
testing a transition. *A convention documented next to the affordance that enforces it is still not
enforcement.* Worth noting how bad the failure signature is: the symptom appears in an innocent
file, and bisecting by file never reproduces it.

**Elapsed time as a hidden input.** `signedInAs` caches a session snapshot per mobile per run and
replays it. Past the 15-minute access-token TTL the replayed token 401s; `http.js` recovers by
refreshing, which **rotates** the refresh token; the cache still holds the pre-rotation one. Replay
it and the server sees an already-rotated token presented again — indistinguishable from theft — and
reuse detection revokes the whole family (ADR-008). The session dies, `ProtectedRoute` bounces to
`/signin`, and the test fails naming a locator on a screen it never reached, with nothing about auth
in the error.

The backend was right at every step; the harness was handing it a token it had every reason to
distrust. *Any run long enough to cross a TTL is a different experiment from a short one.* A single
file finishes well inside 15 minutes, which is exactly why 63 files of green never showed it, and
why the one 58-minute run did.

**And a bonus: the same mistake made twice, in two files, one of which had already fixed it.**
`live-drafting-desk` had been bitten by an unanchored `/[6-9]\d{9}/` PII assertion matching a digit
run *inside* a longer id, fixed it with lookarounds, and left a comment explaining the trap.
`live-support-queue` carried the unanchored copy and was bitten by a different long digit run — a
`Date.now()` stamp another spec had put in a ticket subject. A copied regex does not inherit the
scar tissue of the file it was copied from. Hoisted to `fixtures/live.js` so there is one copy to be
right.

**The through-line.** A spec that has never been executed is a claim, not coverage — and a spec
executed only in isolation is a *weaker* claim than it looks, because isolation suppresses exactly
the failure modes that shared state and elapsed time produce. Per-file green measures the specs; only
the full run measures the suite. Run it before trusting it.

## An unconverted page is not just unconverted — it can be a feature aimed at the wrong door (2026-08-15, mock retirement Phase 5, D219)

The owner listing wizard was on the "convert later" list for months, filed under wave 5 as routine
plumbing. It was not routine. `POST /me/listings` is where the server's duplicate probe runs, so for
as long as the wizard wrote to localStorage the detector was reachable **only** from admin
post-on-behalf — a desk of five people — while the abuse it exists to catch arrives through the
public form and nowhere else. The feature was shipped, tested and green, and pointed at a door
almost nobody uses.

The lesson is about how conversion work gets prioritised. "Which pages still write to localStorage"
is the wrong question; **"which server-side behaviour has no caller on the path that actually
produces the data"** is the right one. The second question found this in one grep — `toListingCreate`
had exactly one call site — and the first had it queued behind a dozen cosmetic flips.

**Three field-mapping traps, all of which fail silently.** An unmapped key on a write does not
error; it is simply dropped, so the request succeeds and the value vanishes.
- Names differ across the seam more than you expect: five address boxes fold into one line, `rera`
  becomes `reraId`, and a maintenance amount split into a sale field and a rent field has to fold
  into the entity's single column. Each of these was a live drop.
- **Absent is not zero.** `floor` is only collected for flats and commercial units. Sending `0` for
  villas, plots and PGs would give every such listing in one society an identical
  `(society, floor, bhk)` tuple — and the new ten-minute duplicate sweep would then re-file them
  against each other forever. The bug would have surfaced as a flood of case notes a week later,
  attributed to the sweep rather than to the mapper.
- **An address line without the unit token is a detector aimed at a building.** "Rohan Nilay, Baner"
  normalises to the same AddressKey for every flat in the tower. A flag on a whole tower is a flag
  nobody can act on, which is indistinguishable from no detector at all.

**A mock-mode spec cannot see any of this, and that is worth saying out loud in the spec.** The mock
provider writes to the same localStorage the old code wrote to, so a full regression to pre-seam
behaviour leaves every mock spec green. The mock spec here asserts what it *can* — the shape of the
payload handed to the provider — and the claim that the request reached a server is made only live.
Writing down which half of a behaviour each test can prove is what stops the next person from
"consolidating" them.

**A field that becomes writable becomes readable, and those are reviewed by different people.**
The sharpest thing review found was not in the new code at all. `PropertyResponse.address` had been
an ordinary ungated string for as long as it had existed, and it was safe the entire time for a
boring reason: nothing could write it. The moment the wizard started sending a composed address —
with the flat number in it, because the duplicate key is worthless without the unit token — that
same ungated field became a unit-level address book of every live listing, served to anonymous
callers. Nothing in the diff touched the response. Nothing in the UI rendered the field, so no
amount of clicking would have shown it. The mapper's own guard mechanism existed and had been
applied to the meter number in the previous slice, by the same reasoning, and was simply not
extended to the field that had just changed category.

The general rule: **when a write path starts populating a column, re-read every projection of that
column as if it were new.** "Was this field already in the response?" is the wrong question — it was
already there and already fine. The question is what it now contains. A column that used to hold
nothing, or held something coarse, does not announce that it has started holding an identifier.

**Two smaller versions of the same shape, both worth remembering.** A per-tick ceiling over an
*unordered* query does not sample — under a stable plan it returns the same rows every tick, so the
overflow is not a backlog that catches up, it is a set that is never processed and then ages out of
the window. The only symptom is a log line that reads like a queue behind schedule. And a handler
that gains an `await` gains a double-submit window: it was a few milliseconds of localStorage work,
it is now a phone on a train. Here that was especially pointed, because two POSTs from one owner
produce exactly the duplicate the new detector cannot see — `findDuplicateCandidates` excludes the
caller's own listings by design.

**A live spec that has never been run is not coverage, it is a claim.** D218's verification-thread
spec was written, reviewed, cited in COVERAGE.md and merged without a backend ever having been up.
On its first execution it failed — it decided a case file that had never been opened, because
creating a listing does not open one and only the duplicate probe and an explicit submit do. The
spec was missing a call the real console makes. Nothing was wrong with the server; the spec had
simply never met it. That is a distinct failure mode from a flaky test and it does not announce
itself: a red suite is loud, an unexecuted suite is silent and reads as green in every summary
above it. The same run also surfaced a mapper divergence the mock-mode wizard spec caught — the
wizard was sending a numeric field as the form's string, which the mock provider stores verbatim
while the http mapper coerces, so the two sides of the seam disagreed about a value the duplicate
signal depends on. **Both bugs were in specs and mappers written the same day, by someone who
believed the work was finished.** Run the thing before writing the row in the coverage table.

## Four ways a green suite lied (2026-08-14, mock retirement Phase 5, D218)

D218 shipped an ordering column, a duplicate detector and a staff-only note lane. Every one of the
four things that went wrong got past a fully green test run, and each got past it differently.

**A comment can be load-bearing and false.** Three separate comments I wrote asserted facts that
were not true and were the *reason* for the code they sat above: that `lastMessageAt` was "null
until the first message" (it is never null), that a `BigDecimal.toString()` hazard justified a
normalisation step (no BigDecimal is in that signal), and that the new column would diverge from
`updated_at` (it cannot yet — every writer of one writes the other). The third one had spawned a
test asserting a distinction the schema cannot make. Nothing failed, because a comment cannot fail.
Check the premise, not just the review: **if a comment states a fact, go and read the fact.**

**A test that passes because of a side effect of the fix is not a regression test.** The ordering
test was written to prove `lastMessageAt` sorts differently from `updated_at`. It could not: the
only writers that move one move the other. The honest outcome was to rewrite it to assert what is
true and say in the test, in words, that the distinction does not exist yet and why the column is
still correct. A test asserting a difference that does not exist will pass today and mislead
whoever changes it.

**An edit that deletes a newline can comment out the next statement.** A stray edit to `V82` glued
`update property_reviews …` onto the end of a `--` comment line. The backfill was gone and the
following `set not null` would have aborted the migration on every database that had not yet run
it. The suite was green, because the suite's database had already run V81 — **a green suite does not
exercise a migration that has not run yet.** Read migrations back after editing them, in full.

**A guard clause in a domain method makes every caller a liar unless it reads the outcome.**
`Property.requestRecheck` returns early on a listing that is not publicly visible. The caller posted
"Your listing stays live — our team is re-checking these details" regardless, so the owner of a
pending, off-search listing was told it was live, and a case file was opened holding a note about
work nobody was doing. Branch on what the domain *did* (`getRecheckRequestedAt() != null`), never on
what the request asked for.

Two smaller ones from the same day. `Number('N/A')` is `NaN`, `NaN` serialises to `null`, and the
contract reads `null` as *cleared* — so a non-numeric input did not fail validation, it silently
erased a good value; coerce with `Number.isFinite`, and omit rather than send. And an ops screen
that computes its answer locally will render **"no duplicate clusters — supply looks clean"** in
http mode forever: a surface that asserts a false negative about real supply is worse than no
surface, because a moderator will believe it.

## A mock that copies the business rules and not the access rules (2026-08-15, mock retirement Phase 5, D217)

The `propertyReview` mock provider was written by reading `PropertyVerificationService` and
reproducing what it *does*: a blank message is a 400, a missing case file is a 404, an owner cannot
decide their own listing. All correct. What it did not copy was who the server lets in at all —
`participantProperty` on the thread, `PROPERTIES_READ` on the queue, `PROPERTIES_WRITE` on the
decision — because those live in an annotation and a shared helper rather than in the method body
you are transcribing from. The result passed code review, and the security pass found that in any
mock build a signed-**out** visitor could approve a listing (deciding also writes
`properties.status`, so that publishes it), a stranger could post into someone else's case file and
have it stored as the **owner's own** message, and any session could page the entire staff queue.

The reflex is to discount all of that as "it's only the mock". Two reasons not to. The demo build is
a real artifact that real people are shown, and localStorage seeded with other actors' data is not a
defence when the product UI itself renders it without devtools. The more expensive reason is the
second-order one: **screens are built in mock mode.** A permissive mock means the forbidden and
empty states are written against behaviour the API will never produce, and they are first exercised
in production, by the person they lock out.

So the rule for a seam mock is that access rules are part of the contract being mirrored, not
scaffolding around it — and the guard has to copy the server's *shape*, not just its intent. This
one answers **404, not 403**, for a non-participant, because a 403 confirms the listing exists and
is under review; a mock that 403s teaches a screen to render an error the live API does not send,
which is the same failure in the opposite direction.

Two details that made the guards subtly wrong on the first attempt. `myOwnerId()` and
`ownerIdOfProperty()` both answer `null` when they cannot resolve an identity, so the obvious
`ownerIdOfProperty(listing) === myOwnerId()` makes an anonymous session the owner of every
unattributed listing, and 403s a staff member over two unknowns; only a *resolved* match counts. And
`mySide()` resolves any non-internal session to `'owner'`, which is what turned a missing
participant check into misattribution rather than mere over-exposure — the stranger's message did
not arrive as a stranger's, it arrived as the owner's.

## The default branch of a normaliser must not be the destructive one (2026-08-15, D217)

`decidePropertyReview` accepts the wire's `approve`/`reject` and the mock store's
`approved`/`rejected`, so it normalises. The obvious form:

```js
const verb = input.startsWith('approve') ? 'approve' : 'reject';
```

is a rejection for every typo, every `undefined`, every capitalised `Approve` — the destructive,
owner-visible, audit-logged side. It also silently removes a guard that already existed: the server
refuses anything that is not exactly `approve` or `reject` with a 400, and this converts that 400
into a successful rejection before the request is ever sent. A two-way normaliser over asymmetric
outcomes needs three branches, and the third throws.

The throw itself is worth shaping: raise the `ApiError` the server would have sent, not a bare
`Error` with the function name in the message. A caller branching on `err.status` then handles the
local guard and the remote one identically, and the two providers stay interchangeable in their
failure modes as well as their successes.

## The DPDP guard reviews your feature before you do (2026-08-15, mock retirement Phase 5, wave 4)

D216 added `outbound_message` and `message_template`. The feature compiled, its own eight
tests were green, and the full suite then failed with *"2 column(s) in the migrated schema
look like personal data and are not classified"*. `ErasureCoverageTest` reads the migrated
schema, matches every column name against a vocabulary, and demands that a human place each
match in `ERASED`, `RETAINED` or `GAPS` with a reason. It found `outbound_message.recipient_mobile`
and `message_template.name` the moment the migration ran, which is the earliest anyone could
have asked the question and long before the feature reached a user.

The two answers were genuinely different, which is the point of forcing them to be written
separately. `message_template.name` is the label of a piece of outreach copy — identical for
every owner it is ever sent to, written by this platform, no data subject behind it — so it is
`RETAINED` with that sentence. `outbound_message` is the opposite: the row records that a named
person was contacted on their number. The tempting fix is to null `recipient_mobile` and keep
the row as evidence, and it is wrong, because `body` holds the rendered message. *"Hi Ramesh,
could you send photographs of your flat in Kothrud?"* is personal data in free text, where no
future column-name sweep will ever find it. A half-erased row is worse than either alternative:
the data is still there and the classification says it is not. So the sweep deletes the row.

**Adding a table to `ERASED` is three edits, not one.** The map entry is the claim; a seed row
in `seedEverySweptTable` is what makes the claim provable; and a `SWEPT_ROW` where-clause is how
the verifier finds the row afterwards. Miss the third and the failure is
`select count(*) from outbound_message where null` — *"column index is out of range: 1, number
of columns: 0"* — which reads like a JDBC bug and is really the test saying it does not know how
to identify the subject in your new table.

The wider lesson is about where a check belongs. Nothing about erasure was on the plan for a
messaging feature. The classification list did not have to be consulted, remembered, or found;
it ran on the schema and failed the build. A checklist in a document would have been read once,
during the first feature that touched personal data, and never again.

## A masked field is not an editable field (2026-08-14, mock retirement Phase 5, wave 4)

`GET /users` publishes mobiles through `MobileMask` — `9733798115` becomes `97XXXXX115`. The Edit
member modal loaded that string straight into an editable, required, 10-digit-validated input. So
the form was simultaneously offering to overwrite a real credential with its own redaction, and
guaranteed never to pass its own validator: `digits10('97XXXXX115')` is five digits, the toast fired,
and the modal never closed. Editing a colleague's name was impossible and had been for as long as
the screen had been live — the mock served unmasked numbers, so no mock spec could see it.

Three things generalise:

- **If the server redacts a value on read, the console must render it read-only.** A round-trip of a
  redaction is data loss dressed as an edit. Where the field is also the sign-in credential and no
  route changes it, say so in the helper text rather than leaving a disabled box unexplained.
- **Omit it from the payload entirely**, don't send back what you were given. `mobile: f.id ?
  undefined : mobile` means an edit cannot touch it even if a future refactor re-enables the input.
- **Validate on create only.** A validator that runs against a value the form is not allowed to
  change can only ever produce a false refusal.

The bug was found by a live spec on its first run, not by review. Masking is exactly the class of
behaviour a mock cannot reproduce, because the mock has no reason to hide anything from itself.

## When a live spec cannot reach the screen it asserts on, question the guard before the spec (2026-08-14, wave 4)

Five of six RBAC tests failed at `page.waitForURL('**/admin')`, timing out on `/staff-login`. The
instinct is to fix the fixture. The actual cause was a product gap: `/admin` was
`RoleRoute roles={['admin','manager']}`, and `manager` had been removed with the custom-role bundles
that were its only source — so the shell named a role that could no longer exist, and no scoped
account could reach the console its permission atoms nominally opened.

That is a decision, not a defect to be patched around, and it went to the user: keep the shell
administrator-only, or admit staff and gate per module. The ruling was administrator-only, which then
*changed what the spec should assert*. Nav contents are unassertable for an account that may not load
the shell — so the spec now narrows a real staffer through `PUT /users/{id}/permissions` and checks,
**with that account's own token**, that `GET /admin/properties` is 200 and `GET /reports` is 403.

That is the stronger test regardless. A sidebar that hides a link proves the console is polite; a 403
proves the server is not. Anything only the UI refuses is not refused.

## Two lookup traps in this UI that produce confident wrong failures (2026-08-14, wave 4)

- **`Table.jsx` renders every row twice** — an `sm:hidden` stacked card for mobile, then the
  `hidden sm:block` table — so a bare text match resolves to the *hidden* duplicate and the
  assertion fails on visibility with no hint that the row exists and is fine. Always scope to
  `getByRole('row', { name })`.
- **A paginated directory needs a page-walking helper, not `.first()`.** `AdminTeam` shows 12 of 16
  accounts and the list is four stitched `GET /users` reads with no promised total order, so which
  page a member lands on is not stable across runs. `.first()` on an empty locator is a timeout, not
  a "not found", which reads like a missing feature.

Both cost a full live run each. The tell for both is the same: the accessibility snapshot in
`error-context.md` shows the element plainly, which means the page is right and the locator is wrong.

## An English-only test helper hides a whole language's worth of coverage (2026-08-13, mock retirement Phase 5)

Converting `platform/i18n` to the live backend, three tests failed with a timeout inside
`helpers/liveAuth.js` — not on anything i18n-related. `signIn` locates its submit button by
accessible name, `/send otp|continue/i`, which is English. On a Hindi or Marathi page it matches
nothing. The seeded suite never met this because it wrote a user into `localStorage` rather than
signing in, so the helper had never been asked to operate a translated screen.

Two things worth carrying:

- **A helper written against the default locale silently caps what the suite can reach.** The hole
  is not "three tests fail" — those were fixed by signing in before switching language. The hole is
  that `/signin` and `/signup` in hi/mr are now covered for *render* and never for *use*, and
  nothing reports that. Localisation coverage gaps do not announce themselves; they present as an
  unrelated timeout.
- **Do not fix a shared helper in passing.** Eleven live specs depend on `signIn`. Changing its
  locator while mid-conversion trades a known, documented gap for an unknown suite-wide flake. The
  ordering workaround is honest for tests that are about the pages *behind* auth; the real fix (a
  `data-testid` on the submit, or a per-language name table) belongs to whoever next touches the
  auth screens, and is written down where they will find it.

## A "does the API already do this?" check can come back "no, and it should" (2026-08-13, mock retirement Phase 5)

The standing rule for a mock's business logic is: check whether the backend already returns the
value, and if it does, the fix is `git rm`, not a port. `verify-payoff.spec.js` was built entirely on
`applyVerifiedBadgeToListings` — obviously mock plumbing, obviously deletable.

It was not. `properties.owner_verified` was a real column with a real entity field, a real response
member and six frontend read sites. The only missing piece was the writer. That is the shape of gap
that survives review: every individual piece is present, so nothing looks absent, and the failure is
silent on the side that cannot complain. The owner verified, saw a green pill on their profile, and
every listing they held went on telling buyers they were unverified.

Two more of the same shape fell out while proving it. `PropertySummary` had no `ownerVerified`, so
live search results were badge-free for everyone while the detail page badged correctly — the card
being a *different schema* from the detail read is exactly how a field comes to exist on one and not
the other. And `OwnerCard` printed "Verified Owner · Ownership Verified" whenever either flag was
true, so a listing whose paperwork checked out claimed its owner had passed identity checks he had
never taken.

- The check is "does the backend do this?", not "is this mock code?". Those have different answers.
- A denormalised column with no writer outside the seed is a promise nobody kept. Grep for the
  *writes*, not the reads — the reads are what make it look implemented.
- Two independent booleans rendered by one `||` will eventually claim the wrong one. If the labels
  differ, compose them per-flag.
- Pick the negative anchor so that a lazy assertion fails. p5007 has ownership verified but no owner
  badge; an anchor with neither would have let "no badges at all" pass for "the right badge absent".

## Grepping a generated SQL dump costs 30 KB to answer what `select` answers in one line

`grep_search` for `owner_verified` under `db/**` returned 20 matches, each a ~1500-character
single-line INSERT — about 30 KB of context, and it exhausted the budget for that stretch of work.
One `psql` join answered the actual question (which listings disagree with their owner?) in seven
short rows, and answered it *better*: it showed the seed contradicting itself in both directions,
which reading the INSERT statements would not have made obvious.

Ask the database about data. Grep source for source. And when a fixture is wrong, fix it with a
derived `UPDATE` rather than hand-edited literals — the dump is generated, so literals are lost on
the next regeneration and a rule cannot drift from the invariant it encodes.

## A scheduled job that logs its own failure is a job nobody knows is broken (2026-08-13, mock retirement Phase 3)

Sweeping `e2e/backend-e2e.log` after a fully green live run turned up one `ERROR`:
`ReferralSignalRetentionSweep` failing with `No active transaction for update or delete query`. Every
tick since the class was written had failed the same way. The D55 promise — referral IP and
User-Agent digests expire after ninety days — had never once been kept, in any environment.

The cause is the oldest Spring bug there is, wearing a disguise. `ReferralSignalRetention.expireNow()`
called `expireSignalsOlderThan(...)` on `this`. A self-invocation never leaves the object, so it never
crosses the CGLIB proxy, so the `@Transactional` on the inner method applied to nobody. The stack
trace says so out loud — `ReferralSignalRetention$$SpringCGLIB$$0.expireNow` at the top, plain
`ReferralSignalRetention.expireSignalsOlderThan` below it, the proxy entered once and then stepped
around. Fix: annotate the outer method, the one the caller actually reaches.

What made it survive review and a 1400-test suite:

- **The test covered the one entry point that was never broken.** `ReferralQualificationTest`
  calls `expireSignalsOlderThan` directly — through the proxy — and proves the right rows are cleared
  at a chosen cutoff. It is a good test. It just does not touch the method the scheduler calls.
- **`AbstractApiTest` is `@Transactional`, so no test extending it can ever catch this.** A test
  asserting `expireNow()` works would inherit an ambient transaction and pass whether or not the
  method starts one. That is the same blind spot as the lazy-loading defect recorded in
  `e2e/COVERAGE.md`, reached from the other direction: there the transaction hid a missing fetch,
  here it hides a missing transaction. The new `ReferralSignalRetentionSweepTest` is a bare
  `@SpringBootTest` with **no** `@Transactional` for exactly this reason, and was mutation-proved by
  deleting the annotation and watching it go red.
- **The trigger swallows the exception on purpose, and that is still correct** — one bad tick must
  not kill the schedule. But "log and carry on" only works if somebody reads the log. Nothing in the
  workflow did until a sweep was run by hand.

Generalisations worth keeping:

- **`@Transactional` belongs on the outermost method a caller can reach**, not on the method that
  happens to issue the write. Any `private`/self-called helper carrying it is decoration.
- **A `@Scheduled` method's real entry point needs its own test, without an ambient transaction.**
  Proving the inner unit works proves nothing about the wiring above it.
- **Grep the application log after a green run.** A suite going green means the assertions passed,
  not that the process was healthy. Background work — sweeps, schedulers, listeners — has no
  assertions pointed at it and fails in total silence.

## `getByRole('heading').first()` makes a 404 page look like a passing test (2026-08-13, mock retirement Phase 3)

Two live specs navigated to `/services/interior` and `/services/valuation`. Neither route exists —
`App.jsx` has `/services/interior-renovation` and `/services/property-valuation`, and the short forms
are the *type filter* the tracker is given, not the path it lives at. React Router answered both with
the 404 page.

The two tests failed in completely different ways, and only one of them failed at all:

- The tracker test waited for `GET /api/service-requests` and timed out after 20s. The 404 page
  mounts no `ServiceTracker`, so nothing ever asked. Read as "the endpoint is broken"; the endpoint
  was never called.
- The round-trip test opened `/services/valuation`, waited for `getByRole('heading').first()` — which
  the 404 page satisfies, because it has a heading too — and then drove the whole write path through
  `page.evaluate(import(...))`, which does not care what is on screen. **It passed.** It had been
  passing against a 404 for as long as the wrong path had been there.

- **A "page loaded" assertion that any page satisfies is not an assertion.** `getByRole('heading')`,
  `waitForLoadState`, `expect(page.url())` after a client-side 404 — all green on the error page.
  Name the heading, or assert something only the intended page renders.
- **Driving the API through `page.evaluate` decouples a test from the page it opened**, which is the
  whole point of the technique and also its blind spot: the `goto` becomes decoration, and a broken
  one produces no symptom. If a test navigates at all, one assertion has to depend on where it went.
- The neighbouring failure is what exposed this. Nothing else would have — a route can 404 for every
  browser and every user and still leave this suite green.

## `punenest_test`'s reference data can be deleted and only one endpoint notices (2026-08-13, mock retirement Phase 3)

Five tests went red at once — every one of them a reels assertion, all of the shape
`expected:<10> but was:<0>`. The suite had been 1483/0/0 an hour earlier and the only code change in
between was a join fetch in `PropertySpecs`, which reels does not go anywhere near
(`ReelRepository` is two derived finders on its own table). The change was innocent: `select
count(*) from reels` in `punenest_test` was **0**, while `punenest` and `punenest_e2e` both held the
seeded 10.

`reels` is seeded by `R__seed_reference_data.sql` in `db/migration`, which runs for every profile —
the same file that supplies the 348 societies and 155 localities. Being *repeatable*, Flyway only
re-applies it when its checksum changes, so once the rows are gone they stay gone and every
subsequent run is red for a reason that has nothing to do with the code under test. Re-seeding is
one line, because the file is written as `ON CONFLICT ... DO UPDATE` throughout:

```sql
delete from flyway_schema_history where script = 'R__seed_reference_data.sql';
```

Flyway re-applies it on the next test-context boot. Verified with `select count(*) from reels` → 10.

Two things worth keeping:

- **A failure cluster that is confined to one domain exonerates a change in another.** The instinct
  when the suite turns red right after an edit is that the edit did it; the cheaper check is whether
  the failures and the edit share any code at all. Here a single `grep` for `Reel` in `main/` settled
  it before any bisecting.
- **`TestDatabaseIsolationTest` asserted `localities` is positive and nothing else.** That is why this
  drifted silently: the one test whose job is "reference data is still loaded" checked a single table
  out of the **nine** the seed populates, so losing `reels` was invisible until an unrelated feature
  test happened to depend on it. Now widened to all nine as a `@ParameterizedTest` — non-empty rather
  than exact counts, because the failure worth catching is *the rows are gone*, while pinning 155
  localities would fail on ordinary content work and get its expectation bumped instead of read.
  Mutation-proved: emptying `reels` turns it red naming that table, re-seeding turns it green.

## A committing `@AfterEach` cleanup deadlocks against its own test transaction (2026-08-13, mock retirement Phase 3)

`punenest_test` is meant to be empty between runs, and it was holding four `users` rows.
`UserService.provisionBuyer` is `REQUIRES_NEW` on purpose — it isolates a concurrent first sign-in's
`UNIQUE(mobile)` violation so the caller can adopt the winner's row instead of returning a 500 — so
its insert commits and the class-level `@Transactional` rollback never reaches it.

The obvious fix was a cleanup in `@AfterEach`. A plain `jdbc.update` there is a **silent no-op**:
Spring's `TransactionalTestExecutionListener` ends the test transaction *after* `@AfterEach` runs, so
the delete joins that transaction and is rolled back with everything else. So the delete has to
commit — which means its own `REQUIRES_NEW`, which means a **second connection**, which then blocks
on the row locks the still-open test transaction is holding. Postgres sets no lock timeout, so the
symptom is not an error: Maven simply stops producing output forever, one line after
`Started AuthEndpointsTest`. It looks exactly like a hung terminal.

`@AfterAll` is the answer — by then every test transaction has closed and nothing is held. It has to
be `static`, and Spring will not inject into a static method, so capture the `DataSource` into a
static field from `@BeforeEach` and build a `JdbcTemplate` from it in the teardown.

Two things worth keeping:

- **In a `@Transactional` test, per-test cleanup of committed rows is not possible.** The only two
  positions that work are `@AfterAll`, or dropping `@Transactional` for the class entirely (which is
  what `FlatmateInterestRaceTest` and `FlatmateDuplicateInterestRaceTest` already do — their
  `@AfterEach` deletes are real precisely because those classes are *not* transactional).
- **A Maven run that goes quiet mid-suite is a lock wait until proven otherwise.** Check
  `pg_stat_activity` for `wait_event_type = 'Lock'` before assuming the terminal died. The earlier
  run of this same command finishing in ~60s is what made "hung terminal" the tempting read; the
  tell is that the log stops immediately after the *first* test's teardown.

Still open: the same trap means the `@AfterEach` `audit_log` deletes in the `@Transactional` classes
clean nothing, and most audit writes have no cleanup at all — `punenest_test` had accumulated
**12,267** `audit_log` rows. Truncated by hand; a suite-wide sweep is the real fix. See tech debt.

## 15 red tests with a `NoClassDefFoundError` behind them are one fault, not fifteen (2026-08-13, mock retirement Phase 3)

`live-property-integration.spec.js` went 15-for-15 red with a spread of 500s across unrelated
domains — documents, contact requests, visits, reports. Nothing about that shape says
"infrastructure": the failures are in different features, with different assertions, and each one
reads like a real bug in the thing it names.

The backend log said otherwise in one line:
`NoClassDefFoundError: com/punenest/api/deals/visit/VisitMapper`, and
`ContactStatuses`, and `DocumentUploads`, and `ReportTargetTypes`. `Test-Path` on
`target/classes/...` confirmed the classes were simply **not on disk** — a long-running
`spring-boot:run` was serving from a `target/classes` that had been partially emptied underneath it
while it ran. Classes already loaded kept working, which is exactly why the process stayed up, the
health endpoint stayed `UP`, and two earlier spec files had passed cleanly an hour before. Only
endpoints touching a not-yet-loaded class failed, which is what produced the scattered,
product-shaped failure list.

Three things worth keeping:

- **`NoClassDefFoundError` at *runtime* in a process that started fine means the classpath changed
  under it.** It is never a code defect in the endpoint that reports it. Do not read the stack trace
  for meaning; check whether the file exists.
- **A JVM that has been up for hours is not evidence that its classes are still there.** Lazy
  loading makes a half-deleted `target/classes` survive indefinitely and fail only on first use.
- **The cost here was the triage, not the fix.** The same signature had already been seen this repo
  as "mass `Errors:` with `Failures: 0` is an infrastructure fault, not 1200 bugs" (debt wave 13).
  Same lesson, different surface: when failures are *broad and shallow*, suspect the environment
  before the code — and check the server's log before reading a single test's assertion.

Practical guard: never leave a `spring-boot:run` serving `target/classes` while anything else builds
into the same directory, and re-check `Started PunenestApiApplication` against the log's *most
recent* boot, not the first one in the file.

## A red spec after a migration is usually three faults wearing one error (2026-08-13, mock retirement Phase 3)

Six drafting-desk tests failed identically after the live-DB migration, and the obvious read was
"the migration broke them". It had not touched a line of backend logic — `git diff --stat -- backend`
proved that before anything else was investigated, which is the step that made the rest honest. What
was actually there, in the order they surfaced, each one hidden behind the previous:

1. **`type: 'rental'` is not a valid service-request type.** The server rejects it deliberately, and
   its own comment says why: `rental` used to miss the exact-match pricer and file a *free* rent
   agreement that ops then worked for nothing. The contract really is law — this is the same lesson
   that cost three round trips earlier in the same session.
2. **One unpaid rent-agreement per account.** With the type fixed, five of six tests turned 409:
   they all seeded from one shared fixture consumer. Fixed by raising each matter from a throwaway
   mobile — unknown mobiles auto-register as buyers, which makes that free.
3. **The staff sign-in screen defaults to Administrator.** The console asks *which* console before it
   asks who you are, and a service-team account that leaves the default alone is refused with no
   readable error, just a stalled `/staff-login`.
4. **And underneath all of it, `/staff-login` had never been converted to the live API at all** — a
   pre-existing, documented gap belonging to a later phase.

The lesson is not any one of those. It is that **the first failure masks the rest**, so "I fixed the
error" is never the same claim as "the test passes", and a spec that has never run in a given
configuration should be assumed to have several faults, not one. Fault 4 also could not have been
found by reading the diff: it needed the browser's own accessibility snapshot to show a correctly
filled form that still went nowhere.

The final call was a scope one, not a technical one: fixing 4 meant pulling a whole later phase
forward, so the six tests are `test.describe.fixme` with the reason and the cross-reference written
into the file. `fixme`, not `skip` — the runner then reports them as known-broken rather than
quietly passing, and deleting that one line is the acceptance test for the conversion.

## Assert through the contract that answers the question, not the one that is nearby

The same run had a spec asserting `user.status === 'archived'` after an archive. It fails, and the
tempting fixes are all wrong: `archive()` sets an `archived` **boolean** and never touches the
separate `status` column, and `UserResponse` publishes `status` but carries no `archived` field at
all — so the API positively reports an archived user as `active` (**D216**). The spec was not
merely failing, it was *asserting on a bug*, and would have gone green the moment someone "fixed"
it by loosening the expectation.

The check that survives is `GET /users?archived=true`, which filters on the real column. Two rules
fell out of it: **when an assertion fails, first ask whether the field you are reading is the field
that holds the fact** — a passing assertion on the wrong field is worse than a failing one on the
right field, because it retires the question. And **when a spec's mechanism is obsoleted but its
intent is not, port the intent.** D206 removed the password parameter from staff creation, so the
same spec's "staff login still works (200)" could never pass again — but its real intent was
*one live row versus two*, and that survives intact as **401 versus 500**.

## An endpoint existing is not evidence that it answers your question (2026-08-13, mock retirement Phase 5)

Two consumer features read admin-owned settings the browser had no way to fetch. For feature flags
the fix was real: `AppFlagsContext` read a localStorage copy nothing updated, so the admin console
wrote `maintenanceMode: true` to the API, reported success, and the site stayed up. A public
`GET /flags` closed it.

The second one I got wrong, and the only reason it did not ship is that reading the code came before
writing it. `geoConfig.js` decides which cities are live; `GET /cities` exists, is public, and
returns `{slug, name, live, listingCount}`. It looks like the same shape of hole, so I recommended
wiring it and the recommendation was accepted. Then:

- The `cities` **table has exactly one row** (Pune). The picker's roster of five lives in a
  `CITY_GEO` constant, and the four "coming soon" entries are deliberately *not* rows — they exist to
  be waitlist targets. Sourcing the picker from the endpoint would have silently deleted four cities
  from the dropdown, taking the waitlist funnel with them.
- The switch the tests actually exercise is the admin override `settings.geo.cities[name].live`,
  which lives in the same admin-only document — the identical hole to the flags one, wearing
  different clothes. `GET /cities` does not address it, because **there is no admin write path for
  `cities.live` at all**: `Routes.Cities` has only `BASE` and `WAITLIST`.

So the endpoint answers "which cities does the database know about", and the question was "which
cities may a shopper switch to". Nearby, plausible, and not the same question. The real defect is
underneath both: **a cities table that does not list the cities you can join a waitlist for.**
Seeding the four as `live = false` rows and giving the admin console a way to flip the column makes
`GET /cities` the single answer to roster, liveness and inventory, and retires `CITY_GEO.live`, the
settings override and the hardcoded "only Pune has data" together. Deferred and written down rather
than half-built.

This is the mirror of the earlier lesson that absence of evidence in the caller graph is not evidence
of absence in the codebase. Both are the same failure of nerve: treating a cheap signal — no callers
found, an endpoint with the right nouns in it — as if it were the answer. **The endpoint's shape
tells you what it returns; only its data source tells you what it means.** One `select count(*)` on
`cities` would have settled it before the recommendation, not after.

## `page.waitForTimeout` in a flag test is usually a missing ordering constraint

The seeded feature-flag spec set a flag, then slept 300–500ms, then asserted — because the flag was
written to localStorage *after* the page had already booted and read it, so the test was waiting for
a re-render it had no way to await. Moving the write to the server made the sleeps disappear rather
than shrink: set the flag, *then* navigate, and the page's first read is already the value under
test. Every `waitForTimeout` in that file was paying for an ordering the test could have simply
chosen.

The converse is the trap worth naming. Once flags are server state, they are **shared by the whole
run**, and a test that disables `savedListings` and then fails leaves it disabled for every spec that
follows — failing somewhere else, later, looking like flakiness. The restore therefore belongs in a
Playwright fixture's teardown, which runs even when the test body throws, and not in each spec's
`afterEach`, which is one more thing to remember. Restore to a **snapshot taken on first write**, not
to a blanket `true`: that distinction is invisible for the default-on features and catastrophic for
`maintenanceMode`, where absent means enabled and the seed says `false` on purpose.

## `--repeat-each` in isolation is the wrong experiment for a flaky spec (2026-08-13, debt wave 14)

- **A spec declared "fixed, environmental" on the strength of 3/3 in isolation flaked on both
  mobile projects in the very next full sweep.** `mobile/phase3.spec.js:157` was closed on
  2026-08-10 after passing on repeat with no code change. The full 1708-test run (1694 passed / 0
  failed / **9 flaky**) reproduced it twice. Repeating one spec on an idle machine cannot recreate
  the thing that breaks it — **worker contention** — so a green repeat run is not evidence of a
  fix. It is evidence that the load is gone. Only a full sweep can name the flaky set.
- **The recorded flaky set was wrong in both directions.** The three long-standing suspects
  (`commercial-type-filter.spec.js:60`, `flatmates/video.spec.js:27`, `prefreeze.spec.js:66`) and
  `admin/content.spec.js:59` did not flake at all, while two specs nobody had flagged did. A
  known-flaky list decays: re-derive it from a real run before trusting it to excuse a red.
- **Corollary for the register:** "passed on retry in isolation" belongs in a row as an
  observation, never as a closure. Close a flake only when the timing assumption it depends on is
  gone from the code.

## Four e2e sweeps died to infrastructure that read as mass test failure (2026-08-13, debt wave 14)

- `reuseExistingServer: !CI` makes Playwright **attach to a Vite server it does not own**. When
  that server's owner exits, every navigation returns `ERR_CONNECTION_REFUSED` — 550 of them in one
  attempt. The report looks like a catastrophic regression; nothing is wrong with the app.
- **The tell is the uniformity.** Real regressions cluster by feature; an infrastructure failure
  fails specs that share nothing but a `page.goto`. Before debugging a suspiciously broad red run,
  check the port: `Get-NetTCPConnection -LocalPort 5173 -State Listen`, and kill any orphaned
  `@playwright/test/cli.js` node process. Then let the run start its own server.

## A green static gate cannot tell you the app boots (2026-08-11, debt wave 3)

- **`npm run check` + `npm run lint` + `npm run check:size` all passed while the application
  rendered an empty `<body>` on every route.** A Vite build resolves an import cycle perfectly
  happily; the temporal-dead-zone throw only exists at *execution* time, so no bundler, type-check
  or linter can see it. **A frontend wave is not verified until one e2e spec has actually rendered
  a page.** Add a cheap untouched-spec canary to the end of every wave.
- **The fastest diagnosis for "everything is red" is a throwaway spec, not reading the failures.**
  When *pre-existing* tests start failing alongside new ones, stop reading assertions — suspect the
  app. A ten-line spec that hooks `page.on('pageerror')` and `console.log`s `body.innerText()`
  named the exact error in one run, after two full suite runs had produced nothing but timeouts.
  Playwright's own `error-context.md` was useless here: it dumped helper source.
- **Reading a module-scope `const` from a module inside an eager-glob import cycle is a landmine
  that an unrelated file can detonate.** `config.js` does `import.meta.glob(..., { eager: true })`
  over every provider, and `http.js` imports `config.js`, so each provider can be evaluated *inside*
  `http.js`'s own evaluation. Two providers read `MAX_PAGE_SIZE` at module scope and had worked for
  months; adding a *third, unrelated* provider changed the glob's ordering and blew both up. The fix
  is to defer the read — `const paged = () => ({ size: MAX_PAGE_SIZE })` — which costs nothing and
  removes the file from the cycle's critical section. Three other providers are currently safe only
  because they happen to read it inside function bodies. See D208.
- **A register row can describe work that has already shipped.** D176 was picked up as open work;
  all three prescribed corrections were already in the tree and live in both databases (confirmed
  with `\d+`, not by reading the prose). Verify a row against the system before implementing it —
  the register is a claim, not an observation.
- **When a new test fails on an assertion beyond the fix's actual scope, the assertion is the
  suspect.** Three D183 tests passed every hand-off assertion and then failed on "and it shows up in
  Messages". The hand-off was correct; a fresh ask has `state: 'pending'`, which `Messages.inTab`
  files under **Requests**, and the test was looking at Chats. The tell was that one of the three
  failed on the plain *success* path, which the change had not touched at all. Do not delete the
  assertion to go green — find out which of the two halves is lying.

## Tooling traps that produce a confident wrong answer (2026-08-11)

- **`Get-Content` on a UTF-8 file makes every closed row look open.** The tech-debt register marks a
  closed item with `—` in the priority column, and its own documented recount snippet uses
  `Get-Content` — which decodes the BOM-less UTF-8 file as cp1252, so that em-dash arrives as
  `â€"` and never equals the `—` in the comparison. The recount therefore reported **63 open** when
  53 were open and 10 were closed-but-kept, and it reported area clusters over a set that included
  them. It looks right: the number is plausible, the script is the one the file tells you to run,
  and nothing errors. Two fixes, both cheap — read with
  `[IO.File]::ReadAllLines($p,[Text.Encoding]::UTF8)`, and compare against the `\p{Pd}` character
  class rather than a literal dash you had to type. Generalisation: **a documented command is not a
  verified command.** The snippet had been in the file for months, and the count it produced was
  wrong in exactly the direction nobody checks — upward, which reads as diligence.

- **Playwright's `-g` cannot survive a `cmd /c "…"` wrapper.** `-g \"invents no rating\"` inside the
  double-quoted `cmd /c` string loses its closing quote, and Playwright receives `rating\` as the
  pattern: `SyntaxError: Invalid regular expression: /rating\/gi`. It fails loudly here, which is
  the good case — but the same escaping would silently *narrow* a pattern that happened to stay
  valid, and a filtered run that matches fewer tests than intended reports green. Run the whole spec
  file instead; it costs seconds and cannot lie about what it ran.

- **A test that passes on its first attempt is the one most worth mutating.** The D198 accessibility
  spec went green immediately, which was suspicious rather than reassuring: it depends on an
  eligibility gate (`hasTenancy`) to open the dialog at all, so "passed" and "never opened the
  dialog, asserted on nothing" are indistinguishable from the outcome alone. Blanking the
  `aria-label` produced `Expected: 1, Received: 0` — proof the assertions were reached and are load-
  bearing. The rule from earlier passes stands and is cheap: **a green test proves nothing until you
  have watched the mutation go red.**

## A subagent whose report is lost has still changed your tree (debt wave 13)

Four lanes were launched in one message. Three came back as a transport error — an
`invalid_request_error` about `thinking` blocks — with no report at all. The instinct was to treat
them as no-ops and relaunch.

**All three had run to near-completion.** Between them they had written four new migrations, twelve
new production classes, six new test classes, and had changed two shared constructors. What was lost
was the *narration*, not the work. Relaunching would have produced duplicate migrations against a
schema that already had them.

- **Reconstruct before you re-run.** `git status --porcelain` plus a count of each lane's
  signature class names answered "how far did it get" in one command, for all three, in seconds.
- **A failed return path is the most dangerous kind of failure**, because the tree is in a state
  nobody described and no test can currently reach — the wave left it *non-compiling*, so every
  lane's work was simultaneously present and unverifiable.
- The transport error correlates with **several `runSubagent` calls sharing one assistant message**.
  Launch them one at a time. The wall-clock saving from batching is not worth an unnarrated tree.

## Mass `Errors:` with `Failures: 0` is an infrastructure fault, not 1200 bugs (debt wave 13)

The first full run after recovery reported `Tests run: 1422, Failures: 1, Errors: 1207`. Nothing was
wrong with 1207 tests. One lane had applied `V73` to the shared test database and then edited the
file, so Flyway's `validate` failed on a checksum mismatch, which failed `flywayInitializer`, which
failed `entityManagerFactory`, which failed **every `@SpringBootTest` context in the suite**.

- **The shape is the diagnosis.** A real regression produces `Failures`. A number in `Errors` that
  is close to the whole suite is always context startup, and context startup is almost always
  Flyway, the datasource, or a bean that cannot be constructed. Grep the log for `checksum`,
  `FlywayValidateException` and `Error creating bean` *before* opening a single test report.
- After repairing it the count went 1207 → 4. The four were the actual regressions, and they were
  legible in a minute.
- The root cause was procedural: the lanes were each given their own database and **used the shared
  one anyway**. An instruction that a lane can ignore silently is not an isolation mechanism. If
  isolation matters, it has to come from something the lane cannot route around.

## Splitting a service is not a line-count exercise (debt wave 13)

`ServiceRequestService` grew 1087 → 1241 and tripped the size guard. The cheap fix is to move a
hundred lines somewhere. The useful fix is to notice *why* it grew: two new rules had arrived that
had nothing to do with what the class was for.

It was split three ways, and each piece is justified by its dependencies rather than its size —
`ServiceDeskAuthority` (static, no collaborators at all: a pure function of caller and target),
`TicketMirror` (the flow's only reach into another aggregate, so the dependency is now visible in
one constructor instead of hidden among a dozen), and `ServiceRequestQueryService` (the read side,
which shares nothing with the payment state machine but the table). The write side kept none of
them and lost six now-dead imports with them.

- **Delete the delegating wrappers.** Leaving `private X foo(...) { return New.foo(...); }` behind
  keeps the call sites unchanged and is tempting, but it keeps the reader in the old file and costs
  ~20 lines. Point the call sites at the collaborator.
- **Then RED-proof the extraction.** Moving code is exactly when a guard silently stops guarding.
  Mutating `deskFilterFor`'s deskless branch turned two tests red; mutating `TicketMirror`'s
  ownership check turned two more red, one of them a `404 → 201`. That is the only evidence that the
  rule survived the move.

## Closing a whole debt register in one wave

- **A subagent whose report is lost has still edited the tree.** Two lanes died to
  `net::ERR_NAME_NOT_RESOLVED` mid-run. The instinct is to treat a lost report as a lost lane and
  re-run it — which would have re-applied one lane's migration and left a duplicate. The tree is the
  record, not the report: reconcile with `git status --porcelain` **first**, read what is actually
  there, and only then decide whether anything is missing. One of the two lanes had completed
  entirely and left three regressions behind it that nobody would have been looking for; the other
  had done nothing but drop two scratch files.

- **A guard can stop guarding an endpoint without any test going red.**
  `SpecSchemaParityTest.leafSchema` unwraps the *paged* `allOf` and returns `null` for every other
  composition rather than guess. So expressing a detail schema as `allOf: [Feed, extras]` — which
  reads better, and which a reviewer would wave through — silently removed three operations from
  parity checking while the whole suite stayed green. **The dangerous refactor is not the one that
  breaks a guard, it is the one that makes a guard skip you.** When a change makes a check *simpler*
  or *quieter*, verify it still fires: mutate the thing it is supposed to catch.

- **Measure on the artefact you ship.** A row claimed the dashboard fired duplicate requests. Under
  `vite dev` it fires 13 — StrictMode double-invokes, dev only. Under a production build it is 6
  requests to 6 distinct endpoints, zero duplicates. A second trap sat behind the first:
  `page.route` reported **0** requests for a seeker, because it cannot see requests a service worker
  serves. Two different instruments, two different wrong answers, in the same investigation.

- **Register rows rot in more ways than being stale.** In one pass a row was filed against the wrong
  component entirely (the account pill it wanted moved was already in the header, not the bar named);
  a row described work already in `HEAD` (the gesture existed; only its a11y half was missing); a
  row's blocking reason named a dependency that was in fact cached; and a row asserted "zero are
  provably empty" about a population it had also miscounted by 174. **Re-derive before acting on any
  row, including its problem statement — not just its status.**

- **A hand-maintained count at the top of a document is the least trustworthy thing in it.** The
  debt register's header was re-derived four times in one session and was wrong each time. The last
  defect was invisible to a reader: a row struck through and closed had *kept its priority cell*, so
  every script counting "rows with a priority" reported one more open item than existed. Derive the
  header from the rows with a script committed next to it, and make the script assert its own
  reconciliation (`open + closed + gaps == max id`) so a miscount is a failure rather than a number.

## Parallel-agent tech-debt waves (this session)

- **A test that asserts on a float measurement is asserting on the renderer's rounding too.**
  The one hard failure in a 1668-pass suite was `boundingBox().height` returning
  `43.99993896484375` against a `>= 44` floor — for a control whose CSS is literally
  `min-height: 44px`. The tell that it was noise and not a regression was not the magnitude
  (2⁻¹⁴ is easy to hand-wave either way) but the **inconsistency**: the retry named a
  *different* button. A real layout break is deterministic about which control it breaks;
  a measurement artifact wanders. Confirmed with `--repeat-each=3` before touching anything.
  Two things this makes routine. First, when a threshold assertion fails just barely,
  **check whether the codebase already decided this** — `phase3.spec.js` had carried
  `MIN_TAP - 0.5` for exactly this reason, so the fix was adopting an existing convention,
  not inventing a tolerance. Second, loosening a bound is only safe if you **prove the loosened
  bound still fails on the real defect**: stripping `tap-target` off the button still failed,
  so the half-pixel buys nothing back for the 26px icons the file exists to catch. A tolerance
  added without that check is indistinguishable from switching the test off.

- **Fixing a pattern in the copy leaves the original wrong, and now the repo argues with itself.**
  The per-target vocabulary work built the society review composer properly: every star carries
  `aria-label="{n} star for {aspect}"` and its spec asserts an exhaustive `ASPECTS.length * 5`.
  The property composer it was modelled on — `StarInput.jsx`, six instances in one modal — labels
  **nothing**: thirty buttons whose accessible name computes to empty, a plain WCAG 4.1.2 failure
  that predates the change. The change did not cause it, but it did make it *load-bearing*: the
  next person reading the two directories now sees the right pattern and the wrong pattern shipping
  side by side, with nothing saying which is intentional. Generalisation: after building a good
  version of an existing thing, **go read the existing thing**. If it does not match, either bring
  it along or write down why not — a repo that demonstrates both answers to the same question has
  no answer. (Recorded as D198, then **fixed 2026-08-11**: the assertion collision the deferral
  worried about — `getByRole` matches names by substring — turned out to need one `exact: true` on
  the overall-strip query and nothing else. Worth noting how the deferral aged: the cost was
  estimated from the *shape* of the risk rather than by grepping for the collision, and the grep
  would have taken a minute and closed it in the same pass.)
- **A guard that keeps a test re-runnable can quietly switch the test off forever.** The live society
  spec posted its own fixture, correctly guarded on `reviewCount === 0` so a second run would not
  wedge on `AlreadyReviewedException`. But the per-aspect assertions were gated on `if (seeded)` —
  and once the first run rated the hardcoded society, every later run found `reviewCount > 0`,
  skipped the write, left `seeded` false, and **silently disabled the entire block the spec was
  written for**. Green, fast, and testing nothing. It was caught only by noticing the run took 4.8s
  where a write path should take ~14s, then querying the API and finding `categoryAverages: {}`. The
  fix was to resolve the target **at runtime** — pick any still-unrated row from 348 — so the write
  path stays reachable indefinitely and the aggregate asserted was produced by *this* run rather than
  inherited. Generalisation: whenever a test skips work to stay idempotent, ask **what the skip
  disables**, and make the skipped branch either impossible or self-announcing. A conditional
  assertion is only as good as the frequency of its condition — and a condition that goes false
  permanently after the first run is a test that deletes itself.
- **A green test against an empty fixture proves nothing, and a healthy-looking 200 is how you get
  fooled into writing one.** Lane B added live-API coverage for property reviews. Probing the running
  backend first showed the seeded DB had **zero** property reviews across all 16 listings — and both
  reads answered **200**, the list with `[]` and the summary with `reviewCount: 0`. So a spec that
  asserted "the page loaded and nothing errored" would have been green against a database that could
  not tell success from silence. That is precisely how the original bug shipped: `listPropertyReviews`
  pointed at `/reviews/property/{id}`, which is not a route, 404'd on every live read, and the page's
  `catch` rendered a friendly "no reviews yet". A total outage looked like an empty state, and every
  mock test passed. Generalisation: **query the API directly before writing the assertion**, confirm
  the fixture exists, and assert on content only the server could have produced — a specific review's
  text, a specific average — never on the absence of an error. If you cannot state what the test would
  print when the backend is dead, it is not testing the backend.
- **Marketing copy is a promise the code has to keep, and nothing checks it.** `home.json` states in
  all three locales that ownership is verified "through the Index II document (Ownership Verified)".
  The backing field `Property.ownershipVerified` is written by **exactly one thing in the repository:
  the dev demo seed**. No setter, no service, no admin action. So the badge renders in demos and is
  unearnable in production — the most confident claim on the home page is the one with the least code
  behind it. Found by grepping the *field*, not the feature, while scoping unrelated product work.
  Generalisation: when a decision names a user-visible guarantee, grep for the field that backs it and
  check **who writes it**, not whether it exists. A column, a DTO field and a rendered badge can all
  be present and still be joined to nothing. `git grep 'setFoo\|foo ='` returning only the declaration
  is the tell.
- **Ask what a feature would need, then look — half of it is often already built and unwired.** Scoping
  the document gate turned up per-deal checklists (`RENT_CHECKLIST`, `BUY_CHECKLIST`), a
  `ReviewChecklistItem` entity with per-item state, and a wizard that already collects the right
  document per property type (7/12 Extract for land, Index II elsewhere). The work was mostly
  *connecting* those to the flag, not building them. Estimating before reading would have been wrong
  by a large multiple, in the expensive direction.

- **`networkidle` is not an app-readiness signal, and on a Vite app it is not even close.** Vite
  fetches the whole module graph and only *then* evaluates it, so the network goes quiet long before
  any application code runs. Measured on a real page load: last module fetched `+251ms`,
  `waitUntil: 'networkidle'` resolved `+839ms` **with the document still empty**, `main.jsx` executed
  `+1181ms`, first paint `+1702ms`. Roughly 900ms of "the page has settled" during which the page had
  done nothing at all.
- **A test suite can depend on a coincidence for years and call it a contract.** Those specs were
  never correct — they passed because the mock store was written *synchronously* during module
  evaluation, so a `page.evaluate` queued at idle could not execute until the main thread was free,
  which happened to be after the write. Moving the seed behind a dynamic `import()` put the write one
  hop the other side of that boundary. Nothing about the tests changed; the accident they rested on
  did. **When a change "inexplicably" breaks unrelated tests, look for the invariant they were
  relying on without stating.**
- **`JSON.parse(localStorage.getItem(KEY) || '{}')` in a read-modify-write is destructive, not
  defensive.** The empty fallback gets written straight back, replacing the entire seeded database
  with `{}` plus whatever field the caller set. It then fails several assertions later as something
  that reads like a product bug, with nothing pointing at the helper. 16 sites had this shape. A
  fallback is only safe on a **pure read**; the moment the parsed value flows back into `setItem`, it
  must throw instead. The same applies to `if (!db) return;` — it leaves a flag at its default and
  fails the test for the wrong reason, which is a worse debugging experience than a wipe.
- **Fix a timing bug with an explicit signal, not with waits sprinkled at the call sites.** The
  durable fix was one line of production code — `main.jsx` sets `data-pn-boot="ready"` once the seed
  *and* the one-shot migrations are done — plus one exported `appReady(page)` helper. The tempting
  cheap probe, `!!localStorage.getItem('puneNestDB_v5')`, was wrong for a reason worth remembering:
  the dev-only disk hydration writes that key **before** the migrations run, so it is true while the
  data is still stale. A readiness probe must test the thing you actually depend on, not the nearest
  observable proxy.
- **Re-running the full suite is what finds this class of bug; targeted runs never will.** Both this
  and the catalogue paging defect surfaced only because the whole suite was re-run rather than
  trusted. A green targeted run proves the thing you were looking at, and nothing else.
- **A lane that is told not to run the suite will not discover what it broke.** The edit-policy specs
  failed because a lane rewrote exactly the copy they assert, and had no way to notice. Copy is API
  to a test suite: changing a user-visible string is a breaking change, and the specs asserting it
  have to move in the same commit.
- **A stale dev server makes Playwright test the *previous* build, and the failures are
  indistinguishable from real defects.** `e2e/playwright.config.js` sets `reuseExistingServer: !CI`,
  so Playwright silently adopts whatever is already listening on 5173 — regardless of its age or the
  config it booted with. After a wave that added a PostCSS plugin, a four-hour-old Vite process
  served the pre-wave CSS and 14 specs failed. They were *confident* failures, screenshot-backed,
  naming real classes and real pixel values (`text-[10px]` on "Ops portal", `text-[11px]` on "Demo
  quick access") — every one an artifact. Killing the process took the run to 4 failed. **Pre-flight
  the port before every Playwright run** and kill anything older than the newest source edit:
  `Get-NetTCPConnection -LocalPort 5173 -State Listen | %{ Get-Process -Id $_.OwningProcess }`.
  `postcss.config.js`, `vite.config.js` and plugin modules are read **once at boot**; HMR never
  picks them up, so "I saved the file" is not evidence the server knows about it.
- **The lesson existing in memory did not stop it happening.** This exact hazard was already written
  down — as a tip in the middle of a long notes file — and it still cost two full suite runs. A rule
  that must fire *before an action* has to be at the top of the file, stated as a pre-flight step,
  not filed among explanations. Placement is part of the content.
- **A rate-limited or failed subagent may still have mutated the tree.** A lane that reports failure
  has not necessarily left nothing behind; it may have written half its files before stopping. Grep
  for the artefacts it was told to produce **before** retrying it, or the retry lands on top of a
  partial edit.
- **A test that fails because its readiness probe does not apply is a spec defect, but proving that
  requires proving the page actually renders.** `openListings()` waited for `a[href^="/property/"]`
  and was handed a `view=map` URL, where the page renders markers and mints no property anchors.
  Making the probe view-aware is the right fix — but only after confirming the map genuinely renders
  (the `mapSearch` flag is on, and `loc` parses to a non-empty locality set, or `mapGated` swaps in
  `MapGate` instead). Otherwise the "fix" is an assertion that can no longer go red.
- **A sweep that measures something the user cannot see has found a bug, not a false positive.** The
  extended tap-target sweep failed on a 275×40 "Log out" — apparently just an undersized control on
  `/dashboard`. The real defect was why it was reachable at all: the account drawer keeps its header
  and footer mounted so the panel holds its shape mid-transition, leaving live buttons focusable
  inside an `aria-hidden` subtree while it was closed. `pointer-events-none` stops a mouse, not the
  Tab key. The fix was `inert`, and the size was the symptom. **Ask why the element was in the
  sweep's reach before deciding the sweep is over-eager.**
- **State outlives the effect that set it, so effect cleanup must reset state, not just locals.**
  `usePullToRefresh` cleared `alive` and its timer on re-bind, and the in-flight `settle` correctly
  declined to touch a torn-down instance — which left `isRefreshing` true forever if `enabled` or
  `threshold` changed between `touchend` and `settle`. Closure locals die with the effect; `useState`
  does not. Anything the effect turned on, its cleanup has to be able to turn off.

- **Parallel lanes poison each other's mock e2e, and the failure looks like a product bug.** Vite's
  HMR channel broadcasts a full `page reload` to *every* connected browser page whenever a changed
  module cannot be hot-swapped — any `src/i18n/locales/**/*.json`, most `src/context/*.jsx`. Another
  lane saving a file mid-suite therefore remounts the page under a running test. In the rent-agreement
  wizard that meant `useFormDraft` replayed its last 400 ms-debounced autosave, the step just typed
  came back blank, `Next` silently refused, and the run fell over ten seconds later on a date field
  four helpers away — which is how it got filed in the register as a scroll/animation bug on the
  review checkbox. **Never run mock e2e while another lane edits `frontend/src/**`.**
- **`webServer.stdout: 'ignore'` throws away the log that names the cause.** Vite was announcing
  `page reload src/i18n/locales/hi/dashboard.json` with a timestamp the whole time; Playwright
  discarded it. To attribute a suspected reload: start Vite yourself with the log captured, set
  `BASE_URL` so Playwright reuses it (`reuseExistingServer`), then grep the log across the run window.
- **A restored-draft banner appearing mid-test is a remount, and a mount-only effect proves it.**
  `useFormDraft`'s restore effect has deps `[key]`, so *"We saved your progress"* cannot appear
  without a fresh mount. One glance at the failure screenshot settled a cause that static analysis of
  the wizard, the CSS and the Playwright config had not.
- **"Do not harden a test around a product defect" is right, and still requires proving it is one.**
  The register was emphatic that this was a product bug. It passed 15/15 in isolation, repeatedly —
  which is the first thing to try and the fastest thing that could have contradicted the row. What
  shipped is the opposite of hardening: assertions at the transitions (`clickNext` proves the step
  advanced, `submitFromReview` proves the request was created) with no retry, no re-fill and no
  loosened selector, so a genuine defect still fails — just at its own line instead of three helpers
  downstream. Both were mutation-tested; an assertion nobody has seen go red is decoration.
- **Helpers that share placeholders need postconditions.** The wizard's Property, Owner and Tenant
  panels all use `As per PAN/Aadhaar`, `ABCDE1234F`, `10-digit mobile`, so a step that failed to
  advance was invisible: the next helper simply typed tenant answers into the owner panel. Any
  navigation helper across near-identical screens should assert where it landed.
- **An untracked file plus an unexplained build break is not proof of scope creep — read `git log`
  before you delete anything.** Four agents ran in parallel on unrelated items; afterwards the pom
  had an AWS SDK block nobody's report mentioned and `provider/storage/` held two untracked classes.
  The offline build was failing. I concluded an agent had wandered and removed all of it — twice.
  It was a real, deliberate, already-committed feature (`aaf52fa`, Cloudflare R2 behind the
  `FileStorage` seam), authored between the agents being launched and their reports coming back.
  A single `git log -- <path>` would have said so in one second. **The rule: unexplained ≠ unwanted.
  Before removing anything you did not write, ask git who did.**
- **A build failure right after an agent wave is more likely pre-existing than agent-caused, because
  the agents were told not to build.** They never ran the compiler, so they had no way to introduce
  a *resolution* failure and no way to notice one. The netty artifacts were unresolvable offline
  because the exclusion that fixes it landed in a commit I had just reverted. Attribute a failure to
  the change that could plausibly cause it, not to the change that is merely newest.
- **When several actors edit the same tree, the working tree is not a diff of your own work.**
  `git status` after a parallel wave mixes agent edits, the human's commits and your own. Establish
  what HEAD is *first* (`git rev-parse HEAD`, `git status --porcelain -- <paths>`); a file that is
  clean in `git status` is already committed and is not yours to revert.
- **Restoring by hand what git can restore for you multiplies the damage.** Having removed the
  files, I then hand-edited `FileStorage.java` and `application.properties` to strip the references
  — inventing a third state that matched neither the commit nor my own change. If a removal turns
  out to be wrong, `git checkout <sha> -- <paths>` is the whole fix; hand-reconciling is only needed
  where two real changes genuinely overlap.
- **A repeatable migration that replaces a versioned one leaves an orphan history row that blocks
  every lower slot.** Flyway records `R__x.sql` by description; once applied, re-adding the `V__`
  form it replaced fails validation on an already-migrated database rather than simply running.
- **`cmd /c "… & echo EXIT=%errorlevel%"` always prints `0`.** `cmd` expands `%errorlevel%` while
  parsing the whole line, before the first command has run. Parse the tool's own log for its verdict.
- **A test-scope `application.properties` with the same filename *shadows* main — it does not merge
  with it.** So a production setting that is not repeated in `src/test/resources` is a setting the
  suite never exercises. I turned `spring.jpa.open-in-view` off in main, ran the suite, saw failures,
  flipped it back to `true` as a control, and got *identical* failures. The obvious reading was "not
  my change" and it was right — but for the wrong reason: neither run had the setting at all. The
  control experiment was sound and the conclusion was luck. **When a control shows no difference,
  first confirm the variable was actually applied**, or you have proved nothing and think you have
  proved something. The file even says this in its own header comment about page sizes; I read that
  comment and still did not generalise it.
- **A cache added for performance is a behaviour change, and read-after-write is the assertion it
  breaks.** D69's 30s analytics cache was landed with a focused unit test and green targeted runs;
  the full suite was not re-run, and it had in fact broken two `AdminMetricsEndpointsTest` cases that
  insert a row and re-read the chart. The trap on discovery is to weaken those assertions — but they
  exist to guard IST bucketing and the Monday-bucket bug, not cache timing, so weakening them would
  trade a real guarantee for a green tick. Right answer: make the TTL configurable and set it to `0`
  for the suite, keeping the caching itself proven by the unit test that builds the service directly.
- **"Targeted tests pass" is not "the suite passes", and the gap is exactly where cross-cutting
  changes hide.** Caches, transaction scope, filters and properties are global by nature; the tests
  they break are, by definition, the ones nobody thought were related. Any change to shared state
  earns a full-suite run before it is called done.
- **An in-process cache keyed by caller-supplied input is an unbounded map unless you cap it.**
  `seriesCache`'s key contained the request's date range, and expired entries were only evicted when
  that exact key was looked up again — which a caller walking `from` never does. Expiry is not
  eviction. Any staff account could have grown it for the life of the process.

## Playwright locators — four ways to assert nothing (debt wave 9)

Each of these produced a *passing-looking* or intermittently-failing spec that was not testing what
it claimed. All four were found in one afternoon on two new ops specs.

- **`getByText('X')` is a case-insensitive *substring* match.** `getByText('PAN')` matched the
  seeded owner **"Rahul Desh*pan*de"**, so an assertion about the identity panel was being decided
  by a name in a summary field. Use `{ exact: true }` for a label; it is case-sensitive and
  whole-string. (`getByRole('term', { name })` is *not* the alternative — `term` takes its
  accessible name from the author, not from its `<dt>` content, so it matches nothing at all.)
- **An unanchored regex finds its pattern inside an id.** `/[6-9]\d{9}/` for "a mobile leaked"
  matches inside `SR178634283919842`. A leak assertion that fires on every id gets loosened until it
  protects nothing — anchor it: `/(?<!\d)(?:\+91[\s-]?)?[6-9]\d{9}(?!\d)/`.
- **`page.addInitScript` re-runs on *every* navigation for the life of the page.** `helpers/seed.js`
  uses it, so a spec that signs in as a consumer and later as staff has the consumer session
  silently written back over the staff one on the next `goto`, landing on `/staff-login`. To seed a
  session once, `page.evaluate` after load and `reload()`.
- **`page.goto` resolving does not mean a `lazy()` route's mount effect has run.** The drafting desk
  read an empty queue because the seeding effect lives on a *different* lazy page whose chunk had
  not arrived. Wait on the observable side effect (`waitForFunction` on the storage key), never on a
  paint.
- **`components/ui/Table.jsx` renders its empty message twice** (mobile card + desktop `<td>`), so an
  unscoped empty-state assertion always violates strict mode. Scope it: `getByRole('table').getByText(…)`.
- **A console-error guard is worth more than the assertion it sits under.** The one genuine defect
  this session — `serviceFlow.create` minting ids as `Date.now() + random(0..99)`, which collide
  whenever two requests are created in the same millisecond — was invisible to every DOM assertion
  and surfaced only as React's duplicate-key warning. Duplicate keys mean a row can be dropped or
  updated in the wrong place, on a queue holding identity documents.

## Paid rent-agreement security pass (this session)

- **Grep whether a pattern is platform-wide before you "fix" one instance.** The review flagged
  the gateway order being opened inside a rollback-able transaction in the rent-agreement path.
  One grep showed all four payment paths do it. Fixing the one under review would have produced
  an inconsistency — three sites with the old shape and one with a new one, and nothing to tell a
  future reader which is intentional — without closing the hole. It went to the register as a
  single item naming all four call sites.
- **A free-text field that another component matches *exactly* is an unenforced enum.** The server
  priced by `"rent-agreement".equals(type)`, so the payment gate was opt-in by spelling: `rental`
  or `Rent-Agreement` bought the desk for free. The frontend had an alias mapping to paper over it,
  with a comment explaining the danger — which is documentation of a hole, not a control, because
  it only protects call sites that remember to go through it. Close the vocabulary at the boundary
  that consumes it (allowlist + DB CHECK + contract `enum`), not at the caller that produces it.
- **"Round-trip the form state so the other party can resume" is a data-exfiltration path.** The
  wizard put its whole state into `details` so an invited tenant could continue filling it. That
  field is plaintext `jsonb` echoed verbatim on every read — including the paged ops queue — so the
  convenience feature quietly made page one of a staff screen a bulk PAN/Aadhaar dump. Ask *who
  else reads this field* before deciding what to put in it; "the tenant needs it" and "every staff
  account gets it" were the same decision.
- **A test-only vocabulary hides a contract gap.** The suite raised requests of type
  `legal-opinion`; no such desk exists in the product (it is `legal`). Nothing failed because the
  field was free text, so the tests were exercising a value no user could produce, and the closed
  vocabulary is what surfaced it. If a fixture invents a value, either the value is real and belongs
  in the code, or the field is under-specified.
- **Fan-out over independent handlers must be independent.** The webhook asked each settle handler
  in turn; the first to throw skipped the rest, and a short-circuiting `||` meant "nobody claimed
  this order" was indistinguishable from "the first handler claimed it". Both bugs are invisible
  until the day they matter — a paid order silently dropped. Give each handler its own `try`, and
  make "claimed" a value you can actually read.
- **Redacting a field changes who can pass validation.** Blanking the owner's PAN and Aadhaar out
  of the shared `_state` dead-ended the invited tenant: the wizard validated the Owner step on
  `Next`, that step is read-only for the invitee, and the numbers it demanded were the ones we had
  just removed. The privacy fix was right; what was wrong — and had been all along — was gating an
  actor on a step they cannot type into. Whenever a security change empties a field, ask what reads
  it, not just what writes it. E2E caught this and the unit tests could not: it needed two actors
  and a round trip.
- **Two correct fixes can be wrong together.** The same pass taught the client to blank the identity
  numbers out of `details._state` and taught the server to refuse identity keys in `details`. Each
  was right, each was tested, and together they would have 400'd every rent-agreement submission in
  production: the client kept the keys and emptied the values, and the server banned the keys. The
  gap is structural, not careless — a client test stubs the server and a server test hand-writes the
  payload, so neither ever sees the other's actual output. When one change alters what is sent and
  another alters what is accepted, the only test that means anything is one that carries a real
  payload across the boundary. `rejectIdentityNumbers` now refuses only *populated* fields, and
  `ServiceRequestFlowTest` posts the exact shape the wizard emits.
- **A validator should ban the thing, not the spelling of the thing.** The identity-key check started
  as an exact-match set, which stopped `pan` and `aadhaar` and waved through `panNo`, `pan_number`
  and `tenantPan` — and its whole purpose is to be a backstop for a redaction some future call site
  forgets, which is precisely the call site likely to name its fields differently. It now normalises
  case and separators and matches a substring. The same reasoning had already been applied one layer
  up, where free-text `type` let `Rent-Agreement` skip the payment gate; the lesson did not transfer
  the first time because the two looked like different problems.
- **A rule that must be remembered is a rule that will be forgotten.** D2 sat open for months partly
  because the obvious shape — annotate the endpoints that need limiting — is the shape that fails
  silently: it works on every endpoint someone remembered, and the one they didn't is the one an
  attacker finds. Defaulting to *limit all writes* and listing the handful of exemptions inverts
  that: forgetting now produces a limit where none was wanted, which someone notices immediately,
  instead of no limit where one was needed, which nobody notices at all.
- **Two register items that "share one fix" may not.** D2 and D73 were paired for months on the
  reasoning that a principal-keyed counter answers both. Building D2 showed it cannot: D73's counters
  have to be atomic *with the insert they guard*, which is a database concern, not a request-level
  one. The pairing was plausible and wrong, and it had the effect of making the cheaper of the two
  look as expensive as the harder — so both waited.
- **Shared state in a test class does not roll back.** `@Transactional` rolls the database back
  between test methods, which quietly trains you to expect isolation. A filter holding a counter is
  one object in a context cached across the class, so the first version of the rate-limit test passed
  or failed depending on how many requests the *previously executed* method had made — a dependency
  on JUnit's ordering that would have gone red the day a test was inserted above it. Giving each
  method its own caller key fixed it and exercised the keying at the same time.
- **A test failure inside a new feature is not necessarily about the feature.** The rate-limit tests
  failed to start with `FATAL: sorry, too many clients already`. Nothing to do with rate limiting:
  Spring caches one context per distinct set of property overrides and each carries its own
  connection pool, so *adding a test class with new `@SpringBootTest(properties = …)`* is what
  exhausted Postgres. The suite had been one class away from this for a while and the cost would have
  landed on whoever added the next one.
- **If you match on a string, match the same string the framework matched on.** Three of the four
  bypasses the review found in the rate limiter were one bug: the filter compared a value the
  dispatcher had already transformed. The raw URI was not the decoded path Spring routes on, so
  `/documents/share%64` slipped past a rule written for `/documents/shared`. `getRemoteAddr()` was not
  the client's address once a proxy sat in front. And `"GET".equals(method)` was not the set of
  methods that reach a `@GetMapping` handler, because `HEAD` does and merely loses its body. Any
  filter that decides using a *copy* of the routing input has to derive that copy the same way, or
  the two drift and the gap is the vulnerability.
- **A safety limit that fails open is not a safety limit.** The limiter's map was bounded by refusing
  to track new keys past a ceiling — which meant a flood large enough to hit the ceiling disabled the
  limiter for everyone who arrived after it, while the flood's own traffic held it there. The
  protection switched off precisely when it was needed and rewarded exactly the caller it existed to
  stop. Bound by *eviction*, not by admission: the same cap, but enforcement never stops. Doing so
  also deleted an O(n) sweep on the request thread and a lookup-then-lock race, which is usually the
  sign the original design was carrying complexity to defend a bad decision.
- **Two knobs, two silent failures, opposite directions.** `window-seconds=0` makes every request
  start a fresh window, so nothing is ever limited and the service looks perfectly healthy;
  `writes-per-window=0` refuses every write on the platform. Neither announces itself. Configuration
  that can be wrong in a way the running system does not reveal should be rejected at construction,
  not clamped into something plausible.
- **A security control written as configuration is as reliable as the sloppiest way that
  configuration can go missing.** The proxy fix started as two `server.*` lines in the prod profile
  and had two silent failure modes: a staging deploy or a mistyped `SPRING_PROFILES_ACTIVE` never
  loads that file at all, and Boot's `@ConfigurationProperties` binder resolves placeholders with
  `ignoreUnresolvablePlaceholders`, so an unset variable binds the literal `${INTERNAL_PROXIES}`
  instead of failing — while the commonest case of all, a declared-but-empty variable, makes Tomcat
  trust nothing and log nothing. Owning the property in application code, reading it through
  `@Value` (which does throw), putting it in the *base* file so every profile has an answer, and
  validating it before the server starts turns four silent failures into one loud one. The test suite
  refusing to boot until it declared its own topology was the proof, not an inconvenience.
- **If a wrong answer is still possible, detect it from traffic.** The topology can be declared
  honestly and still be wrong. A request arriving with `X-Forwarded-For` while the config says
  nothing is in front is direct evidence of the misconfiguration, so the filter logs it once. A
  control that can be silently wrong should be made to say so out of its own operation, not left to
  be noticed during an incident.
- **An exemption is not the same as a higher budget, and the difference is the whole safety margin.**
  The payment webhook was exempted from rate limiting because refusing a genuine callback loses a
  customer's money. Correct reasoning, wrong mechanism: it made the one `permitAll` write on the
  platform completely unthrottled. Its own budget at fifty times the ordinary one satisfies the same
  requirement and still bounds a flood. The related lesson is that "authenticated by HMAC" is not
  "free to reject": the body is buffered and materialised before the signature is checked, and
  nothing in this stack bounds a JSON body at all.
- **"Greater than the limit" is not the same test as "within the limit".** The callback body cap
  asked whether `getContentLengthLong()` *exceeded* 64 KB. An unknown length reports as `-1`, which
  exceeds nothing — so `Transfer-Encoding: chunked` streamed an unbounded body through an
  unauthenticated route in one request. Any bound read from a caller-supplied measurement has three
  cases, not two, and the third is the one an attacker picks. Refuse the unknown case rather than
  ranging over it.
- **Normalise in the same order the framework does, not merely with the same operations.** The path
  helper stripped `;` parameters and then decoded; Spring decodes and then strips. Same two steps,
  opposite order, and `%3B` walks through the gap — carrying with it the callback body cap, which
  only applies to paths that matched. Getting the steps right is not enough; the sequence is part of
  the comparison.
- **Three review rounds on one small filter, and every finding but one was the same mistake.** Not
  the rate-limiting arithmetic — that was right the first time. It was always a mismatch between the
  string the security code compared and the string the framework acted on: the client address, the
  request path, the HTTP method, the percent-encoding, the declared body length. When writing a
  control that inspects a request, the question to keep asking is not "is this rule correct?" but
  "is this the same value the thing downstream will use?"

## Documents consumer flip (Slice D)

- **Re-verify a blocker before you build for it.** D124 listed "the probe user has no seeded
  owned property" as the reason the flip was unverifiable. The probe owner already owned four
  seeded listings. One `grep` of the seed replaced a migration that was about to be written.
  A blocker written down months ago is a claim, not a fact — same class of error as the
  register's file counts.
- **`.catch(() => setState([]))` is a product decision disguised as error handling.** Flipping
  three synchronous reads to async made every failure look like emptiness: a failed request
  inbox renders as "no buyer requests" (the card is gated on `length > 0`), a failed vault
  read renders a confident `0/10` loan checklist. Neither shows an error. When converting a
  synchronous read, decide what a *failure* should look like before deciding what the
  loading state looks like — "empty" is almost never the honest answer.
- **A guard for one mode can be a data-loss bug in the other.** Skipping the fetch for the
  `portfolio` pseudo-bucket is right in http mode (the GET 404s) and wrong in mock mode,
  where that bucket is real storage and the *write* path still targets it: the upload
  succeeded, the read was skipped, and the user got a green "uploaded" toast next to an empty
  tile. If you guard a read, guard the matching write — or gate the guard on the mode.
- **A live test that writes to the shared dev DB must clear its own slot first.** An assertion
  failing between upload and delete left a real row behind, so every later run failed on a
  full slot — a green test turned permanently red by its own debris. Clean at the start, not
  only at the end; the end never runs when it matters.
- **Confirm the stash before trusting the baseline.** `git stash push -- <tracked> <untracked>`
  aborts wholesale on the untracked pathspec, so the "at HEAD" run still contained the change
  and cheerfully reported "it fails at HEAD too". Check `git stash list` after pushing, or the
  comparison that clears your change is worthless.
- **The flakiness you expose was usually already there.** Making the vault load async
  destabilised a tooltip spec — but the same spec failed 6/6 at HEAD under the same load. The
  real defect was in the test (`Tip` closes on scroll, and the tap that scrolled the anchor
  into view dismissed its own tooltip). Widening a race is not the same as causing it; measure
  the baseline under the *same* load before rewriting product code to appease a test.

## Deals sub-slice A2

- **`Map.of()` rejects null keys** — `ImmutableCollections$MapN.get(null)` throws NPE.
  When batch-loading counterparty users, guard `get()` with a null check on the key before
  passing it to the immutable map. Java's unmodifiable Map implementations are not null-safe.

- **JPA `save()` does not flush** — in `@Transactional` tests, a JDBC query in the same
  transaction won't see unflushed JPA writes. Use `saveAndFlush()` when the next assertion
  uses raw JDBC to verify side effects (e.g., soft-delete `deleted_at IS NOT NULL`).

<!-- above: feature/backend-integration | below: feature/ui-mobile-improvements -->

## Mobile-first audit + Phase 1 (this session)
- **Measure before rating effort.** Two items the audit called "S" were wrong once the
  import graph was traced: `db.json` can't be dynamically imported without making the
  whole mock layer async (`rawLoad()` is sync, called everywhere), and `societies-rera.js`
  is on the critical path via Home's societies rail. A doc that hasn't opened the call
  sites is guessing at cost.
- **Raw KB != wire KB.** The stylesheet is 209 KB raw but **37.9 KB gzipped**; the review's
  "save 60-100 KB" for a CSS split was really ~10-20. Always quote gzip for perf claims.
- **Budget gates must read the document, not guess filenames.** `index-*.js` matched both
  the entry chunk AND an unrelated vendor chunk. Parsing `dist/index.html` for
  `<script type=module>` + modulepreload + stylesheet is exact and needs no upkeep when
  chunking changes. Also: fail loudly if 0 assets match — a gate reporting 0 KB looks green
  while waving through every regression.
- **The StrictMode double-invoke trap is real and repeats.** A per-visit counter in an
  effect spent its entire 2-view budget on one load. `design-system.md` already documented
  this for InstallPrompt; the same fix (ref guard) was needed for the Nestor nudge. Any new
  "show N times" counter needs it.
- **`scrollIntoViewIfNeeded` stops at the viewport rect**, which includes the strip behind
  a sticky bar — so it parks the element under exactly the chrome you're testing for. Scroll
  to a reading position (`top - 160`) instead.
- **`elementFromPoint` returns null off-screen.** Returning "nothing is covering it" for an
  element that isn't on screen is a pass for the wrong reason. Return OFFSCREEN explicitly.
- **A/B a red test against `git stash` before claiming "pre-existing".** The 2 `help-i18n-urls`
  failures reproduced with all source changes stashed -> genuinely not mine. Cheap and
  conclusive; asserting it without the experiment is just hoping.
- **Not every audit finding is a bug.** Sign-in/sign-up "sub-44px checkboxes" were false
  positives — the *labels* carry `.tap-target` and clicking a label toggles its control, so
  the label is the touch target. Only `/contact` genuinely lacked it. Measure the thing the
  finger actually hits.
- **Some findings are product decisions, not defects.** The property price sits at y=551 on
  a 360x640 screen; lifting it above the fold means shrinking the hero gallery on a property
  site. Raised it, didn't silently decide it — and made the test assert the unconditional
  invariant instead (no *fixed* overlay on the price; scrolling under a sticky bar is fine).

## PMF overlay session
- **Temporary/experimental overlays must be flag-gated so the dev flow is never touched.**
  `VITE_PMF_MODE` off by default; every hook (`track`, `captureLead`, banner, NotifyMe) no-ops
  unless the flag is exactly `on`. Verified by building both flag-off and flag-on.
- **When a `create` fails because the parent dir is missing, RE-CREATE the file after `mkdir`.**
  The first `PreviewBanner.jsx` create failed; I made the dir but forgot to retry it, so only the
  build caught the missing import. Always re-run the failed create, or verify with a dir listing.
- **Netlify Forms + client-rendered SPA:** the deploy bot can't see a JSX `<form>`. Declare a hidden
  static form (with all field names) in `index.html`; the app POSTs url-encoded with `form-name`.
- **`index.html` has a strict CSP** — any new third-party (GA4) needs script-src/connect-src widened.

## API design source-of-truth (this session)
- **Single source of truth for the API = the OpenAPI spec**
  (`backend/src/main/resources/static/openapi/punenest-api.yaml`). Do NOT re-describe endpoints,
  request/response JSON, error shapes, pagination wrappers, or role enums in other docs. Other docs
  may only *reference* the spec. `docs/system/api-contract.md` is now a pointer stub, not a catalogue.
- **Canonical auth roles = `buyer, owner, staff, admin`.** `staff` is scoped by `team[]`
  (`rental, legal, interior, packers, valuation`). Admin RBAC `manager/member` are permissions, not
  roles. `tenant` folds into `buyer`. Keep this consistent everywhere.
- Non-auth classification enums legitimately use other tokens: moderation `targetType` includes
  `user`; content `audience` includes `tenant`. These are NOT the auth `Role` enum - leave intact.

## OpenAPI as spec — extension gotchas (this session)
- **YAML 1.1 `off`/`on`/`yes`/`no` are booleans.** An unquoted enum value like
  `enum: [off, instant, daily, weekly]` parses `off` as boolean `false`. Always quote such literal
  string tokens: `enum: ["off", instant, daily, weekly]`. (Was a live bug in `SavedSearch`.)
- Fast feedback loop for a large spec = a tiny PyYAML validator that resolves every `$ref` and prints
  paths/schemas/refs/unresolved + unused-schema counts. Run after every edit batch; expect
  unresolved==0 and no unused schemas.
- Before retiring a data doc in favour of OpenAPI, remember **persistence-only truth is not
  expressible in an API contract** (soft-delete columns, ID-prefix scheme, key-migration, Flyway/
  JSONB, DB reconciliations). Those belong in a data-model ADR, not the spec — so a domain-model doc
  can only be *slimmed to DB-only concerns*, never fully deleted, unless that content is relocated.

## Auth+users vertical slice (this session)
- **pom.xml "manual sync" silently reverted to the committed minimal pom** — dropped
  `spring-boot-starter-data-jpa`, `-security`, `postgresql`, `flyway-core`,
  `flyway-database-postgresql`, and the JJWT trio, and reset `java.version` to 21. The failure was
  *masked* for a while because `target/` still held classes compiled against the fuller pom. Lesson:
  when a from-scratch compile suddenly reports "package X does not exist" for whole dependency groups,
  check the CURRENT pom against git, don't chase the code. Restore deps (BOM-managed ⇒ no version;
  JJWT 0.12.6 pinned) and rebuild.
- **`@Transactional` + `throw RuntimeException` silently discards side effects in prod.**
  `OtpService.verifyLoginCode` recorded a failed attempt then threw → default rollback-on-runtime undid
  the counter, so the brute-force cap NEVER fired in production (each HTTP request is its own tx). The
  `@Transactional`(rollback) test masked it because @SpringBootTest shares ONE persistence context, so
  the in-memory increments accumulated regardless. Fix: `@Transactional(noRollbackFor = {…})` on BOTH
  the inner method AND the outer caller that owns the physical tx (rollback is decided at the outermost
  boundary). Treat expected client errors as non-rollbacking when they must persist an attempt/audit.
- **Interrupted/`stop_powershell`-killed Maven builds corrupt `target/classes`.** The incremental
  compiler then KEEPS the half-written `.class` (its mtime is newer than the unchanged `.java`), so a
  later build fails with "cannot find symbol" for record accessors/interface methods that plainly exist
  in source (`ApiError.error()`, `PageResponse.content()`, `saveAndFlush`). Fix: delete
  `target\classes` + `target\test-classes` and recompile. Don't debug the source — it's fine.
- **Offline (`-o`) + `clean` can't rebuild the full dependency classpath in this env** (whole groups
  report "does not exist"); a from-scratch compile must run ONLINE. `-o` is only safe for incremental
  builds where `target/` is already populated.
- **Boot 4 test quirk (still true): `@Autowired ObjectMapper` has no bean** — use
  `new ObjectMapper()` in the test. Also `@JsonInclude(NON_NULL)` means an auto-provisioned buyer's
  null `name` is ABSENT from JSON, so assert `has("name")` is false / don't require it.
- Toolchain now: **Java 25 on Zulu-25** (`JAVA_HOME=C:\Program Files\Zulu\zulu-25`); the older
  "Java 21 / JDK 17 gap" note above is obsolete.

## Environment / tooling
- Backend targets **Java 21** (Spring Boot 4.1.0) but the dev machine has **JDK 17**, so
  `mvn verify` fails with `release version 21 not supported`. This is a pre-existing toolchain gap,
  independent of doc/spec changes. Need a JDK 21+ install to compile the backend here.

## Windows / PowerShell + edit-tool gotchas
- Several docs contain UTF-8 em-dashes/arrows that render as `?` in view/grep. The `edit` tool
  matches raw bytes, so `old_str` must be **ASCII-only** - target ASCII substrings and avoid the
  special chars. For whole-line rewrites that include them, use a PowerShell regex replace with `.*`.
- PowerShell here: no `&&`/`||` (chain with `;`); heredocs don't work (write a `.py` file and run it);
  `Get-ChildItem -Filter` takes a single string (use `-Include` with `-Recurse` for multiple globs).
- Concurrent `edit` calls to the *same* file in one turn can hit `EBUSY: resource busy or locked` -
  retry the failed edit on the next turn.
- **Never put a non-ASCII char in a `.ps1`.** PowerShell 5.1 reads scripts as ANSI unless the file
  has a UTF-8 BOM, so a UTF-8 em-dash decodes to `a^~"` - and that trailing byte is U+201D, which
  PowerShell honours as a real string delimiter. One em-dash inside a `Write-Warning "..."` closed
  the string early and surfaced as a bogus "string is missing the terminator" **11 lines later**,
  plus a phantom "Missing closing '}'". The reported line is not the broken line. Keep `.ps1`
  ASCII-only; verify with
  `Select-String -Path x.ps1 -Pattern '[^\x00-\x7F]'` and statically parse before trusting a script:
  `[System.Management.Automation.Language.Parser]::ParseFile($p,[ref]$t,[ref]$e)` then check `$e`.
- `mvnw.cmd` lives in `backend/`, not the repo root; `.\run-local.ps1 -Port 8099` is the intended
  local entry point (pins Zulu 25, loads the git-ignored `.env.local`, then runs `spring-boot:run`).
- **Backend verification has two false-green traps. Both bit on D59:**
  1. `get_errors` on a `.java` file reports the **IDE language server's** view, which lags behind
     disk. It said "No errors found" on four files that could not compile (missing `java.time.Instant`
     import). Never accept `get_errors` as proof for backend Java - compile.
  2. `mvnw.cmd compile` without `clean` is frequently a **no-op**, so it exits 0 while MapStruct
     never regenerates. A record gaining a component therefore looks fine until a real build.
     Use `clean compile` when a DTO/record/entity shape changed.
  Also: the CLI build writes to **`backend/target-cli/`**, while `backend/target/` is the IDE's own
  (often months-stale) output. Always inspect generated sources under `target-cli/`; reading
  `target/` shows a mapper that predates the current contract.


## Platform architecture (free-tier-first) lessons

- Cloud Run scales to zero: native @Scheduled cron is unreliable (skips at zero, double-fires when
  scaled out). Use an external trigger (Cloud Scheduler -> secured endpoint); a warming ping keeps one
  instance warm at ~$0 because default Cloud Run billing charges CPU only during requests.
- "Deferring Redis" is not "deferring caching": CDN + Postgres cache-at-write + in-process Caffeine
  still cache at MVP. Redis only adds a shared-across-instances cache + distributed rate limiting.
- Aadhaar OTP e-KYC is legally restricted to licensed AUA/KUA; a startup cannot call UIDAI directly.
  Use a licensed aggregator (OKYC/OTP) or DigiLocker. Aggregator preserves the inline-OTP UI.
- Safest SPA session model = tokens in httpOnly+Secure+SameSite cookies (JS can never read them),
  short access JWT + rotating refresh with reuse-detection + CSRF; locally feasible via a Vite proxy
  that makes SPA+API same-origin. Only the frontend `http` provider changes; components untouched.
- Provider-seam pattern makes vendor/timeline risk cheap: build gate/flows against a mock now, pick or
  swap the real provider later (KYC, SMS, payments, storage) with no caller changes.

## KYC / identity uniqueness lessons

- Don't conflate the two OTPs: the LOGIN OTP proves control of the registration SIM; the AADHAAR OKYC
  OTP proves a genuine, unique identity. The registration mobile is secured by our own login OTP, not by
  Aadhaar. So not matching the two mobiles does not open a spam hole.
- There is no legal "phone number -> Aadhaar identity" lookup. KYC data is released ONLY on the holder's
  Aadhaar/VID + OTP consent; the OTP is the trust anchor.
- Never store the raw Aadhaar number. Use the aggregator's entity-scoped UID token (stable, irreversible,
  unique per Aadhaar per business) as the UNIQUE dedup key -> "one Aadhaar = one account" compliantly.
- Mobile-match (registration == Aadhaar-linked) is exclusion-heavy in India (stale Aadhaar mobiles).
  Layer a hard match only where fraud hurts (owners posting listings); soft-flag elsewhere.

## Payment gateway (India) lessons

- Payment gateways have NO "free tier" like SaaS; the right lens is ₹0 fixed cost + free sandbox +
  pay-per-successful-transaction. You pay only when a customer pays -> already fits $0-until-revenue.
- Zero-MDR != free UPI. Govt mandates 0% MDR on UPI/RuPay (the network cost), but an aggregator's own
  service fee is separate and still applies -> UPI through Razorpay is usually NOT free.
- GPay/PhonePe are payer-side UPI apps, not merchant plug-ins. Merchant accepts "UPI"; any app can pay.
- Genuinely-free UPI = direct collection (VPA/QR/deep-link via a PSP), but you trade fees for building
  reconciliation + verification yourself (often no webhooks, UPI-only). At MVP volume, paying the tiny
  aggregator fee beats building that. The PaymentClient seam lets us add UPI-direct later with no caller change.
## Cashfree / KYC architecture lessons
- Cashfree has NO standalone Aadhaar-OTP OKYC product; Aadhaar identity = DigiLocker flow only (verify-account -> create-url -> redirect+OTP+consent -> webhook -> get-document). Status is webhook-only; there is no GET /status endpoint.
- The DigiLocker SUCCESS *webhook* payload includes `mobile` even though the synchronous Get-Document response does not. Always check webhook payloads separately from sync responses before declaring a field unavailable.
- DigiLocker returns only masked UID (last-4) + per-request ids (not per-identity), so raw-Aadhaar dedup is impossible. Use a deterministic composite identity_hash on canonical UIDAI fields instead.
- Cloud Run has dynamic egress IPs -> Cashfree Secure ID/Payouts prod 2FA must use RSA public-key signature, not IP-whitelisting. (PG API itself needs only client-id/secret + domain whitelist.)
- The installed cashfree-skills bundle contains NO pricing; the settlements skill numbers are illustrative. Always flag pricing as "verify on dashboard/quote".
- Skill local policy: do NOT run the npx telemetry/start-integration or send data to Cashfree without explicit consent; treat as no-ops. Architecture/doc analysis does not trigger the App-ID ask.
## Docs discipline + build sequencing (badge-not-gate)
- `docs/flows/**` are "documented from React source" - they describe CURRENT UI behaviour, not target. Do NOT edit them to a new model before the React app implements it (creates false doc/code drift). `platform-architecture.md` is the SoT for the TARGET; re-sync flow docs FROM source only AFTER the UI changes. (Reverted 4 flow-doc rewrites for this reason.)
- Ratified build order once architecture is frozen: (1) update the contract (OpenAPI / api-contract.md) to badge-not-gate; (2) change the React UI against the MOCK provider and validate the UX/conversion bet (cheap, no infra, runs Phase-0); (3) build backend vertical slices to the frozen contract, flip VITE_API_MODE mock->http per slice. UI-first because the pivot is a UX/conversion change and badge-not-gate backend is LESS work than the old hard-gate (nothing wasted).
## e2e / encoding lessons (badge-not-gate migration)
- Playwright text matchers are byte-exact: a mojibaked non-ASCII char in a spec (e.g. rupee saved as UTF-8-then-Windows-1252 double-encoding => U+00E2 U+201A U+00B9) NEVER matches the correct live UI text, surfacing as a generic 20s waitFor timeout that LOOKS like a broken map/component. Always check the failure screenshot (the marker WAS visible) before assuming an app regression.
- Diagnose mojibake by dumping char codepoints of the assertion string, not by eyeballing (terminal/editor re-mangle it). Fix by String.Replace(mojibake, realChar) and write UTF-8 preserving the original BOM state.
- Scope discipline: only mojibake inside assertion strings (hasText/getByText/getByRole name) breaks tests; the same corruption in comments/titles is cosmetic. Flag pre-existing non-scope failures instead of chasing them.
## e2e full-suite lessons (badge-not-gate, cont.)
- Playwright `locator.count()` is a NON-retrying snapshot (unlike toBeVisible). If data loads async, count() can read 0 before render. Always `await expect(rows.first()).toBeVisible()` THEN count().
- The mock app stores its whole DB under one localStorage key (puneNestDB_v5) and `rawLoad()` uses a stored value AS-IS with NO merge to defaults. So writing a PARTIAL DB via addInitScript BEFORE boot => app runs on an incomplete DB => white-screen crash. Seed extra rows AFTER the app boots (page.evaluate: read full DB, unshift, save), or only seed non-DB keys pre-boot.
- The DPDPA CookieConsent banner (fixed bottom-0 z-[1400], inner card pointer-events-auto) intercepts clicks on bottom-anchored targets and drives the assistant FAB max-sm:hidden. ~30 specs seed pn_cookie_consent_v1 to dismiss it; any new bottom-click/mobile-FAB test must too.
- Responsive dual-render is pervasive: mobile card (sm:hidden) + desktop table (hidden sm:block). On desktop, scope assertions to the VISIBLE copy (getByRole('table'), [title=...]:visible, or .first() only when both copies are visible) to avoid strict-mode / hidden-first timeouts.
- When UI is refactored, roles change: dashboard sub-tabs went button -> role="tab". Match the CURRENT role, don't assume `button`.
- Before "fixing" a red test, open the failure screenshot: if the app clearly rendered the expected data, the fault is the selector/setup, not the app. Two full runs yielding DIFFERENT hard-fail sets == load-contention flakes, not deterministic bugs.


## 3-way sync session (SOT/OpenAPI/React)
- **Same-file parallel `edit` calls -> EBUSY in this env.** Apply edits to the same file
  one-per-turn (sequential), or use PowerShell literal `.Replace()` with match-count asserts
  for multi-occurrence changes.
- **Deal rename ordering:** rename intent `Deal->DealIntent` refs BEFORE aggregate `Deal2->Deal`,
  else collision. `#/.../Deal'` (trailing quote) does NOT match `Deal2'` - safe literal replace.
- **React is mock-only (no http provider).** "UI<->Swagger sync" = aligning enum/shape tokens so a
  future http seam drops in cleanly; status tokens live in localStorage and never serialize yet.
  Some domains (ops/ticket) keep a simpler UI vocab; mapping is documented in data-model.md.
- **SOT delegates wire shapes to OpenAPI** (names it "SSOT for wire shapes"), so most enum fixes
  land in OpenAPI + React; the main SOT doc needed no edits.
- **Working tree was already dirty** from prior sessions; always scope-check failures against
  `git diff --name-only` before assuming a test failure is yours.

## Package restructure + data-loss recovery (this session)
- **Backend source is entirely UNTRACKED in git**, so `git mv` fails on it and a follow-up
  `Remove-Item -Recurse -Force` in the same "move" script DELETED 22 source files with no git copy.
  Recovery: VS Code **Local History** (`%APPDATA%\Code\User\History\<hash>\entries.json` maps a
  `resource` file-URI -> timestamped backups; pick the max-timestamp entry per file). Lesson: never
  pair a bulk move with a force-delete on untracked trees; and `git mv` presupposes tracked files.
- **Local History can PREDATE your most recent edits.** The restored snapshot was behind by 3
  reviewed-and-shipped security fixes; `tasks/todo.md` (which recorded them as DONE) was the proof they
  had existed. Lesson: after any Local-History restore, diff the recovered code against todo.md-
  documented "done" work and re-apply anything the snapshot missed - don't assume the newest backup is current.
- **Version-skew from Local History** = restored files come from different save moments, so accessors/
  signatures disagree (e.g. a private `revokeFamily` vs a caller needing public `revokeAllForUser`; a
  static factory `otpSent()` colliding with a record accessor). Reconcile by compiling, not by eyeballing.

## Concurrency: durable cap != race-safe cap (this session)
- Fix C (`@Transactional(noRollbackFor=...)`) made the OTP attempt cap durable ACROSS sequential
  transactions, but two CONCURRENT verifies could still both read `attempts=4` and both pass under
  READ COMMITTED. The complete guard needs BOTH: `noRollbackFor` (cross-tx durability) AND
  `@Lock(PESSIMISTIC_WRITE)` on the finder (serialize same-row concurrency). Same pattern fixed the
  refresh-token double-submit replay window. `@Lock` on a Spring Data derived query needs the call to
  run inside a `@Transactional` method (it does). Chose pessimistic lock over `@Version`/optimistic
  because the latter needs a schema column + migration; the lock is one annotation, no DDL (ponytail).

## Properties+search slice (build/env)
- **Incremental mvn test corrupts arget/classes in this env.** javac/ECJ bakes error-recovery
  stubs into class files: "java.lang.Object cannot be resolved / indirectly referenced from required
  .class files", "@interface CurrentUser cannot be converted to Annotation", "BigDecimal cannot be
  converted to BigDecimal", "cannot access Long/UUID". A GREEN mvn test can flip to ALL-errors
  (context-load failures on every test) after a single-line edit triggers an incremental recompile.
  SUPERSEDED (slice 3) = the root cause was CLI Maven and the VS Code Java language server sharing one target\ directory and overwriting each other's class files. backend\.mvn\maven.config now sets -DbuildDirName=target-cli, so CLI artifacts land in target-cli and target belongs to the IDE. Do NOT reach for clean as a workaround; just use the configured layout. Original (now unnecessary) advice was: ALWAYS mvn clean test for a verifying run; deleting only
  target\classes+target\test-classes is not always enough - use clean.
- **All-tests-errored (not failed) + first error is a bean/context init** => it's an infra/compile
  corruption, not a logic bug. Read a surefire-reports\*.txt for the real Caused by (the console
  CONDITIONS EVALUATION REPORT buries it); "Unresolved compilation problems" there == stale target.
- **JSONB List<String> via @JdbcTypeCode(SqlTypes.JSON) validates clean under ddl-auto=validate**
  against a jsonb DEFAULT '[]' column (Hibernate 6 / Boot 4) - no hypersistence-utils needed.
- **Pageable in a controller just works** on Boot 4 (SpringDataWebAutoConfiguration resolver);
  first repo usage confirmed at runtime.

## MapStruct on JDK 25 + Spring Boot 4.1 (this session)
- MapStruct 1.6.3 works on JDK 25 (spike generated impls cleanly). The trap was the BUILD wiring, not
  MapStruct itself. Symptom: main compiles + `*MapperImpl` generate fine, but **test-compile** fails
  deterministically with symbol corruption on UNCHANGED files: `cannot access Optional/OtpService`,
  `UUID cannot be converted to java.util.UUID`, `saveAndFlush cannot find symbol`.
- Dead ends (all still corrupted or broke worse): plugin-level `annotationProcessorPaths` + an
  execution override; `provided`-scope processor + `maven.compiler.proc=full` property (property beats
  per-execution `<proc>`, so processing ran on tests anyway); per-execution `proc=full`(main)/`none`(tests).
  Pattern proven by bisection: **whenever `target/classes` contains generated impls, the next
  test-compile javac can no longer READ `target/classes`** - even main classes like `OtpService`.
- ROOT CAUSE (corrected after full bisection — the earlier `useIncrementalCompilation` theory was
  wrong; it merely masked the problem for one lucky build): the **VS Code Java language server**
  (redhat.java / m2e) continuously compiles this project into `target/classes` using its own bundled
  **JDK 21** and the Eclipse compiler. CLI Maven writes Java 25 bytecode into the same directory, and
  the IDE overwrites it mid-build. Hence the non-determinism and the impossible-looking errors:
  `NoClassDefFoundError: BigDecimal` (descriptor lost its package) and, tellingly,
  `java.lang.Error: Unresolved compilation problems` — an **Eclipse-compiler** message that plain
  javac can never emit. That one string is the smoking gun.
- How it was proven (keep this technique): copy `src` + `pom.xml` to `%TEMP%\pn_build` and build
  there. Outside the workspace it was green (59 tests) every time, with identical sources and pom.
  **If a build fails only inside the workspace, suspect the IDE, not the compiler.**
- Exonerated by bisection — do not re-blame: MapStruct; javac (standalone javac with the same
  processor and the same flags — release 25, `-g`, `-parameters`, UTF-8 — was clean every run);
  Maven's argument list (Maven's own verbatim command line, run by hand into a scratch dir, was clean);
  `fork=true` + explicit `<executable>` (confirmed genuinely forking, still corrupt).
- FIX: separate the output directories. `<buildDirName>` property in `pom.xml` (default `target`,
  for the IDE) + `backend/.mvn/maven.config` containing `-DbuildDirName=target-cli`, so every CLI
  build writes to `target-cli` automatically. 3/3 deterministic green (59 tests), including a build
  immediately after touching a source file — the exact case that used to fail.
  `useIncrementalCompilation=false` is kept as cheap insurance, not as the fix.
  `java.autobuild.enabled: false` is ALSO set in `.vscode/settings.json`: the separate directory
  alone still left an intermittent `ClassNotFoundException` during `mvn verify` (the LS full-builds
  on import/startup regardless), so both guards are kept. IntelliSense/squiggles are unaffected.
- Takeaway: when a build failure is non-deterministic and the bytecode itself looks malformed, the
  suspect list should start with "who else writes to this directory", not "which compiler flag".

## URL path + domain vocabulary constants (this session)
- Extracted route paths into `common.web.Routes`, error codes into `common.error.ErrorCodes`,
  and domain vocabulary into `catalog.property.PropertyStatus` / `DealIntent` /
  `security.Roles.Wire` / `OtpCode.PURPOSE_LOGIN`. Documented as rules in
  `docs/system/api-standards.md` sections 2.1, 4 and 7.1. 59 tests stayed green.
- The strongest argument for route constants was NOT DRY - it was security. A path is duplicated
  between the controller that declares it and SecurityConfig that decides if it is public. A typo
  there fails no build and no happy-path test; it just silently leaves an endpoint guarded (outage)
  or a matcher too broad (exposure). Same reasoning for ErrorCodes: the client BRANCHES on those
  codes, so they are API surface, not log text.
- Design rule that made routes work cleanly: ABSOLUTE paths only, and drop the class-level
  `@RequestMapping`. The tempting alternative (class-level base + relative method constants)
  forces every route to exist as TWO constants - a relative one for the controller and a composed
  absolute one for the security chain - which reintroduces exactly the drift being removed.
- Watch for: `@Pattern`/`@PreAuthorize` need COMPILE-TIME constants, so values used there cannot
  be derived at runtime (hence roles are declared in both lower-case wire and upper-case authority
  form, side by side, rather than calling `toUpperCase()`).
- When a ternary encoding a domain rule appears at 2+ call sites, move it next to the constants as a
  method (`DealIntent.priceUnitFor`) - two copies of a pricing rule that disagree would show a
  sale price as a monthly rent.
- Deliberately NOT converting these to Java enums yet: columns/DTOs/filters all carry String to match
  the contract's string enums, so enums would need converters + DTO changes + a migration story for
  unknown values. Revisit per-vocabulary when a value gains behaviour. Recorded in api-standards 7.1
  so it reads as a decision, not an oversight.


## Slice 3 - contacts + gate + Aadhaar badge

- **MapStruct silently hijacks no-arg "factory" methods.** A `default AadhaarVerificationResponse none()`
  on a `@Mapper` interface is treated as an **object factory**: the generated `toResponse(entity)` became
  `return none();` and every verified user's badge came back blank. `unmappedTargetPolicy = ERROR` does
  not catch it - the mapping is "complete", it just goes through the factory. Symptom to recognise: an
  endpoint returns the empty/default DTO while a direct repository read in the same transaction shows
  correct data. **Rule: a mapper interface may only contain mapping methods. Canonical empty shapes live
  as a static factory on the DTO.** Always read `target-cli\generated-sources\annotations\**\*Impl.java`
  when a MapStruct result looks wrong - the answer is right there in five lines.
- **Spring Boot 4 ships Jackson 3**: the import is `tools.jackson.databind.ObjectMapper`, not
  `com.fasterxml.jackson.databind.ObjectMapper` (2.x is present only as a runtime transitive of jjwt).
- **`src/test/resources/application.properties` REPLACES the main one, it does not merge.** Every new
  `@Value("${...}")` with no default must be re-declared there or every `@SpringBootTest` context fails
  with `PlaceholderResolutionException` - which surfaces as *all* tests erroring, including untouched
  ones. When that happens, find the one surefire report that does NOT say "failure threshold exceeded";
  that is the only one carrying the real `Caused by`.
- **Autowiring `RequestMappingHandlerMapping` by type is ambiguous** once actuator is on the classpath
  (`requestMappingHandlerMapping` vs `controllerEndpointHandlerMapping`). Qualify by bean name.
- **A signature is not a freshness check.** HMAC over `timestamp + body` proves authenticity forever;
  without an explicit skew window the captured payload is replayable indefinitely. And a *blank* HMAC
  key verifies every forgery, so `${SECRET}` being merely "present" is not enough - reject blank at
  construction.
- **Enforce idempotency in the schema, not just the service.** Check-then-insert reads as idempotent and
  is not. If the API promises "no duplicate row", there must be a UNIQUE constraint behind it and a
  `DataIntegrityViolationException` catch in front of it.
- **Trust carve-outs stay hand-written and `private`.** Masking helpers must be `private` so MapStruct
  cannot adopt them as implicit `String->String` converters and apply (or stop applying) them silently.
- **When hardening beyond the contract, fix the contract too.** Adding `@Size` without adding
  `maxLength` to the OpenAPI spec makes the server diverge from the SSOT. Change both in one commit.

## Backend schema materialization (this session)
- **Schema already existed** as Flyway migrations V1-V9 + R__seed_reference_data under
  `backend/src/main/resources/db/migration`. Local Postgres 13 runs on :5432; `psql` at
  `C:\Program Files\PostgreSQL\13\bin\psql.exe` (not on PATH). DBs: `punenest` (dev, EMPTY) and
  `punenest_test` (test schema, 62 tables).
- **`punenest_test` was one migration behind (V8).** The app-boot Flyway did NOT auto-apply pending
  V9 on the current Spring Boot 4.1.0 / Java 25 stack (no Flyway migrate logs; V9 never attempted) -
  worth verifying Flyway auto-migration is wired before relying on boot-time migration in dev/prod.
- **Applied V9 history-safe without the network.** No flyway-maven-plugin in .m2 and the corporate
  artifactory download hung, so I applied V9's DDL via psql AND inserted the flyway_schema_history
  row with Flyway's exact checksum. Reproduced Flyway's SQL checksum in Python: CRC32 over each
  line's UTF-8 bytes (no terminators, BOM stripped, `splitlines()`), cast to signed int32.
  **Proved correct** by recomputing V1-V8 and matching all 8 stored checksums before trusting V9.
- **`ddl-auto=validate` green boot = entities match schema** (repo's own proof pattern). Test config
  (`src/test/resources/application.properties`) targets `punenest_test`; dev/main has no datasource.

## Local DB seed for API integration (this session)
- **UI = source of truth for test data.** Derived the seed from the frontend real mock JSON
  (`frontend/src/data/localities.json`, `properties.json`, `db.json`) via a Python generator ->
  SQL, so market values/localities/owners match what the app actually shows. Highest fidelity,
  least invention.
- **Deterministic uuid5 ids** (fixed namespace + frontend key) give stable PKs across re-seeds and
  let FK links (owner_id, property_id) resolve inside one generated script. Idempotent with
  `ON CONFLICT DO NOTHING`. Great for hardcoding ids in integration tests.
- **Seed demo data must NOT be a Flyway migration** (esp. not `R__`) - it would run in prod too.
  Reference/master data (cities/settings/fees) belongs in `R__seed_reference_data`; demo listings
  are applied out-of-band to `punenest_test` only.
- **Respect CHECK/enum + token mapping when seeding:** furnishing `semi`->`semi-furnished`,
  rent->`price_unit=per-month` / buy->`total`, role in {buyer,owner,staff,admin}, team clamped to the
  allowed set or NULL, mobile must match `^[6-9][0-9]{9}$`. Validate before insert to avoid partial loads.
- **Cross-session handoff:** the session SQL DB (incl. `inbox_entries`) is per-session isolated - you
  cannot write into another session's inbox. To notify a parallel session, drop a durable repo
  artifact (`backend/LOCAL_DB_STATUS.md`) AND give the user a copy-paste message. Don't assume a
  silent cross-session channel exists.

## UI-API integration: auth vertical (this session)

- **Refresh-token single-flight must be cross-tab, not just in-process.** The backend treats replay
  of a rotated refresh token as theft and revokes the **entire family** (`RefreshTokenService.rotate`).
  Two tabs share `localStorage`, so a per-tab in-flight promise does nothing for them: both 401, both
  refresh, the loser replays a consumed token and signs the user out **everywhere**. Fixed with the
  native `navigator.locks` Web Lock plus a re-read of the token *inside* the lock (a tab that waited
  must use the winner's new token, never replay its own stale one). **Proved by A/B test**: with the
  lock both tabs stay on /dashboard and `/auth/me` returns 200; without it tab B lands on /signin with
  tokens wiped. Lesson: when a security control is server-side "burn everything on reuse", the client
  needs a matching *global* mutex - and prove it by removing the fix, not by reasoning about it.

- **Boot 4 split auto-configuration into per-technology modules.** `flyway-core` on the classpath is
  no longer enough; without `org.springframework.boot:spring-boot-flyway` the autoconfiguration never
  loads and Flyway silently does nothing - **no log output at all**, which is what made it look like a
  DB permissions problem. If an integration produces *zero* log lines, suspect a missing starter/
  autoconfig module before suspecting the external system.

- **Never point dev at the test database.** Tests that assert exact row counts require a schema Flyway
  built from empty; seeded dev data silently breaks them (5 failures that looked like code regressions
  but were `expected 2, got 18`). Symptom to recognise: every failure is "expected N, got N + seed".

- **Verify "pre-existing failure" claims by stashing, never by assertion.** The auth e2e specs fail
  8/22 - identical with and without this work (`git stash push -u -- frontend e2e`, re-run, pop).
  Without that measurement the honest statement "I did not regress anything" is unavailable.

- **A shared hook is a shared blast radius.** `useOtpFlow` is used by 5 *non-auth* verification flows
  (owner consent, society hub, share-flat). Wiring it directly to `authService` would have sent
  **login OTPs for owner consent**. Fixed by injecting the dispatcher (`useOtpFlow(dispatch)`), with
  non-auth callers keeping the mock delay. Always enumerate a hook's callers before rewiring it.

- **Mock mode must pay nothing for integration.** `AuthContext.loading` initialises to
  `isHttpDomain('auth') && !!readUser()`, so on mocks it is `false` and no spinner ever flashes.
  An integration seam that degrades the default developer experience will be worked around.

- **A relative API base is a security feature, not just convenience.** `VITE_API_BASE` pointed at the
  absolute `http://localhost:8080/api`, which bypassed the dev proxy and was **silently blocked by the
  page's `connect-src 'self'` CSP** - surfacing only as a generic "login failed". Relative `/api` +
  a proxy `rewrite` stripping the prefix keeps everything same-origin. Added a dev-only warning so the
  next person gets a signal instead of a mystery.

- **Triage review findings; do not apply them wholesale.** The security review's headline "CRITICAL"
  described a `writeKeyed` ordering race that cannot occur (the `removeItem` targets the *other*
  store, and Web Storage writes are atomic) - but the underlying cross-tab concern was real and worse
  than described. Two other findings were rejected outright: the claimed `useState` initialiser race
  (both lazy initialisers run in the same render, before paint) and a client-side error-message
  safelist (contradicts `api-standards.md`, which makes the server's envelope the user-safe contract).
  Value came from investigating the *mechanism*, not the severity label.

- **Contract parity has to be executed to be true.** `frontend/scripts/contract-parity.mjs` runs the
  real mock provider (Web Storage stubbed in Node) and the live API through the same call sequence and
  diffs the shapes. It immediately found `user.name` present on mocks but absent for a freshly
  provisioned live user. Classifying fields as REQUIRED (no fallback => breaks) vs OPTIONAL (read as
  `user?.x || default` => degrades) is what makes the check actionable instead of noisy.

- **A seam with a bypass is not a seam.** 21 files imported `listProperties` straight from
  `lib/mockApi.js` while `services/propertyService.js` sat there with one consumer. Flipping the
  property domain would have changed *one* component and silently left 20 on localStorage - a
  half-real UI that reads as a mapping bug. Before claiming a switch works, grep for direct `lib/`
  imports in `pages/` + `components/` and require zero results.

- **e2e specs hardcoding `const BASE = "http://localhost:5173"` ignore `baseURL`.** Combined with
  `reuseExistingServer: !CI`, the tests silently hit whatever is already on 5173 - including a dev
  server running in a different `VITE_API_DOMAINS` mode. Starting a server on another port does not
  redirect them. This produced 63 phantom failures and cost a full investigation cycle. Always
  confirm which server the tests actually reached (fetch `/src/services/config.js` from it).

- **Never A/B by stashing files against a live Vite server.** HMR applies a partially-consistent
  module graph, so the "baseline" you measure never existed. This manufactured a convincing phantom
  "Phase 1 regression" that evaporated on a clean restart. Any stash-based A/B must restart Vite (and
  ideally clear `node_modules/.vite`) before measuring.

- **`expect(locator).toHaveCount(0)` asserts absence and passes on the first poll.** If React has not
  rendered yet, it succeeds for the wrong reason - green when the app is broken, flaky under parallel
  load. Wait for a *positive* signal first, then assert the absence. And `getByRole(..., { name })`
  matches by **substring**: `name: "Notifications"` also matched "Sign in to view notifications".
  Use `exact: true` when the word appears in unrelated copy.

- **Prove a test can still fail.** After fixing the flaky guard assertion, breaking `ProtectedRoute`
  on purpose confirmed it fails correctly. A stabilised test that can no longer detect the bug it
  guards is worse than a flaky one, because it is silent.

- **`useIncrementalCompilation` is inverted, and with annotation processors it silently ships stale
  bytecode.** Despite the name, `false` hands javac only the sources Maven thinks are stale; `true`
  recompiles everything when anything changed (MCOMPILER-209). Under `false`, adding a field to a DTO
  record recompiled the record but never re-ran MapStruct, leaving a `PropertyMapperImpl.class` that
  called the old constructor - green compile, `NoSuchMethodError` at runtime, 18 tests failing with
  HTTP 500. A follow-up `mvn compile` then printed **BUILD SUCCESS while skipping compilation
  entirely**. Proven by experiment: an unmappable field is silently ignored under `false` and fails
  the build under `true` with "Unmapped target property" - i.e. `unmappedTargetPolicy=ERROR`, the
  guard the mapper's Javadoc promises, only actually works under `true`.

- **Corollary: `Copy-Item` preserves the source timestamp, which defeats timestamp-based staleness.**
  Reverting a file from a backup made it look *older* than its `.class`, so the compiler plugin
  skipped it and the suite failed against stale bytecode again. When restoring a file mid-experiment,
  touch it (`(Get-Item f).LastWriteTime = Get-Date`) or the build measures the wrong tree.

- **A "silent" bug is worse than a loud one, and slugs are where they hide.** Owner-created listings
  were saved with `locality_slug = null`, so they rendered perfectly on their own detail page while
  being invisible to every locality facet, `/locality/{slug}` page and saved-search alert. Nothing
  errored; the owner just quietly got no leads. When a column is the key that joins a record to its
  discovery surfaces, "nullable" needs a test that proves the record is *findable*, not merely that
  it saved.

- **Natural keys are a trap for locality/city names.** `localities.name` has no uniqueness
  constraint, changes for marketing reasons, and has genuine spelling variants
  (Hinjawadi/Hinjewadi, Wakad/Wakhad). The slug is the PK, the FK target and the SEO URL. Before
  removing an identifier that looks redundant, check whether it is load-bearing for FKs, URLs and
  normalization - here it was all three.

## Verification harnesses must fail closed, and must not sample one row

Two bugs in my own parity check, both of which produced a **green PASS over a broken feature**:

1. **Unclassified fields were invisible.** Fields in neither the REQUIRED nor OPTIONAL list were only
   printed as informational output and never affected the verdict. `construction` — which drives a
   search filter facet — sat behind a green check. Fix: any mock field not explicitly classified
   REQUIRED / OPTIONAL / WAIVED is now a **failure**. It immediately caught `rera`, which I had missed.
2. **Comparing one sample object hid seven fields.** The check diffed `list[0]`. Fields carried by
   only some listings (`commercialType`, `shellType`, `washrooms`, `powerBackup`, `fixtures`, `form`,
   `priceStr`) were absent from that row, so they never entered the diff. Fix: compare the **union of
   keys across all rows**. (Use a single real row for *semantic* cross-field checks like
   `bhk` vs `bhkNum` — a unioned object can mix rows and fail spuriously.)

Lesson: a harness that can only report what it was told to look for is a harness that certifies its
own blind spots. Make the default outcome "fail until judged", not "pass unless listed".

## Run browser-coupled modules through Vite, not bare Node

The mock provider chain reaches `db.json` imports and `import.meta.env`. Bare `node` fails on both.
The temptation was to edit product source to suit the script (`with { type: 'json' }`, `?.` guards).
Better: `createServer({ middlewareMode: true }).ssrLoadModule(...)` — no new dependency, zero source
changes, and the script then exercises the *actual* module the browser runs rather than a Node-adapted
lookalike. Only Web Storage and `addEventListener` need stubbing.

## A nullable column is not a free-text enum, and the gap only shows under a real client

`properties.possession` existed from V3 as nullable free text, was never written, and was NULL in
every row. It looked harmless for three slices. It was only when the catalogue was pointed at the
real API that it became a **silently broken filter** — the UI sent `ready`, nothing matched, and the
result was an empty page with no error anywhere.

Two things made the fix correct rather than expedient:

1. **Fix the contract, not the client.** The tempting patch was to hide the facet in http mode. That
   would have left the vocabulary undefined and the same bug waiting for the next consumer. Defining
   the enum once — spec, validation, CHECK constraint — makes it impossible to reintroduce.
2. **NULL had to stay legal and had to mean something.** "Not stated" is genuinely different from all
   three states; collapsing it into "ready" would have made the filter promise what the data cannot
   support. Plots have no possession state and correctly stay NULL forever.

Also: an `allOf` that redeclares an inherited property with a *narrower and incompatible* type makes
the schema unsatisfiable. Adding `possession` to `PropertySummary` silently contradicted the free-text
`possession` still declared in the `Property` detail block. Adding a field to a base schema means
checking every `allOf` that inherits it.

## A verification harness must name what it verified against

`npm run parity:property` defaults to `--base http://localhost:8080`. A backend running pre-V10 code
was listening there, and the harness failed with `construction: absent live` and
`localitySlug: absent live` — **the exact shape of a genuine code regression**. Several minutes went
into re-reading a diff that was correct.

The harness was right to fail; it was fail-closed, as designed. The defect was that its output did
not distinguish "your code is wrong" from "you asked the wrong server". It now prints
`live API: <base>` before any comparison. Any harness that talks to an external system should state
which instance answered, because a stale dependency and a real regression are indistinguishable from
the assertions alone.

## Degrading gracefully is not the same as degrading silently

The reviewer flagged unknown possession values mapping to `undefined`. Two of its three concerns did
not survive checking the code — `http.js:109` already drops `undefined` query params, so nothing ever
sends `possession=undefined`; and `JSON.stringify` omits `undefined` keys, so a PATCH cannot NULL the
column. Verifying each claim mattered more than counting them.

But the third was right for a reason worth keeping: `undefined` was the *correct* value in every
case, and the fault was that nobody would ever find out. An unrecognised value now warns, and the
parity harness asserts that exactly two warnings are emitted — so the warning itself cannot rot. The
write path warns only when *both* candidate sources fail, since dropping a possession the user
actually chose is silent data loss, while a payload carrying one shape and not the other is normal.

## `totalElements` is an aggregate — you rarely need a new endpoint to count

I nearly escalated "server-side aggregate endpoints vs. capped fetch" as a product decision. It was
a false dilemma: a paginated list endpoint already returns an exact count over the full result set.
`?size=1` and read `totalElements`. Six of the eight "needs a backend change" pages dissolved once I
noticed that. Check what the existing contract already answers before proposing to extend it.

## A reviewer's severity is a hypothesis; verify the mechanism before acting

A review of this diff returned 1 CRITICAL and 3 HIGH. Two were real. Three were the same
misunderstanding: React runs the previous effect's cleanup **before** the next effect run, so a
per-run `let alive = true` closure already discards stale responses when the dependency changes.
Adding "query matches what I asked for" guards would have been noise defending against nothing.

The inverse also happened: the CRITICAL was described with its polarity backwards (claimed the mock
returned `[]` for a null user; it actually returned *everything*). Acting on the description alone
would have produced a fix for a bug that didn't exist while leaving a worse one in place. Read the
code the review points at — the pointer is valuable even when the analysis is wrong.

## Making sync code async silently converts "cannot fail" into "fails invisibly"

`archiveListing` was a localStorage write; it could not reject, so no call site had error handling.
Routing it through the seam made it a network call — and every one of those call sites now had a
silent failure path that logs a false audit entry and toasts success. When a function becomes async,
its *callers* need review, not just the function.

Related: `Promise.all` in a bulk action is almost always wrong. It fails fast, so one failure
discards the knowledge of which others succeeded — and the UI then reports a count that never
happened. `allSettled` and report what actually occurred.

## A test harness that can't load your product code is telling you something

The parity script only drove the http *mapper*, not the provider. Making it drive the real provider
immediately failed on `window.location.origin` in `services/config.js` — the service layer could not
be loaded outside a browser at all. That is a real constraint on testability, not a script problem.
The related trap: the harness set `globalThis.window = globalThis`, which passes a `typeof window`
check while having no `location`. A partial stub is worse than no stub, because it defeats exactly
the guard written to detect its absence.

## Never `git stash` to establish a baseline when untracked files are part of the change

`git stash push -- frontend/src` left the untracked http provider directory in place while reverting
everything that referenced it, producing a "baseline" of 20 failures that measured nothing but the
inconsistent tree. It also reverted far more than the change under test (the whole session's work).
If a baseline is needed, use a clean worktree or a stash including untracked files — and sanity-check
that the number is plausible before drawing any conclusion from it.

Corollary learned the same day: don't edit source while a Playwright suite is running. The dev server
hot-reloads mid-run and the result describes no version of the code.

## "Same-origin via a dev proxy" does not mean the server skips CORS

The Vite proxy comment said requests stay same-origin so CORS never applies. The browser side of
that is true — no preflight, no blocking. The server side is not: browsers send `Origin` on POSTs
even when same-origin, the proxy forwards it, and the backend's CORS filter still judges it. It
worked only because the default dev port matched the allow-list, so it would have kept working right
up until someone changed the port and got a bare 403 with no CORS wording anywhere.

Two lessons. First, `changeOrigin: true` rewrites `Host`, not `Origin` — the name misleads. Second,
when a comment asserts a class of problem "can't happen", check whether it can't happen or merely
hasn't yet; a coincidence that looks like a design is the expensive kind of comment.

## Prove provenance before asserting on content in an integration test

The first live test asserts the *response came from the API* (`totalElements` present, request
observed on the wire) before any test asserts on rendered content. Without that, a silent fallback to
mocks makes the whole suite pass while verifying nothing — and it would look like strong evidence.
Same reason the count assertion checks for a `locality` query param: a client-side count also renders
a plausible number, so only the request shape distinguishes the two implementations.

## Pick the assertion that a regression would actually break

`My Listings` is asserted against a seeded owner with 4 listings, one `flagged`. Public search shows
3. Asserting "shows some listings" would pass whether or not `/me/listings` was used; asserting
exactly 4 fails the moment anything falls back to public search. Choose fixtures where the correct
and incorrect implementations give *different* answers — then mutation-check it.

## Keep infra-dependent tests out of the default suite

The live spec needs Postgres, a backend and a specific dev-server env. Putting it in the main run
would mean a failure no longer says "the app is broken" — it might mean "Postgres is down". Separate
config, `testIgnore` in the main one, and `reuseExistingServer: false` so a leftover mock-mode dev
server can't serve the wrong bundle to a test that believes it is live.

## Lesson: a mask that still parses is worse than one that throws

`digits('98XXXXX210')` returns `'98210'`. Not an error, not empty - a short, plausible
string that every downstream key builder happily accepted. The masking itself was correct;
the damage came from a *sanitiser* (`digits()`) silently turning a redacted value back into
something that looked like an identity.

Rules taken from this:
- Validate on a property the bad input CANNOT satisfy. Here: length === 10. Sniffing for
  `X` or the bullet char would have been a guess about mask formats; length is structural.
- When identity is unknown, return `null`/refuse. Do NOT fall back to a shared bucket -
  `|| 'anon'` was the same bug wearing a different name.
- Fail in the direction that under-reveals. Every rejected case here hides the number.
- Don't let a function report success for a write that did not land. `requestContact()`
  returning `'pending'` after a no-op write was how this stayed invisible.

## Lesson: prove a regression test fails on the old code

My first collision test passed against the buggy `contact.js` - it used two unmasked
numbers, so the buckets were legitimately distinct and the leak was never exercised. It
looked like a thorough test and asserted nothing that mattered.

Restoring the pre-fix file from `git show HEAD:<path>` and re-running is cheap (~25s) and
is now the standard step for any bug fix: **red on old, green on new, or the test is
decoration.** The rewritten spec fails 3/6 against the old file.

## Lesson: don't reformat JSON to insert one key

Round-tripping `property.json` through `JSON.parse` + `JSON.stringify(j, null, 2)` inserted
the key correctly and silently deleted 36 blank lines per locale - a 108-line diff for a
3-line change. Reverted and inserted the line textually by anchoring on the neighbouring
key instead. For i18n files with non-ASCII values, script the edit (so the encoding is
preserved) but operate on lines, not on the parsed object - then `JSON.parse` the result
purely as a validity check.

## Lesson: re-run a "known failing" suite before triaging it

`tasks\todo.md` carried an open item to classify 22 e2e failures (qa-location-search x13,
admin-* x9) as pre-existing and unexplained. They had in fact been root-caused and fixed in a
later session further down the same file; only the carry-over checkbox was stale. Two full runs
gave 290/290 green with zero retries consumed.

Cost of the reproduce-first step: ~5 minutes. Cost of trusting the note: an investigation of a
non-existent bug. **Always reproduce a recorded failure before analysing it**, and when closing a
failure, grep the tracker for every entry mentioning it - not just the one you are editing.


## Lesson: participation is not authorisation

The worst defect in slice 4 shipped inside a green build. `OfferService.respond` asked "is the
caller a participant in this offer?" and, satisfied, allowed any action -- so the **buyer could
accept their own offer**, agreeing a price with no owner involvement and flipping the very status
that controls whether a phone number is revealed.

Once named, the same shape appeared in two more places written the same week: the finalization
initiator could accept their own request, and a visitor could mark their own visit `completed` --
forging the anti-fake-review signal that gates the "Visited" badge.

The check answers a question ("may this caller see this row?") that feels like the authorisation
question but is a strictly weaker one. Split them explicitly, and give them different status codes:

- not a participant -> **404**, never confirm the row exists
- a participant who may not take *this* action -> **403**

Whenever a guard is shared by a read and a write, assume it was written for the read.


## Lesson: derive the sensitive value, do not validate what the client sent

`FinalizationService.request` took `counterpartyMobile` from the request body and checked only that
it belonged to *some* registered user. Two findings fell out of that one mistake: a buyer could aim
a proposal at any account on the platform, and the two distinct error messages ("invalid" vs "not
registered") turned the endpoint into a **registered-mobile oracle** -- on a marketplace whose whole
model is not leaking phone numbers.

Both closed with one change: take the counterparty from `property.getOwner()` and use the body's
value only to confirm the caller already knew it. There is now exactly one legitimate answer, so
there is nothing to enumerate and one uninformative error suffices.

Generally: if a field identifies *who a request affects*, the server should derive it from something
it already trusts. Validating a client-supplied identifier only narrows the attack; deriving it
removes the surface. Watch for the tell -- an error message that distinguishes *why* a lookup failed
is usually answering a question the caller had no right to ask.


## Lesson: a rule copied a third time has already forked

`maskMobile` existed privately in `PropertyMapper` and `ContactMapper`; slice 4 was about to add a
fourth. When they were gathered up, `VerificationService.digits` and `DealService.normaliseMobile`
turned out to have drifted into *different* leniencies -- and the loosest would cheerfully accept a
**masked** number and store it as an identity.

Nobody chose that. Each copy was locally reasonable; the divergence is what copying is.

The consolidated `MobileMask.normalise` now fails closed (exactly ten digits or `null`), and it
deliberately **disagrees** with `mask` about country codes: `normalise` handles user input, `mask`
handles values already read back from the DB, so anything unusual reaching `mask` means
normalisation was skipped -- and `null` makes that loud instead of quiet. That asymmetry is now
pinned by a test, because it looks like a bug to anyone who meets it cold.


## Lesson: an agent's green build is evidence about the build, not the code

Four sub-slices were delegated; each came back green and each was re-verified by hand. **Two of the
four contained real defects** the passing suite did not see -- including the self-accept
authorisation hole.

Worse, one agent-written test actively pinned a bug in place:
`requestFinalization_unregisteredMobile_returns400` asserted the *leaky* error wording. It read as
coverage and functioned as a lock on the enumeration oracle.

So: read the security-sensitive service yourself, whatever the test count says. And when a test
asserts an error *message*, ask what that message tells an attacker before treating it as a
requirement to preserve.

The standing counter-measure, used throughout the slice: **prove a regression test fails against the
broken code.** Replace the guard with `if (false)`, re-run that class, confirm red, restore. Every
invariant test in slice 4 was pinned this way; without it you get thorough-looking tests that assert
nothing.


## Lesson: when a guardrail needs an allowlist for everything, fix the rule

The ArchUnit boundary test was deferred twice, and both deferrals were correct for the wrong reason.
The rule on the books -- "no feature package imports another feature package" -- was false the day
it was written: `identity` is "who" and `catalog` is "which listing", so every transaction context
needs both. Six such edges existed. An allowlist naming nearly every pair permits everything and
therefore guards nothing, which is why writing it never felt worth it.

The property actually worth failing a build over was narrower: the context graph must stay
**acyclic**. Enforcing a *layering* (`identity -> catalog -> leads -> deals`, imports point strictly
downward) is true today, cheap, and catches the thing that would be irreversible.

It found a violation on its first run -- the one previously recorded as a permanent exception,
`security.JwtService` taking the `identity.user.User` entity. That is the single direction the rule
cannot tolerate, because the kernel is imported by everything. And the dependency was not even real:
the issuer read five scalars. Inverting it (`TokenSubject` in `security`, implemented by `User`)
changed no callsite.

Two things generalise. **A documented exception is worth re-testing rather than grandfathering** --
this one had been accepted for three slices and dissolved in ten minutes. And **a rule you keep
declining to enforce is usually the wrong rule**, not a chore you are avoiding.


## Lesson: PowerShell 5.1 traps that cost real time this session

- Heredocs (`<<'EOF'`) **do not exist**. Piping a script into `python -` fails at the parser.
- `Out-File -Encoding utf8` **writes a BOM**, which ends up in the first line of a commit message.
  Use `[System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))`.
- Chain with `;` and gate with `if ($?) { ... }`; never `&&`.
- The Maven exit code is not trustworthy here -- always aggregate
  `target-cli\surefire-reports\*.txt` for the real totals.

## Lesson: `:param is null` is a Postgres landmine in JPQL

`(:from is null or t.date >= :from)` looks like the standard optional-filter idiom and compiles
fine. Postgres rejects it at execution: `ERROR: could not determine data type of parameter $2`.
Both sides of the `is null` are unknown, so the driver cannot infer a type, and the **whole
statement** fails -- not the branch, the query. This broke **100% of `/summary` calls** and was
invisible until a test hit the endpoint.

Fix: `cast(:from as LocalDate) is null`. Any optional parameter compared to `null` in JPQL needs
the cast. Grep for `:x is null` before shipping a repository.

## Lesson: a multi-column `@Query` declared as `Object[]` silently nests

Spring Data models a multi-column projection as `List<Object[]>`. Declare the return type as
`Object[]` and you get a **one-element array containing the row** -- so `result[0]` is itself an
`Object[]`, and the cast blows up at runtime with a `ClassCastException` that names neither the
query nor the column.

Use a projection interface with `as` aliases in the select. It is typed, it is self-documenting,
and it deleted a pile of `((Number) x).longValue()` casts on the way out. Cost: five lines.

## Lesson: in a `@Transactional` `@SpringBootTest`, `JdbcTemplate` cannot see un-flushed JPA writes

They share the transaction but not the persistence context. `save()` only queues the insert, so a
raw-column assertion after a successful `201` fails with `EmptyResultDataAccessException` -- which
reads like "the endpoint did not write" and is actually "the endpoint has not flushed". Call
`em.flush()` before any raw SQL read in a test. Worth a named helper so the next person does not
spend the same twenty minutes.

## Lesson: check what the shipped UI can send before adding a server-side constraint

Three near-misses in one slice: `@PastOrPresent` on a transaction date would have rejected
post-dated cheques, which are how a large share of Indian rent is actually paid.
`familySize: integer` cannot express "Bachelor (Male)", which is the single most consequential fact
in a Pune tenancy screening. And `TenantProfile` carried `employer`/`budget`/`preferredLocalities`
that no screen has ever collected, while **four of the six trust-score inputs had no column at
all** -- so a faithful server would have halved every tenant's score on cutover.

The contract is law, but the contract can be wrong. Read the form before you constrain the field.

## Lesson: iterative date stepping clamps once and never recovers

`next = next.plusMonths(1)` from 31 Jan gives 29 Feb -- correct -- and then 29 Mar, 29 Apr, 29 May.
The clamp is **sticky**, because each step is measured from the already-clamped date. Month-end
rent silently walks two days earlier, forever, after one February.

Always step from the original anchor: `anchor.plusMonths(n)` re-derives the 31st in every month
that has one. The Javadoc here confidently described the broken behaviour as the correct one, which
is exactly why it survived the first read -- **a comment asserting correctness is not evidence of
it**, and is a good place to look for bugs.

## Lesson: reviewer findings are input, not instructions

Of six ranked findings from this slice's review, two were real (the date drift, a misleading log),
two were already handled (a null guard the reviewer read past), and two were style dressed as
risk. The one ranked **HIGH** -- an "off-by-one" in an occupancy day-count -- was wrong: half-open
`[start, end)` is the correct interval convention, and "fixing" it would have double-counted the
day one tenancy ends and the next begins. Applying it would have introduced the bug it claimed to
remove.

Triage every finding against the code and the domain. Then leave a comment where you rejected one,
so the next reviewer does not re-raise it and the next author does not "fix" it.

## Slice 6 - the rent money rail

**A "pause" you cannot undo is a trap, not a safety feature.** The mandate write refused any
re-activation, reasoning that debiting a bank account needs fresh consent. That reasoning is correct
for *revoke* and wrong for *pause*, and collapsing the two made the pause button a one-way door
disguised as a toggle. The tell: the `MandateStatuses` constants had already encoded the right state
machine, and the service overrode it with a special case. **When a service adds an `if` in front of
its own `canTransition`, one of the two is wrong -- and it is usually not the state machine.**

**A status filter in a lookup is a policy decision, and it hides.** `findActiveByTenancyId` filtered
`status = 'active'`, so a paused mandate was invisible to the write path and could never be revoked:
an uncancellable standing instruction against someone's bank account, created by a `WHERE` clause.
The word "active" in a finder name looks like a detail and is really the answer to "who is allowed
to reach this row". **Ask of every filtered finder: what becomes unreachable, and is that intended?**

**Scope idempotency keys to the resource, in the index and not only the query.** A global
`findByIdempotencyKey` hands anyone who guesses a key the payment it belongs to -- from a path whose
whole job is to *skip* the checks. Scoping the unique constraint to `(tenancy_id, idempotency_key)`
makes the isolation structural: the query cannot be written unscoped, because the caller must supply
a tenancy it was already authorised for. **Corollary: authorise first, replay second.** The original
ordering replayed the key before resolving the tenancy, which is exactly what made the leak possible.

**"The index is the real guard" is only true if you catch the violation.** Both a service `exists`
check and a unique index were in place, with a comment explaining that the check was a courtesy and
the index the guard. But nothing caught `DataIntegrityViolationException`, so the loser of the race
got a 500 for behaving correctly. **A constraint you rely on for correctness needs a catch block that
turns it into the status code the check would have produced.**

**Reviewer findings are input, not instructions -- and the confident ones need checking hardest.** Of
16 findings across two reviewers, 6 were real. One MEDIUM ("missing foreign keys allow orphaned
payments") was simply false: every one of those columns is `NOT NULL REFERENCES` in V6, which the
reviewer did not read -- and a second finding was stacked on top of the same mistake. Two more asked
for redundant `save()` calls on managed entities inside a transaction, i.e. cargo cult dressed as
consistency. **Verify the premise before accepting the fix; a wrong premise usually arrives with a
plausible sibling.**

**Declare every status code the server can actually return.** `payRent` documented `201`/`422` while
returning `404` and `409` too, and seven *already-shipped* slice-4 operations had the same gap. An
undeclared status has no branch in a generated client, so a perfectly good "the rent changed, confirm
again" surfaces to the user as an unhandled error. **A contract that under-declares is not merely
incomplete -- it actively produces bad UX at the exact moments the server is being careful.**

**Backfill from the data, not from the clock.** V14 filled a new `NOT NULL due_date` with
`current_date`, which would stamp every historic payment with today and quietly break overdue
calculations and month-by-month reporting. `date_trunc('month', created_at)` preserves the real
order. The table is empty today -- which is precisely why the mistake was easy to write and would
have been discovered much later.

**Let the provider's number reconcile, never write.** The payment callback's amount is compared with
what we billed and logged loudly on mismatch, but it never overwrites the ledger and a mismatch never
blocks settlement. Both halves matter: writing it would let the provider's rounding become our
revenue figure, and refusing to settle would leave a tenant who genuinely paid showing as unpaid.

## Slice 7 (Catalog & Search)

### Postgres: `ON CONFLICT ON CONSTRAINT` cannot name an expression index
A `UNIQUE` **constraint** cannot be declared over an expression, so `lower(city)` can only ever be a
`CREATE UNIQUE INDEX`. The explicit-looking `ON CONFLICT ON CONSTRAINT uq_...` form was therefore
never available - it 500s. Use the inference form `ON CONFLICT (mobile, lower(city))`, which must
match the index's columns *and* expression exactly and so still fails loudly if the index changes.
Same guarantee, different spelling.

### Catching `DataIntegrityViolationException` around `save()` inside `@Transactional` is a trap
The failed flush marks the transaction rollback-only. Swallowing the exception produces a caller that
believes it succeeded and a commit that then throws - the worst of both. `INSERT ... ON CONFLICT DO
NOTHING` avoids the exception existing at all. I wrote the buggy version first and caught it before
compiling; it would have passed a single-threaded test.

### `src/test/resources/application.properties` SHADOWS the main file, it does not merge
Same filename, test classpath first. Anything production config needs and tests must exercise has to
be written **twice**. This nearly let me ship a page-size cap that the test run did not actually have
- the tests would have "proved" a protection that only existed in prod config.

### Spring's default `max-page-size` is 2000
It silently applied to a public endpoint shipped five slices earlier, whose contract had said
`maximum: 100` since day one. A published limit that nothing enforces is not a limit. Set
`spring.data.web.pageable.max-page-size` globally, not per-controller.

### Spring binds a `Pageable`'s sort even when the endpoint declares no sort parameter
`?sort=anything` is bound and appended to the derived query; an unknown property becomes a **500 an
anonymous caller can trigger by guessing**. Where sorting is not offered, strip it
(`PageRequest.of(page, size)`). A whitelist is the right answer only where sorting *is* offered.

### A counter that measures the wrong predicate is worse than no counter
The stored `listing_count` columns did not merely drift - they counted *all* properties while every
surface that displays them means approved-and-unarchived. Stale can be refreshed; wrong-by-construction
was wrong the day it was written and looks trustworthy the whole time. Enforce the fix structurally:
leave the columns **unmapped on the entity** so reading them is impossible, not just discouraged.

### Do not let a reviewer's confidence substitute for evidence
Of the code review's 1 CRITICAL + 2 HIGH, only the CRITICAL survived. One HIGH (division by zero) was
invented from a mapper signature by a reviewer that said outright it had not read the service - there
is no division in the package. The other (MapStruct silently rebinding to a future entity getter,
defeating the whole counter decision) was a plausible, load-bearing claim, so I **tested it**: added
exactly that getter, compiled, and read the generated mapper - it still binds the parameter. A
whole-parameter match beats an entity property. Cost: about four minutes. Verify claims that are cheap
to verify, especially the ones you would otherwise act on.

### Flyway operational notes (cost me a failed run each)
Applying migrations by `psql` leaves no `flyway_schema_history`, so the next boot refuses with
"non-empty schema but no schema history table" - let Flyway own the DB, or rebuild it empty. And
editing any already-applied versioned migration changes its checksum, which means another rebuild of
`punenest_test`.


## Pagination pass + OTP rate limiting

- **A contract that declares a status nobody implements is a bug report you already filed.**
  `POST /auth/login` carried `429` in the spec and had no limiter. Grepping the spec for declared
  error responses with no server-side counterpart is a cheap, repeatable audit - do it per slice.
- **Rate-limit state does not need new infrastructure if the thing you are limiting already writes
  a row.** `otp_codes` had one row per send, so the limiter is a single indexed query: no Redis, no
  bucket cache, and it survives restarts and multi-node deploys for free. Look for the existing
  write before reaching for a counter store.
- **Key a limiter on the thing being harmed, not on the caller.** The victim's mobile is what gets
  spammed and billed, and it is the one identifier the attacker cannot rotate while still attacking
  their chosen target. Keying on caller/IP would have been both weaker and forgeable.
- **A limiter keyed globally is a DoS you built yourself.** The per-number isolation test exists
  purely to stop a future "simplify this counter" refactor turning one attacker into an outage for
  everyone. Test the *shape* of a defence, not just that it fires.
- **JPA writes are not flushed when raw JDBC runs in the same transaction.** A test that backdates
  rows with `JdbcTemplate` matched zero rows until `em.flush()` ran first - and without
  `em.clear()` after, the next repository read was served the stale first-level-cache entity and
  never saw the new timestamp. Flush before, clear after.
- **A spec audit that ignores `$ref` parameters will lie to you.** The first pass read
  `p.get('name')` and so missed every `$ref`-style parameter, making paged endpoints look
  unparameterised. Resolve refs *before* drawing any conclusion from a spec scan.
- **"Scope is not the test; growth is."** `/me/rent-payments` looks personal and bounded because of
  its path. It grows a row a month forever. The right question for pagination is never "whose data
  is this?" but "what makes this list longer, and does it ever stop?"
- **Before writing a rule, check whether the codebase already follows one.** The spec's 9 paged
  endpoints were exactly the platform-scale ones - a consistent, deliberate rule that had simply
  never been written down. Documenting the existing rule beat inventing a new one, and shrank the
  work from 42 endpoints to 3.
- **A client-side pager is a smell, not a solution.** `Table.jsx` slicing a full array on 19 admin
  screens was the evidence that the product had already decided those lists are paginated; the mock
  made server paging free, so the intent never reached the contract. When the UI pages and the API
  does not, the API is wrong.
- **Spring binds `?sort=` whether or not your endpoint offers it.** An unknown sort property reaches
  the query and surfaces as a 500 that any caller can trigger. Where sorting is not part of the
  contract, rebuild the `Pageable` with `PageRequest.of(page, size)` and drop the sort.
- **PowerShell 5.1's `Set-Content -Encoding UTF8` prepends a BOM**, which `javac` rejects with
  `illegal character: '\ufeff'`. Never rewrite a source file that way - use Python with explicit
  UTF-8, or `utf-8-sig` on read to strip an existing BOM. PowerShell also has no heredoc: pipe a
  script *file*, never `python - <<'PY'`.
- **Two paged reads over the same table still need two tests.** The rent pair (`/me/rent-payments`
  tenant-side, `/me/rent-ledger` owner-side) share a table and differ only in the join column - the
  exact shape where a copy-paste bug makes one return the other's rows.


## Slice 8 (Engagement) — lessons

### An index that contains the sort column still may not back the sort
V16 caught `idx_notifications_user (user_id, read, created_at DESC)` failing to back
`WHERE user_id = ? ORDER BY created_at DESC` — `read` sits *mid-key*, so Postgres uses the
`user_id` prefix to find rows and then sorts every one of them. The index looked right at a glance
and contained every column involved. Auditing the rest of the slice found two more (V17).

The check is not "does the index mention created_at" but **"is the sort column reachable as an
unbroken prefix continuation after the equality predicates"**. Read the `CREATE INDEX`, not the
comment above it — and when one instance of this turns up, sweep the whole slice, because it comes
from a habit rather than a slip.

Corollary worth keeping: small editor-curated tables (`banners`, `faqs`, `announcements`,
`cms_services`) should be left unindexed and the reason written down. The planner will seq-scan
them anyway. The distinction that matters is **bounded by an editor's patience vs bounded by user
growth**, and it is not visible from the query.

### Architecture tests that match on source text can be evaded by SQL — don't
`ArchitectureBoundaryTest` ranks bounded contexts and fails the build on an upward import. Reviews
(engagement=2) needed visit facts (deals=4) and tenancy facts (finance=3). A native query naming
those tables would have passed the test silently, because a SQL string mentions no package.

That is worse than the import it evades: it swaps a compile-time dependency on another context's
*API* for an invisible runtime dependency on its *schema*. The port inversion (`PropertyExperience`,
`RatingLookup` on the `common.trust` kernel, following the existing `ContactGate`) is more code and
the right answer. **When a boundary test blocks you, the question is whether the boundary is wrong,
never whether the test can be slipped past.**

### `Routes` composition can silently rename a path variable
`Routes.Properties.BY_ID` is `/properties/{id}`; the contract's review route says `{propId}`.
Composing the constant would have produced a working route with the wrong variable name — no
compile error, no test failure until something reads the wrong path variable. Reuse of a route
constant is only safe when the *variable names* match too, not just the path shape.

### The fix that looks tolerant can be the dangerous one
`POST /notifications/read` with a malformed id threw `IllegalArgumentException` → 500. The obvious
"tolerant" fix — skip ids that don't parse — would have been an escalation: an all-garbage list
arrives **empty**, and empty is the sentinel for "mark *all* read". A client typo would have
cleared the entire inbox, silently, with a 204.

**When a collection has a sentinel value (empty = all, null = everything, 0 = unlimited), any code
path that can *shrink* that collection can reach the sentinel by accident.** Filtering into a
sentinel is a bug class, not a one-off. Reject at the edge instead.

### A validation pattern that is too tight is the same bug as no pattern
Adding `@Pattern` for `alertFrequency`/`channel` fixed a user-triggerable 500 — but a wrong pattern
would simply move the failure. So the test asserts all **12** legal combinations are accepted, not
just that two illegal ones are rejected. Vocabulary tests need both halves; the accept-half is the
one people skip and the one that breaks real clients.

### Reviewer output is a lead, not a finding
Standing practice after an earlier slice produced fabricated review claims: **verify every claim
against the source before acting.** This slice: 6 findings confirmed and fixed, 1 closed with a
written reason, 2 rejected on inspection (one the reviewer retracted mid-report; one was my own
suspicion that the code already handled). And the highest-severity real bug — the notification
sentinel above — was found by hand, by *reading around* a line a reviewer had quoted for an
unrelated reason. Reviewers are good at breadth and unreliable at depth; the reading is not
optional.

### Where a deliberate decision gets written down matters
"Reviews publish immediately with no moderation queue" was flagged as a security finding. It is
actually the product posture — pre-moderation means an author cannot see their own review, which
suppresses honest reviews far more than dishonest ones, and the eligibility bar (a real tenancy or
completed visit on *that* property) is the actual defence. The reason now lives in
`ReviewService`'s Javadoc, next to the line that sets the status — not only in a task file. A
decision recorded where the reader is already looking does not get re-litigated by the next
reviewer, or quietly "fixed" by the next author.

### A REQUIRES_NEW write escapes the test's rollback
`AuditService` is `@Transactional(REQUIRES_NEW)` on purpose, so an audit row survives a rolled-back
business transaction. The consequence in tests is easy to miss and makes a suite quietly
order-dependent: the rows outlive `@Transactional` rollback and accumulate across runs. Two
assertions failed on each other's data. The fix is in the test, never the propagation - **scope
every assertion to the specific row under test (`entity_id`), never to the emptiness of a table** -
plus an `@AfterEach` that deletes what the class created. "Assert the table is empty" is a
test-isolation bug waiting for a second test to be written.

### jsonb is stored normalised, so never assert on its text
An audit-metadata assertion compared `"from":"pending"` as a substring and failed against
`"from": "pending"` - Postgres had reformatted it. Asserting on the serialisation of a document
column is asserting on formatting. Read it back through `metadata->>'key'` and compare values.

### `Set-Content -Encoding ascii` destroys Unicode silently
A regex replace round-tripped through ascii turned 12 em-dashes into `???` across a source file.
`-Encoding UTF8` is not the fix either - it prepends a BOM, which broke the OpenAPI YAML a slice
earlier. PowerShell 5.1 has no `utf8NoBOM`. **Edit files through Python with
`encoding='utf-8', newline='\n'`, or through the editor tool.** Also: `python -c "..."` from
PowerShell mangles nested quotes and `$`; write a `.py` file and delete it after.

### Spring's default bean name is the simple class name, so contexts collide
`moderation.verification.VerificationController` and the existing
`identity.verification.VerificationController` (Aadhaar KYC) produced a
`ConflictingBeanDefinitionException` at startup. A new bounded context can silently collide with an
old one across the whole application. Renaming to `PropertyVerificationController` was clearer
anyway - it is *listing* verification, not identity verification.

### Grep the controllers, not the obvious service, before building an endpoint
I re-implemented `PATCH /properties/{id}/archive|restore` and got an ambiguous-mapping failure:
they already shipped in slice 2, with the correct owner-or-staff rule. `PropertyService` is
read-only, which misled me - the writes live in `catalog.listing.ListingService`. The route is the
identity of an endpoint; search for the route string across controllers first.

### Entities get their id at INSERT, not at construction
`@UuidGenerator` + `@CreationTimestamp` populate on flush. Any DTO built from an entity created in
the same transaction - especially a child added to a cascaded `@OneToMany` - reads nulls. This
500'd every verification message post, and it was **found by a test written for an unrelated
invariant**, not by a reviewer. The tell is `save(...)` where the response exposes a generated
field; `saveAndFlush` before mapping. Worth applying even where the response happens not to read
the id today, because that correctness is a coincidence a future field will break.

### Escaping a LIKE term is not defensive coding, it is the feature
`q + "%"` looks anchored and isn't: the caller can supply their own `%` or `_` and step outside the
anchor. Without `pg_trgm`, the index only serves anchored patterns, so `?q=%` degrades a
staff-callable endpoint to a full scan - and a page cap does not help, because the scan happens
before the limit does. The regression test asserts **both** halves: wildcards are matched
literally, and an honest prefix still returns its row. A test for only the first half passes
happily against a search that has stopped working.

### A reviewer's fix can be worse than the bug
A MEDIUM finding proposed catching audit-serialisation failures and writing `"{}"`. That converts
a loud failure into a silent one on the single table whose entire purpose is to be trusted - if an
action cannot be recorded, the right answer is to refuse the action, not to perform it and file an
empty note saying it happened for reasons unknown. Rejected, and the reasoning written into the
Javadoc beside the line, so the next reader does not "fix" it back.

<!-- above: feature/backend-integration | below: feature/ui-mobile-improvements -->

## 2026-07-31 - Never run an unvalidated bulk-rewrite script across the tree

**What happened.** A PowerShell rename script built its replacement map as
`@( @('a','b') @('c','d') )`. PowerShell *flattens* nested array literals when they
are newline-separated inside `@()`, so `\` became a flat string array. The loop
`foreach (\ in \) { \.Replace(\[0], \[1]) }` then indexed
*characters*, turning every replacement into a single-character substitution. ~800 files
under `frontend/src`, `e2e/tests`, `docs`, `backend/src` and `tasks` were
character-mangled in one pass.

**Why it was recoverable.** Tracked files came back with `git reset --hard`. The
uncommitted Phase 1 work survived only because an earlier `git stash push -u` /
`git stash pop` had left unreachable commits in the object store
(`git fsck --unreachable`): `8ac3eb7` (tracked mods) and `26c0142` (untracked files).
Two edits made *after* that stash had to be re-applied by hand, and `tasks/todo.md`
content was lost.

**Rules going forward.**
1. Commit (or `git stash create`) before any scripted bulk rewrite. Uncommitted work is
   the only thing git cannot give back.
2. Dry-run first: print the planned per-file diff count and rewrite **zero** files until
   the map is verified on one sample file.
3. Validate the map's shape before use - assert every entry is a 2-element array and that
   both elements are non-empty multi-character strings.
4. Prefer `git ls-files` to scope a rewrite to tracked files only.
5. PowerShell hashtable keys are case-insensitive; a case-sensitive rename map must be an
   array of pairs, and building it needs an explicit comma between elements.

## Mobile-only design work (Phase 2)

- **Shared CSS classes are the cheapest lever.** Seven consumer overlays all use
  `.pn-modal-backdrop` / `.pn-modal`. One media query turned every one of them into a
  bottom sheet with zero markup edits. Look for the shared class before editing components.

- **A new floating control can physically block an existing one.** The filters pill and the
  Nestor FAB both anchored bottom-right; Playwright caught `.pn-assistant-slot subtree
  intercepts pointer events`. Any new `position: fixed` element must be checked against the
  bottom-chrome inventory (bottom nav, FAB, cookie bar, CityChrome, sticky CTA), not just
  against z-index.

- **Two controls for one action = a strict-mode failure waiting to happen.** The in-bar
  Filters button and the new pill were both `lg:hidden`, so both rendered below 1024px with
  the same accessible name. The fix was deleting the redundant one, not renaming it — if a
  locator can't tell two controls apart, neither can a user.

- **Measure animated elements after the animation settles.** `getBoundingClientRect()` right
  after `appendChild` catches a sheet at `translateY(100%)`. Await
  `el.getAnimations({ subtree: true })` `.finished` first.

- **Sub-pixel is not a bug.** A "bar overlaps footer" assertion failed at **-0.140625px**.
  Assert `> -1`, and say why in a comment, rather than chasing fractional layout rounding.

- **`position: sticky` beats `fixed` for in-flow action rows.** The wizard's step actions stay
  in flow, so they reserve their own space and can never cover the last field — no per-step
  `padding-bottom` bookkeeping.

- **`title=` is not a label on touch.** `CompareToggleBar` had four icon-only controls whose
  only name was a `title` attribute — completely invisible on a phone. Grep for `title=` on
  icon-only buttons during any mobile pass.

- **Enhancements should fail closed.** `srcSetFor()` returns `undefined` unless it can prove
  the URL is resizable, so a bad URL yields a plain `src` rather than a broken image.

## Mobile-only work — Phase 3

- **An inline `style` beats a responsive Tailwind class.** Writing a FAB offset as
  `style={{ bottom: 'calc(...)' }}` alongside `lg:bottom-24` silently changes desktop,
  because the inline style wins at every width. Use an arbitrary-value class instead.
- **Check whether a rule already exists before adding it in a media query.** `.lp-meter`
  was already `position: sticky` unconditionally; re-declaring it inside the mobile block
  hid that fact and made a desktop guardrail look like a regression. Grep the base rule first.
- **Some properties cannot prove a non-leak.** Chrome computes
  `-webkit-tap-highlight-color` as `rgba(0, 0, 0, 0)` by default on a pointer device, so a
  desktop assertion on it is meaningless. When a property has the same value by default,
  the media-query bound is the guarantee — say so in a comment instead of writing a
  test that always passes for the wrong reason.
- **`window.scrollTo(x, y)` then reading `scrollY` returns 0** when the app sets
  `scroll-behavior: smooth`. Use `scrollTo({ top, behavior: 'instant' })` in specs.
- **`waitForLoadState('networkidle')` is not enough for a `lazy()` route.** It can fire
  before the chunk mounts; a probe measured an empty document and looked like a bug.
  Wait for a real element (`getByRole('heading')`).
- **Measure a detached probe element bare, not inside its hidden parent.** Appending a
  `.pn-dropdown__option` inside a `.pn-dropdown__menu` measures zero because the menu is
  hidden until opened.
- **Take pointer capture on the first qualifying move, never on pointerdown.** Capturing
  eagerly retargets the following `click` to the capturing element and breaks every button
  inside the panel.
- **`git stash -u` + re-run is the only trustworthy way to separate new failures from a
  noisy baseline.** The desktop suite went 58 -> 66 failures; stashing proved all 11
  suspect failures were pre-existing rather than guessing from cluster names.

## Phase 4 lessons

- **An inline `style` silently defeats a token system.** `BottomNav` set `height` from a JS
  constant, so the bar's height was only *apparently* owned by `--pn-bottom-nav-h`. Any
  media query that changed the token would have desynced the bar from its own slots. Before
  trusting a CSS variable, grep for an inline style on the element that consumes it.

- **`min-width` breakpoints cannot tell a landscape phone from a tablet.** A rotated handset
  is ~915px wide, so `min-width: 768px` served it the desktop navbar on a 412px-tall screen.
  When a rule is really about *available height*, key it off height/orientation, not width.

- **A px font-size is not "safe" from dynamic type — it is the accessibility failure.**
  `text-[10px]` never overflows at 200% because it never scales. Passing an overflow test
  for that reason is a false negative. Convert to `rem` and add an overflow guard.

- **`leading-none` clips glyph extents.** line-height 1 is shorter than ascent+descent, so
  `scrollHeight > clientHeight`. Harmless at 10px, visible once the text scales.

- **Specificity ties are decided by which Tailwind variant is live, not by source order
  alone.** A one-class rule beat `h-16` at 640px but lost to `md:h-[72px]` at 915px. When
  overriding a responsive utility, go two classes deep rather than reaching for `!important`.

- **Measure the fix at the viewport that must NOT change, not just the one that must.** The
  landscape guard only earns trust because 1024×768 landscape-tablet and 1440×460
  short-desktop are asserted to stay at 72px — those prove the height and width guards
  independently.

- **When a constraint is physically unsatisfiable, say so.** The raised centre slot cannot
  fit a 56px circle plus a 24px label in a 56px bar. Scoping the assertion and documenting
  the exemption is honest; loosening it silently, or redesigning the slot without asking,
  is not.

## PWA lessons

- **Set the data-caching boundary before the data exists.** Writing `/api/* → NetworkOnly`
  while the app is still on mock data costs nothing and is fully testable; bolting it on
  after a live backend means experimenting on real listings, where a stale "available" flat
  is a trust failure.

- **A regex `urlPattern` fails open.** `/^\/api\//` is tested against the *whole* URL, so it
  never matches `http://host/api/...` — the rule silently does nothing. Match on
  `url.pathname` via a function, and assert the exclusion with a test that walks Cache
  Storage rather than trusting the config.

- **Precache the initial load graph, not the build output.** `dist` was 7 MB / 200 files;
  precaching it all would mean a 7 MB download before first paint.

- **An offline PWA fails to a blank white screen, which is worse than the browser's offline
  page.** `navigateFallback` serves `index.html` happily, then the lazy route chunk 404s and
  React never mounts. Always test "load once → go offline → reload", and read the
  `requestfailed` log instead of guessing which chunk is missing.

- **A service worker in dev would poison an entire e2e suite.** Keep `devOptions.enabled:
  false` and add a test asserting zero registrations in dev, so turning it on cannot happen
  quietly.

- **Scattered failures across unrelated specs + a 6× slower run = machine contention, not a
  regression.** Three orphaned Vite dev servers with `usePolling` turned 0 failures into 16.
  Check `Get-Process node` and listening ports before debugging the code.

## Bundle / chunking lessons

1. **An unassigned module in `manualChunks` is not "left in the entry" — it gets folded into
   whichever chunk happens to reference it.** If that chunk is a lazy vendor bundle, the entry
   now statically imports the *entire* bundle. One 3 KB shared module (`react/jsx-runtime`)
   pulled 189 KB of charting code in front of first paint.
2. **`if (!id.includes('node_modules')) return;` silently drops Vite's virtual modules.**
   `vite/preload-helper` has no `node_modules` in its id, so it fell through to "unassigned"
   and landed in vendor-jspdf — 382 KB eager, for a helper used by every dynamic import.
3. **A `vendor-react` rule that matches `react-dom` does not match `react`.** Substring rules
   read as if they cover the family; they don't. Match the path segment (`node_modules/react/`)
   and order the rules so the more specific package (`react-chartjs-2`) is claimed first.
4. **Grep finds import statements; only the bundler knows the graph.** The initial hypothesis
   ("fix the 5 jsPDF importers") was wrong twice over: 4 of the 5 were already lazy, and fixing
   the 5th did not remove the preload at all. Rollup's `getModuleInfo().importedIds` /
   `dynamicallyImportedIds` gave the answer in one run.
5. **Verify the artifact, not the source.** After the source graph reported "dynamic only",
   `dist/index.html` *still* preloaded both chunks. Source-level correctness and bundle-level
   correctness are different claims and need separate evidence.
6. **`manualChunks` is build-only, so no dev-server test can catch this.** The whole class of
   bug is invisible to the Playwright suites. Assert on `dist/index.html` after a build.
7. **Prove "pre-existing" instead of asserting it.** `git stash push -- <only the changed files>`
   gives a clean before/after on the exact suspect file without disturbing ~237 other
   working-tree entries, and `stash pop` restores it.
8. **Cold dev servers manufacture flakiness.** Right after killing stray servers, the mobile run
   showed 8 flaky (all bottom-nav/inset); the same specs on a warm server were 25/25 clean.
   Re-run before believing a flake cluster.

## Dev-server "first click hangs" — diagnosis (not a PWA bug)

Reported symptom: clicking a page link the first time takes ~1-2s and feels hung; instant after.

Measured, cold browser cache (fresh context per route), first in-app click:

| Route | Dev server | Production build |
|---|---|---|
| EMI calculator | 1488-1780 ms | **164 ms** |
| Flatmates | 1081-1258 ms | **155 ms** |
| Services | 1309-1681 ms | **109 ms** |

- Service worker in dev: `{ regs: 0, controlled: false, caches: [] }` — `devOptions.enabled: false`
  means no SW exists there, so **vite-plugin-pwa cannot be the cause**. In production the SW makes
  repeat loads faster, never slower.
- Only 3-7 requests / ~14-32 KB per first click, so it is not download size — it is Vite
  transforming the route module on demand. The result is cached, hence "fast from the second time".
- Dev-server idle CPU measured at 0 over a 5s window, so `watch.usePolling` is not a factor.

**`server.warmup` was tried and REVERTED — it did not help.** A/B with identical restarts:
control 1488/1081/1681 ms vs warmup 2235/2221/1021 ms. Warmup competes for CPU at startup and
the first click still pays for the rest of the route graph. Reverted rather than shipping config
that looks like a fix but measurably is not.

## i18n renames are silent failures
- The Share-a-Flat -> Flatmates rename moved  + "ShareFlatSection.jsx" +  ->  + "FlatmatesSection.jsx" +  and its
   + " ('home.shareFlat.*')" +  calls ->  + " ('home.flatmates.*')" + , but left the  + "shareFlat" +  block in
   + "i18n/locales/*/home.json" +  untouched. i18next renders a missing key as the key itself, so
  the home page shipped  + "home.flatmates.headingLead" +  as visible copy. No test, lint rule or
  build step failed.
- Lesson: a rename is not done until the locale JSON moves with it, in every language.
- Guard added:  + "rontend/scripts/check-i18n-keys.cjs" +  ( + "
pm run check:i18n" + ) resolves every static
   + " ('a.b.c')" +  against the merged English bundle. Proven to catch this exact regression (13
  keys) by temporarily renaming the block back. The trailing  + "[,)]" +  in the regex is what
  separates a complete key argument from the literal half of  + " ('a.b.' + kind)" + .
- Interpolated keys are invisible to static analysis, so a runtime guard was added too:
   + "mobile-home-featured-first.spec.js" +  walks Home's text nodes and fails on anything shaped
  like a dotted key.

## Docs/OpenAPI re-sync after a large feature redesign

- **The git history was one squashed commit, so there was no diff to work from.** When "what
  changed?" is unanswerable from VCS, the only reliable method is to re-derive the docs FROM the
  current source. Do not trust a doc's own "Status: documented from React source" line - the
  flatmates doc claimed it while describing a tab model that had been deleted.
- **Fan out the audit, serialise the edits.** Three read-only subagents (design-system, OpenAPI,
  other flow docs) produced evidence-backed drift lists with file+line citations in one pass; writing
  the edits afterwards was then mechanical. Asking a subagent to *edit* would have raced on shared
  files.
- **A rename is a doc-wide event, not a doc-local one.** `Flatmates/Rooms/Groups -> move-in/team-up`
  leaked into saved-alerts (alert `tab` values), ops (a new queue), admin (a whole missing doc),
  search-listings (a removed cross-sell pill), property-detail (a deep link), rent-agreement (a
  reissue entry) and the coverage matrix counts. Grep the old vocabulary across `docs/**` before
  declaring a rename documented.
- **Document the inert wiring honestly.** `?flat=&reissue=1` is produced by Flatmates and never read
  by `useRentAgreement.js`. Writing "this exists" without "and it currently does nothing" would have
  buried a real bug in a doc that reads as a spec.
- **YAML flow scalars break on `: ` (colon-space), not on semicolons.** A description like
  ``An open-policy group (`policy: any`) auto-accepts`` is a parse error; the same sentence with a
  semicolon is fine. Either quote the whole scalar or reword to `policy` = `any`.
- **Validate the spec after every batch, not at the end.** A ~30-line PyYAML script that reports
  paths / schemas / refs / unresolved / unused / boolean-enums / duplicate operationIds catches the
  YAML-1.1 traps and orphaned schemas in seconds. Expect unresolved == 0 and unused == 0.
- **A relative-link check over `docs/**` is worth running even when you did not touch links** - it
  surfaced 25 dead links left by earlier sessions that deleted `app-architecture.md`,
  `domain-model.md`, `api-contract.md` and `flows/_TEMPLATE.md` without repointing their referrers.
- **Docs-only changes have no Playwright story.** Say so explicitly instead of skipping the
  verification step silently - "no source changed, so the applicable checks are the spec parse and
  the link check" is a verification result, not an omission.

## Paid placement + subscription lifecycle (D59, D57)

- **A scheduled job is rarely the whole fix for "nothing ages this out".** A timer only shrinks the
  bad window to one tick. D57's real fix decides entitlement against the clock on every *read*
  (`currentFor` filters `!hasLapsed(now)`); the sweep just makes the stored status honest. Ask "what
  happens between ticks?" — if the answer is "an unpaid plan still works", the job is not the fix.
- **A hardcoded date in a test fixture is a time bomb that arms itself later.**
  `BillingEndpointsTest.deliverSigned` pinned `payment_time` to `2025-03-05`. Harmless for a year —
  then D57 gave subscriptions a real term, that yearly term had already elapsed, and the webhook
  started activating an already-expired subscription. Use `now()` in fixtures unless the literal is
  the thing under test. The same literal still sits in `PaymentWebhookTest` and `ServiceFixtures`.
- **An uncaught exception in a `@Scheduled` method cancels the schedule for the life of the
  process.** One bad tick silently stops every later one. Catch, log, let the next tick retry.
- **Disable timers in the test run.** A sweep firing on its own thread, outside the test's
  transaction, mutates rows a test just seeded — failing at random in whichever test was running.
  Gate the job on a property, set it false in `src/test/resources/application.properties`, and call
  the underlying method directly with a fabricated `Instant`. Deterministic *and* a stronger
  assertion than watching a clock.
- **An ordering-only JPA `Specification` must skip the COUNT query.** Spring Data issues a separate
  `Long`-typed query for the page total; adding `ORDER BY` to it throws. Guard with
  `!Long.class.equals(query.getResultType())` and return `null` for the predicate.
- **A `Pageable`'s sort overrides a Specification's `ORDER BY`.** To let the spec rank, pass
  `PageRequest.of(page, size)` with no sort — otherwise the ranking silently does nothing.
- **The mock provider's sort is not the sort the page renders.** `Listings.jsx` re-sorts everything
  through `listingsResultsPipeline.js`, whose default is `relevance`, *not* `newest`. Changing
  ranking in `lib/mockApi` alone changes nothing on screen.
- **Pick e2e targets from the rendered DOM, not from the seeded database.** The cheapest row in the
  store turned out to be a commercial listing the default tab filters out, so the promoted listing
  was never on screen and three tests failed for a reason unrelated to what they asserted. Results
  also page — a listing sorted last is simply absent, so assert badges in a view where the card is
  actually visible.
- **The sort control is a custom `Select`, not a native `<select>`.** `selectOption()` never
  resolves; click the trigger button and then a `[role="option"]`. Option labels are "Price: Low to
  High" / "Price: High to Low", so `/low/i` matches *both* — match exactly.
- **Paid placement has to be disclosed and must not override an explicit sort.** Ranking a promoted
  listing above one the buyer asked to see first is deception, not advertising. Keep the boost in
  the default orders only, and label it (`Promoted`) wherever it appears.

## Moderate-before-public on the flatmate board (D72)

- **A visibility blacklist is a leak waiting for the next state.** `mod_status not in ('flagged',
  'removed')` reads like moderation but it publishes by default: every state added later — `pending`,
  `appealing`, `shadowbanned` — is public until someone remembers to extend the list. State the
  whitelist instead (`in ('live','approved')`) so an unknown state fails **closed**. The same rule
  applies to the frontend mirror; two whitelists that agree beat two blacklists that drift.
- **Put the default in the column, not only the entity.** A JPA field initialiser is skipped by every
  route that is not JPA — a data migration, a repair script, an admin `INSERT`. `ALTER COLUMN … SET
  DEFAULT 'pending'` plus the matching `CHECK` constraint is what makes "held for review" true for
  the table rather than for one code path.
- **Gate the by-id path too, not just the list.** Hiding a row from the feed while leaving it
  fetchable and actionable by id is an unlisted page, not moderation — anyone with the link (or a
  loop over uuids) still reaches it. Every `findVisible`-style lookup needs the same predicate as
  the feed, including the `countQuery` twin, which is easy to miss because it is a separate string.
- **Changing a column default breaks every fixture that leaned on it.** Rather than patching
  assertions one by one, give the fixtures an explicit `publish(...)` step. The default is then
  asserted in exactly one place — a dedicated gate test — and the other suites stop silently
  depending on it.
- **A moderation gate makes every "created it, now see it on the board" e2e spec wrong.** The fix is
  a single named helper that *stands in for the moderator* (`approveFlatmates(page, 'posts')`), not
  a weakened default. Nine specs each grew one honest line. The spec that tests the gate itself is
  the one that must deliberately never call the helper.
- **`?post=1`-style action params must be dropped before a reload.** Replaying "open the post form"
  after a post exists reopens the modal — or trips the duplicate guard — over the board the test is
  about to assert on. Strip action params on reload; keep view params.
- **A success toast that says "is live!" becomes a lie the moment a queue exists.** Grep the copy —
  toasts, banners, help articles — when you add a gate. Two toasts and one help article were saying
  the post was published while the code was holding it. The author-facing banner is the place to be
  explicit: name the state ("in review"), say roughly how long, and keep Edit and Delete working. A
  post trapped in a queue its author cannot withdraw from is worse than no queue.
- **A moderation queue with no UI is half a feature and must be said out loud.** The API shipped
  (`GET /admin/flatmates/moderation`); nobody can work it from a screen yet, so until an admin page
  exists the gate means "invisible", not "reviewed". That belongs in the release note, not in a
  comment.
- **The queue DTO carries the author's name, never their mobile.** A moderation surface is a
  legitimate reason to see a person's post; it is not a reason to see their phone number.
- **A wall of unrelated red is usually the harness, not the code.** Sixteen specs across six files
  failed at once with `net::ERR_CONNECTION_REFUSED` — Playwright's auto-started Vite had been killed
  with the shell of an earlier, abandoned run. Read the *first* error before triaging the list: one
  connection-refused explains all of them. When a run has been cancelled, start the dev server in
  its own terminal so the next run reuses a server nothing else owns.

## Debt wave 10 lessons

- **An upward dependency between bounded contexts is a build failure, not a code smell.**
  `ArchitectureBoundaryTest.featureDependenciesPointDownward` ranks every context (`identity` 0 …
  `catalog` 1 … `leads` 2 … `finance` 4 … `admin` 7) and refuses any import that does not point
  strictly down. Wiring the verified-tenant badge into the contact inbox by injecting the concrete
  `finance.tenancy.TenantProfileService` into `leads.contact.ContactService` failed on the first
  run. The fix is the one the assertion message names: declare a port in `common.trust`
  (`VerifiedTenantLookup`), have the *lower* layer depend on the interface, and have the higher
  layer `implements` it. `Notifier` and `RatingLookup` are the existing precedents. **Reach for the
  port first** — the direct import always compiles, so the test is the only thing that stops it.
- **A port that answers "which of these are verified" should return the positive set, not a map.**
  A `Map<UUID, Boolean>` has two representations of "not verified" (absent, and present-and-false),
  so a caller that forgets one renders the wrong badge. A `Set<UUID>` has one, and the answer a
  forgetful caller gets is the safe one.
- **Server-stated beats client-derived whenever the input is masked.** The badge could not be
  derived on the client because the mobile it keyed on is masked, and a masked number can never
  match a real one — so the check silently answered `false` forever. Anything downstream of a
  redaction has to be told the answer, not asked to work it out.
- **A backend guard with no widget on the form is not shipped.** Turnstile validated
  `CF-Turnstile-Response` on three unauthenticated writes for a whole wave while no page rendered a
  widget, so the header was always absent. Wire the last mile in the same change, and send the token
  as a **header** rather than a DTO field: it stays out of the request schema, the OpenAPI contract
  and every log that prints a body.
- **Do not gate the submit button on the captcha token.** The server decides. A client-side gate
  bricks sign-in on any environment where the widget is configured but the server flag is not — a
  failure mode strictly worse than the abuse it prevents.
- **A comment that asserts the opposite of the schema is more dangerous than no comment.**
  `useRentAgreement.js` said "the server's columns are NOT NULL and always send a figure" — false
  since **V52** — which made the live null-handling branch look like mock-only scaffolding a future
  edit could delete. Deleting it would have quoted every customer ₹0 stamp duty. When a migration
  retires a premise, grep the prose for it; the code was already correct and only the narration
  lied, which is exactly the shape nothing tests.
- **Never filter a text file through `Get-Content` → `Set-Content`.** PowerShell 5.1 reads a
  BOM-less UTF-8 file as cp1252 and writes UTF-8 *with* a BOM, so one row deletion mangled 211
  em-dashes across `tech-debt.md` and would have tripped `SourceTreeHygieneTest.noMojibakeOrBom`.
  It is losslessly reversible (`UTF8.GetString(cp1252.GetBytes(text))`), but the right move is to
  use the editor tool. The tell is the diff doubling in size for a one-line change.
- **Re-derive counts, never edit them.** The register's header has been wrong for months because
  each pass edited the prose and not the arithmetic. It is now recomputed from the table by script
  on every change, and the invariant `open + 1 closed row + gaps = highest id ever issued` is
  written down next to it so a wrong number cannot look right.
- **A wave that ships four user-visible frontend changes and zero e2e has a gap, and the honest
  place to say so is `COVERAGE.md`.** Backend tests and build gates covered every wave-10 change;
  none of them opens a browser, which is where a collapse that fails *shut* or a captcha widget that
  blocks a form would actually be wrong.

## Debt wave 11 lessons

- **A shared image guard only helps the surfaces that actually use it.** `PropertyImage` already
  avoided `<img src="">`, but the home featured rail and recently-viewed rail still rendered raw
  `<img>` tags, so a seeded photoless listing tripped `search-property-types.spec.js` before the
  results grid was even the interesting part. Grep the route that failed, not the component you
  expect to be guilty.
- **The cheapest browser proof is often already in the suite.** `platform/help/i18n-urls.spec.js`
  looked like a language-prefix test and turned out to be the exact mobile footer regression: the
  cookie banner and bottom nav were covering the footer. When an existing spec names the user
  action that is broken, use it before inventing a new check.
- **A trust bit that rides on the wire is not done until the UI stops re-deriving it.** The backend
  had `requester.verified`, but the owner inbox still asked `rentService.tenantsVerified()` to infer
  the badge from a mobile that could still be masked, which structurally answered "no badge" for the
  pending rows that matter most. Carry the field through the seam and put the browser assertion at
  that last hop.
- **Owner-scoped mock stores have one safe key: the account id.** The last-10-digits shortcut in
  `myListings` and the mobile-keyed flatmate inbox both taught the suite an ownership model the
  backend does not have. The fix is not a smarter mobile normaliser; it is to route every owner
  read and write through `ownerIdentity.js` and accept that old mobile-keyed local data is
  disposable.
- **Do not grep a captured Playwright log for `✘`; read the summary block.** PowerShell renders the
  reporter's markers as mojibake (`✔`→`Γ£ô`, `✘`→`Γ£ÿ`, `║`→`ΓÇ║`), and `-Encoding UTF8` does not fix
  it, so a `Select-String '✘'` returns **0 matches while five tests are failing**. That reported a
  green suite three times in a row. Trust the final `N failed / N flaky / N passed` block and the
  process exit code; if you must scan per-test lines, group the marker column with
  `$_ -match '^\s*\S+\s+\d+ \['` rather than matching the glyph.
- **An accessibility fix can ship a worse accessibility bug.** The D134 build-time floor took
  `font-size: 0.6875rem`, resolved it to 11px, saw it under the 12px floor and wrote back the
  literal `12px` — converting a rem to a px and freezing the bottom-nav labels against the user's
  OS font-size setting. That is exactly the dynamic-type failure the rule's own comment existed to
  prevent, and only `landscape.spec.js` measuring at a raised root size caught it. A transform that
  normalises a value must preserve its unit; floor a rem *as a rem*.
- **Gating a read in the UI does not close a data-integrity hole.** The society catalogue fix
  gated four components' memos, but `canCreate` still only tested `!exact`, so during the load
  window every one of the 320 RERA names still offered "Add …" and minted a duplicate. A guard
  spread across four surfaces only has to be forgotten once, and a mint is unrecoverable. The
  gate that counts is the one in the store: `addCommunitySociety` now returns the canonical row
  instead of minting, and the UI gates are the second layer, not the first.
- **"Deliberately left ungated, with proof" deserves the same review as a bug.** Two of the three
  such notes on the catalogue work were factually wrong — `catalogue()` calls
  `ensureSocietyCatalogue()` on every read, so the "gating Home would put 182 KB back on the entry
  route" claim was impossible, and the "RERA rows do not compete in that strip" claim was refuted
  by a row carrying `tier: 'verified'` with both trust flags true. Worse, the false note had been
  written into the hook's docblock and was being cited to justify leaving real bugs unfixed. Read
  the call chain before recording a justification; a wrong comment outlives the code it excuses.


### A config test that asserts values cannot see a misspelled key

`application-prod.properties` is read for the first time by the first production deploy. A typo in a
*key* there does not fail — Spring binds nothing and the base file's value silently stands, and the
base file holds the permissive defaults (local Postgres, the demo seed, a loosened OTP throttle,
`trusted-proxies=none`). So the typo ships developer settings to prod and looks healthy.

`ProdProfileContractTest` first asserted only on *values* — the `${ENV}` placeholders and their
absence of defaults. Renaming `punenest.security.trusted-proxies` to `...trusted-proxys` passed all
eight tests: the placeholder was still declared, still had no default, still resolved. Proven by
mutation, not argued. **A properties test must name the keys** (`containsKeys(...)`), which catches
deletion at the same time. Value assertions describe the right-hand side of a line that may not be
wired to anything.

### `new StandardEnvironment()` inherits the real OS environment, so it cannot prove absence

`StandardEnvironment.customizePropertySources()` installs `systemProperties` and `systemEnvironment`
underneath anything you `addFirst`. A test that omits a variable to prove the boot fails without it
will therefore *pass silently* whenever the developer's shell exports that name — and `run-local.ps1`
exports exactly these names into the calling shell, so `mvnw test` in the same terminal that ran the
backend flips the result. The test then reports on the terminal, not on the file.

Use `org.springframework.mock.env.MockEnvironment` (spring-test): it extends `AbstractEnvironment`,
whose `customizePropertySources` is a no-op, so the supplied map is the entire universe. Same trap
applies to any `@Value`/placeholder-resolution test.

### Before writing a "lesson", grep `lessons.md` — this file is long enough to forget

The test-resources-shadow-main-resources trap cost a failed test run to rediscover, and it was
already recorded in this file **twice** (lines ~626 and ~1230). Reading it at session start is in
`AGENTS.md` for a reason; the cost of skipping it is paid in re-derivation, not in nothing.


### A fabricated fallback hides the bug in the code that was supposed to replace it

D197 blended a real per-aspect average 50/50 with a computed baseline. Deleting the baseline exposed
a *second*, independent defect: the http mapper filtered `categoryAverages` through the property
vocabulary for every entity type, so a society's five keys were dropped and `catAvg` was `{}` live —
always had been. The baseline had been drawing five plausible bars over an empty map for as long as
both existed. The fallback did not just make the number wrong; it made the wiring **untestable**,
because there was no observable difference between "the real data arrived" and "none of it did".

Generalise: any `real ?? plausible` in a render path removes the only signal that `real` is broken.
Prefer an empty state. If a fallback must exist, something has to assert the real path *without* it.

### An API-level e2e assertion cannot catch a client mapper, and reads like it can

`live-society-rating.spec.js` asserted the society aggregate with `page.request.get` and passed
throughout — the payload was correct; the page still rendered nothing, because the defect was between
them. A live spec that never looks at the DOM is testing the server, not the integration, whatever its
filename says. Pair every payload assertion with one rendered cell.

### The mock provider being *more* correct than the http one keeps the suite green over a live bug

`mock/reviewProvider.js` had `categoryKeysFor(entityType)`; the http mapper had one hardcoded list.
Every mock test passed. Parity between providers is not only about response *shape* — a behavioural
rule implemented on one side and not the other is invisible to a suite that runs against the mock.
When adding a per-target rule to one provider, grep the other for the constant it should have shared.

### Review agents earn their cost on the code you did *not* change

The two D197 reviewers split cleanly: one approved, one blocked on a HIGH in a file the diff never
touched, reachable only because the change removed what was masking it. Both were right. The lesson
is that "the diff is small and green" is not evidence about the blast radius of a **deletion** —
deleting a fallback promotes every latent defect underneath it to a visible one.

### A test that writes through the API and reads with raw SQL needs `flush`, and the read needs `clear`

Five D200 tests failed at once. Every assertion that went through the API passed; every assertion
that touched `jdbc` failed. That pattern is worth more than any single stack trace — five logic bugs
do not sort themselves by access path, so it was one cause wearing five costumes.

The cause is that `AbstractApiTest` is `@Transactional` and the services under test join *that same*
transaction. `repository.save()` therefore only stages the row in the persistence context. JPQL and
derived queries auto-flush before they read; **raw SQL through `JdbcTemplate` does not**, so it
queries a table the row has not reached yet.

The half that cost the most was believing this explained everything. It did not:

- **Writes invisible to SQL** → `em.flush()`. Fixed the two `SELECT count(*)` assertions.
- **SQL writes invisible to the code under test** → `em.clear()`. The test rewrote `otp_codes.code_hash`
  with `jdbc.update`, but the `OtpCode` it was overwriting was *still managed*. Hibernate resolves a
  JPQL result row to the instance it already holds for that id and discards the freshly-read column,
  so the verify compared against the stale in-memory hash and answered 401 — for two tests, one of
  which expected 403, which made it look like a permissions bug in the feature under test.

Two directions, same smell, different fix. Flush pushes your writes down; clear stops you reading a
ghost back up.

**The part to actually remember:** one of the repaired tests asserted a count of **zero**. Unflushed,
it would have reported zero whether or not the escape it was policing had worked — passing, in
green, for a reason with nothing to do with its subject. A negative assertion over an unflushed
context is not a weak test, it is a decorative one, and it is invisible precisely because it never
fails. Grep for `jdbc` in any test class that also calls `mvc.perform`.

### A crashed subagent may have finished the work and died on the way to saying so

One lane crashed at reporting. Nothing about it was known: no summary, no self-verification, no
statement of what it had decided. The instinct is to re-run it. The tree said otherwise — migration,
entity, repository, guard, two test classes and six modified files were all on disk and coherent.
Re-running would have destroyed a day's work to recover a paragraph.

Assess the artefacts before the agent. But invert it too: **what was lost was the reasoning, and
that is the expensive half.** The code showed *what* the bootstrap escape does; nothing recorded why
it is safe, and reconstructing that argument from the SQL took longer than writing it would have.
Where a lane's output is a judgement call, the judgement needs to land in a file as it is made, not
in a report at the end.

### Per-lane green does not prove the lanes can coexist

Four parallel lanes each self-verified green. Merged, the suite failed to compile — one lane had
added a constructor parameter to `AuthService`, and another lane's test built that class by hand.
Neither lane could have caught it; both were correct in isolation.

The compile error was the lucky case. The dangerous shape is the one that still compiles: two lanes
widening the same table, or agreeing on a column and disagreeing on what absence means. **Run the
full suite after a parallel merge, always, before believing any lane's report** — and note that the
per-lane build directory (`-DbuildDirName=…`) that makes the lanes runnable at once is exactly what
guarantees none of them ever saw the others.

### Closing a security item on the server does not mean the product has it

D200 shipped maker-checker and a last-administrator floor: enforced, constrained in the database,
tested, documented in the OpenAPI spec. It was ready to be marked done. Then `users/staff` turned
out to appear nowhere in `frontend/src` — the console that administers back-office accounts imports
straight from `mockApi.js` and writes to `localStorage`, so none of the control is reachable
(recorded as D205).

The register is what caught it, because closing a row forces the question "closed *where*". A
security control with no caller is not half-shipped, it is worse than unshipped: the register says
the gap is gone, the console shows the destructive gesture succeeding, and the two together are a
confident wrong answer. **When closing a control, name the caller.** If you cannot, the row has not
closed — it has moved.

### Two tests that differ only by an argument are not redundant when a query filters on it

D200's bootstrap escape — the rule letting a lone founder create their first colleague without a
second approver — was implemented as `approvalIsPossible(creator)` counting `role = 'admin'`
accounts other than the creator, called *after* the new user was flushed. So a lone founder creating
an admin colleague counted **the colleague**, got `true`, and wrote an approval row that only the
founder (refused as maker) or the held account (cannot obtain a token) could clear. There is no
reject or cancel route: a permanent lockout, on precisely the path the escape exists to keep open.

Sixteen tests covered D200 and all sixteen passed. The one that should have caught it,
`theSoleAdministratorIsNotHeld`, created a **staff** account — which does not match the count's
`role = 'admin'` predicate and therefore never self-counts. The bug was invisible to it for the same
reason it existed. A security review found it by reading the ordering; no amount of re-running the
suite would have.

**When a query filters on a column, every value of that column is a separate path.** A test that
exercises `role=staff` says nothing about `role=admin` if `role` is in the `WHERE` clause, however
identical the two calls look at the call site. The tell is that the test name generalises ("the sole
administrator is not held") while the body does not.

The fix was one line moved. The confirmation was worth more than the fix: **reintroduce the bug and
watch the new test fail.** Exactly one did, and it was the new one — which proves both that it
catches the defect and that nothing else did. A regression test written from a review finding and
never seen red is an assumption about a bug you no longer have in front of you. Same technique as
the D203 budget check (492 fails / 497 passes); it costs one build.

While fixing it, the interlock test `archivingThePeerDoesNotReopenTheEscape` turned out to be
**vacuous for the same reason** — it used `role=admin`, so the count was 1 whether or not archived
accounts were counted, and it would have passed with the `archived` filter it exists to forbid. Kept
and paired with a `role=staff` twin that genuinely pins it. **A bug in the code under test can make
a passing assertion decorative**; when fixing one, re-read the tests that were green *because* of it.

### An applied migration's comment is corrected by a new migration, not by editing it

V67's table COMMENT claimed a pending approval row "BLOCKS AUTHENTICATION on every login path". It
did not: `POST /auth/refresh` mints an access token directly and never consulted the table. Editing
the sentence in `V67__*.sql` took one minute and broke every test in the suite — `Migration checksum
mismatch for migration version 67`, Flyway refusing to start, 33 tests erroring at 0.001s with an
`ApplicationContext failure threshold exceeded` that names nothing relevant. **An applied migration
is immutable even when the only thing wrong with it is prose.** The correction went out as V69.

Two things worth keeping from it. First, the failure signature: *every* test in a class erroring in
about a millisecond means context load, and the actual cause is buried far above the first stack
trace — go to the surefire `.txt`, or grep the Maven log for `Caused by`, rather than reading the
sixteen identical `IllegalStateException`s.

Second, and more useful: the gap **was not exploitable**, because the only writer of an approval row
creates it in the same transaction as the user, so no refresh token can predate the hold. That is
true of today's write paths and nothing enforces it. This is the shape to watch for — a guarantee
that holds by accident of ordering, documented as though it holds by construction. The comment was
not describing the system; it was describing the intent, and the two had quietly diverged. The gate
now runs on all three issuing paths, so the sentence is true rather than lucky.

### A security review earns its cost on the findings that are not vulnerabilities
The D200 review returned no CRITICAL and explicitly dismissed seven candidate attacks after
verifying each (bootstrap escape engineerable — no, `role` has no setter anywhere in `src/main`;
transitive self-approval — no, the intermediate account is itself held; OTP enumeration — no
observable difference without possession). It would have been easy to read that as a clean bill.

The value was elsewhere. It found a **permanent-lockout logic bug** the whole suite was green on, a
**latent bypass** on the one auth path that skips the shared funnel, and **three comments asserting
things that are false** — including one in the database itself. None of those are vulnerabilities.
All of them are the codebase telling a future reader something untrue about its own guarantees,
which is how the next real vulnerability gets built.

**Ask a reviewer to verify the reasoning, not just hunt exploits.** The dismissed attacks were worth
the tokens too: each one is now a written argument for why a defence holds, and that is what makes
the next change to it reviewable.

### A defence whose success and failure produce the same response is a defence nothing is checking
Refresh-token reuse detection burned the whole token family and then threw a 401. Both methods on
the path were plain `@Transactional`, and the revocations were dirty-checked entity mutations, so
the throw rolled every one of them back. For months the tripwire did precisely nothing.

What made it survive is the shape worth remembering. **The caller-visible behaviour is identical
either way** — a replayed token is already revoked, so it answers 401 whether or not its siblings
were burned with it. No black-box assertion can separate the two. And the test named for the
behaviour, `refreshRotatesTokensAndOldTokenReuseRevokesFamily`, asserted only the 401 — so the
suite reported the feature as covered by a test that could not have failed if the feature were
deleted. That is the second time in one review that a test name has been the only place a
behaviour existed; the first was `archivingThePeerDoesNotReopenTheEscape`.

The fix is to assert on the part that differs — but in a `@Transactional` test harness that is
harder than it sounds, and the first three attempts all produced green tests that proved nothing.
Asserting the *successor* token is now rejected looks exactly right and fails to discriminate: the
revoked entities stay managed in the test's persistence context and answer "revoked" whether or not
the write would ever have reached the database. `TestTransaction.isFlaggedForRollback()` reports the
test's end-of-run rollback preference, which is `true` unconditionally.
`TransactionAspectSupport.currentTransactionStatus()` throws, because the test transaction is
managed by the TestContext framework rather than the transaction aspect. The bound
`EntityManagerHolder` is not marked. The `ConnectionHolder` is — and only reading both side by side
under the reintroduced bug (`false/true`) established which.

**Every one of those four was written, run, and believed for a moment.** Three passed with the bug
deliberately restored. The only reason the fourth is trustworthy is that the third and fourth were
run against the reintroduced bug and disagreed. **A probe you have not seen go red is a probe you
have not tested** — and in a transactional harness, the plausible-looking probe is usually the one
that measures the harness instead of the code.

The Spring half is worth stating plainly because this codebase had already learned it and still
walked into it. **`noRollbackFor` on the outer method is not enough.** An inner `@Transactional`
that *participates* rather than owning applies its own rollback rules to the shared transaction and
marks it rollback-only; the outer method then honours its own annotation, attempts the commit, and
gets `UnexpectedRollbackException` rendered as a 500. Both ends need the rule. `OtpService` carries
a long note explaining exactly this (tech-debt D90) — but the note lives on the method that needed
it, and the next place that needed it was two files away and never saw it. **A lesson written only
where it was learned does not travel.** This one is now in three places on purpose.

### A register figure rots silently, and the rot is worst on the rows that sound safest
D37 asked to agree a service-size rule "now while it is free and nobody is defending a specific
file", and gave its evidence in one clause: *services top out at 405 lines*. That number was wrong
by 2.7×. The real maximum was 1087, and **six** services were already past the 450-line threshold
the row proposed — so the cheap window the row described had closed, probably months earlier, and
the row went on describing it every time someone read the register.

Nothing about the row looked stale. It had a reason, a trigger and a priority; it satisfied every
rule this register enforces. The one thing it did not have was a **measurement that re-runs**, and
a figure quoted in prose is a snapshot that keeps presenting itself as a fact. The fix was not to
split the six services — that is real work nobody has scheduled — but to pin them in a `BASELINE`
table at exact measured size, may shrink and never grow, so the number now lives in a test that
fails when it drifts instead of in a sentence that cannot. The guard also fails if a pinned file
drops below the threshold without its entry being deleted, which is what stops the baseline from
quietly becoming the new permanent rule.

**Before acting on a register row's evidence, re-measure it.** Especially when the row's whole
argument is that acting is still cheap.

### Removing an edge from an import cycle is not removing the cycle
D208's blank-page bootstrap was caused by a module-scope read of an `http.js` export while
`config.js`'s eager glob was mid-evaluation. Moving the constant into a leaf module with no imports
removes *that* edge, and it is the right cheap fix — but `http.js` still imports `config.js`, and
`config.js` still eagerly globs every provider. The cycle is untouched. Only making the glob lazy
removes it, and that turns `createProvider` async and ripples through the entire data seam, which
is why it stayed an architectural decision rather than a cleanup.

The gate built alongside it is honest about the same limit, and enumerating what it *cannot* see
was more useful than the gate itself: it parses provider modules, so it is blind to indirection
through a non-provider module, to a new module joining the glob under a different path, to a side
effect at `http.js`'s own scope, and to `apiLimits.js` one day acquiring an import — which only a
comment defends. Writing that list down is what makes the next failure recognisable instead of
mysterious.

Two habits came out of it. **Prove a new gate red before trusting it green** — this one was proven
twice, once with a read nested two objects deep and once aliased through the compatibility
re-export, and a gate that has only ever been green is indistinguishable from a gate that is
broken. And **a fix that narrows a failure mode should say so out loud**, because "D208 fixed" and
"D208's most likely instance is now caught" invite very different amounts of care from the next
person to add a provider.

### A parallel wave makes some measurements impossible, so take them before you launch it
Five lanes ran concurrently in one working tree. Four of them touched `frontend/src`, and the byte
budget moved 492.9 → 495.2 KB of 497. **No lane could attribute its own share**, because a clean
A/B needs a tree only one lane is editing, and by the time the number mattered there were 44
modified and 7 untracked files under `frontend/src`. The lane that owned the smallest diff spent
real effort establishing that its contribution was approximately zero and could still only argue it
from first principles.

The same shape bit the backend: two lanes independently reported that test compilation was broken
by a third lane's uncommitted constructor change, and each worked around it — one by building in a
scratch tree with the offending file excluded. Both workarounds were correct locally and neither
could tell whether the tree as a whole was green. Only the serial full-suite run afterwards could,
and it was the single question the wave could not answer from its own reports.

So: **any measurement that is a property of the whole tree — bundle size, full-suite green, a
broad e2e sweep — is a serial step, before and after, never a lane's own claim.** A lane can prove
its tests pass. It cannot prove the wave did.

### Porting a test to a live backend is not a mechanical exercise — some tests are *about* the mock
Wave 1 of the mock retirement moved ten `platform` specs onto the live suite. Eight were a one-line
import change. The two that failed were the interesting ones, and they failed for the same reason:
**their subject was behaviour that only exists because a mock exists.**

`auth/flow` asserted that signing in with an unknown number bounces you to `/signup` with the mobile
carried over. That is real, shipped behaviour — behind `!authIsLive`. The live API has deliberately
**no** "does this mobile exist?" endpoint, because answering it publicly is a user-enumeration
oracle; it provisions the account on first verified login instead. So the mock's nicety is not a
feature the live path lost, it is a feature the live path *refuses*.

`auth/verify-funnel` asserted the Verified badge rendering after completing the DigiLocker mock.
Live, `POST /me/verification/aadhaar` answers 202 with a hosted consent URL and the badge is granted
only when the signed webhook lands. Nothing the browser does can earn it.

The tempting fixes are both wrong. Reinstating a `test.skip` keeps a green tick over an assertion
that no longer runs. Faking the missing half — stubbing the webhook, or signing in as an admin
because the scoped role no longer exists — produces a test that passes by asserting the fake.

What worked was to **ask what the live system actually promises and assert that instead**, and to
notice that the inverse is usually the more valuable property:

- "unknown numbers go to signup" became **"an unregistered number and a registered one are
  indistinguishable from outside"** — asserted as a pair, because "the unknown number reached OTP"
  is only evidence of non-disclosure if a known number does exactly the same thing.
- "the badge renders after the mock grants it" became **"starting verification grants nothing"** —
  a client that could talk itself into a trust badge is a security defect, and this is now the spec
  that would notice. The render half was *not* quietly kept on the mock suite; it was moved to
  COVERAGE.md as an explicit ⏳ gap, because a spec that can only pass against a fake grant is worse
  than a documented hole.

One test was deleted outright: with non-disclosure asserted as a pair, "a registered number proceeds
to OTP" was the same click asserted twice.

**The conversion ratio is the real lesson.** 8 of 10 were free; the 2 that were not each needed a
decision about what the system promises, and both decisions improved the coverage. Budgeting a
folder conversion by file count will be wrong in exactly the places that matter.

### The live suite can log in, which retroactively exposes what the mock suite was not asserting
Two guardrails in `desktop-noleak-guardrails` were written as `if (!(await x.count())) test.skip()`
— a self-skip when the element is behind an auth gate. On the mock suite that branch was taken
**every run**, so two named guardrails had been reporting as coverage while asserting nothing, for
as long as they had existed. Nothing flagged it: a skip is not a failure, and the reason string
("gated by auth in this environment") reads like a considered decision rather than a permanent one.

Moving them live meant an actor was available, so both now sign in and assert. **A conditional skip
whose condition is always true is a deleted test with a green tick on it** — and the moment to find
them is when the environment changes, because that is when the condition's truth changes and the
skip either disappears or becomes indefensible. Worth listing skips from every run's summary, not
just failures.

### An assertion against state the code under test wrote itself proves nothing
`auth/flow` checked that after sign-up, `localStorage.puneNestUsers` contained the new mobile. The
sign-up form writes that key. So the assertion could only fail if the form failed to talk to its own
browser tab — it would have passed unchanged with the network unplugged.

The live version asks the server (`POST /auth/login` returns the stored profile, so the name is
checked too). This is the same defect shape as reading a mock provider's store to prove a mock
provider wrote to it, and it is invisible in review because the assertion *looks* like it is about
registration. **The test for it: name the component that wrote the thing you are reading. If it is
the component under test, the assertion is a tautology.**

### Read a response body before the app navigates away from it
Asserting on a 202 that the app immediately follows with `window.location.assign` fails with
`Protocol error (Network.getResponseBody): No resource with given identifier found` — Chromium
discards the buffer for a navigated-away response, and `page.waitForResponse(...).then(r => r.json())`
loses the race often enough to be useless.

Capturing it in a `page.route` handler is deterministic: `route.fetch()` gives you the response while
it still belongs to the test, and `route.fulfill({ response })` hands the app the untouched original,
so the redirect it performs next is still driven by the server's real payload. The same handler is
what makes the redirect assertable at all — the dev KYC provider issues
`https://mock.kyc.local/verify/<ref>`, a host that does not resolve, so left alone the browser lands
on a network error and every "and the badge was not granted" assertion afterwards passes for
entirely the wrong reason.

### Do not infer a database column from a frontend fixture's shape
A `psql` query stalled the previous session by selecting `role_id` from `users`. The column does not
exist; it was inferred from the mock `ADMIN` object in `helpers/app.js`, which has a `roleId` field.
Mock fixtures are shaped for the mock's convenience and are not a schema. Dropping the column from
the SELECT returned the answer immediately.

### A grep-based classifier measures the grep, not the thing
The 220 legacy specs were bucketed into "pure / session-only / seeds domain state" by grepping each
file for `localStorage.setItem`. It is a fine first cut and it sized the problem honestly at the
folder level. It is wrong per-file in two ways that both under-count the work:

- **State written through a helper is invisible.** `platform/i18n.spec.js` has no `setItem` and
  scored session-only, but calls `publishListing(page, propertyListing({...}))`, which writes a
  listing into the mock store. Converting it needs a real listing from the fixture registry.
- **`page.evaluate(() => import('/src/lib/x.js'))` is a dependency the grep cannot see.** The same
  spec probes four modules that P5c deletes. Those tests do not need converting, they need deciding
  about — and that is a different and slower kind of work than a rename.

So: **a cheapness estimate is only safe to act on in aggregate.** Before converting any individual
file, open it. The estimate said three specs were free; two were, and the third was the most
expensive file in the folder.

### A broad grep over an e2e directory is a token bomb
`grep_search` for a common word across `e2e/**` matched Playwright's `.trace` and `.network`
artifacts under `test-results/`, whose single lines run to kilobytes. It ended a working session.
Scope every search in that tree to a specific file or exclude the artifact directory.

### Moving a spec between suites can silently drop a viewport
`platform/help/centre` and `platform/help/i18n-urls` were on `CROSS_VIEWPORT` in
`playwright.config.js` — the explicit list of specs that must run on a phone as well as a desktop.
They are on it for a reason: `Footer.jsx` renders each column as an accordion that is **closed**
below `sm`, so the footer-link assertions pass on desktop against markup that is broken on mobile.
Renaming them to `live-*` moved them to a config whose only project was `chromium`. Nothing failed.
The reported test count went *up*, because the live suite now ran them. Half their coverage was
gone.

The general shape: **a test's configuration is part of the test**, and it lives in a file the
conversion does not open. Projects, `testMatch`, retries, viewport, timeout — none of it travels with
the file, and every one of those losses reports as success. Before moving a spec between configs,
grep the *old* config for its path and decide deliberately what happens to each hit. Here the fix
was to give the live config its own `mobile` project and **move** the two entries across, leaving a
comment on each list pointing at the other, because the next five conversions hit the same list.

Sharper version of the same rule: a coverage regression that arrives as a higher number is invisible
to every gate that watches for failures.

### "We would need to build X" is a claim about the backend, so check the backend

Converting `verify-funnel` I hit a real wall: the badge is granted only by a signed DigiLocker
webhook, which a dev machine never receives, so the "pill renders" half looked undemonstrable. I
wrote that up in `docs/migration/05-logic-to-backend.md` as an open item, listed three ways it could
be closed, and recommended one. All of it was reasoned carefully and all of it was wasted, because
the first option on my own list — a dev-profile endpoint that finishes the flow — had existed since
D122. `POST /me/verification/aadhaar/simulate`, on a `@DevOnly` controller whose class comment opens
by stating the exact problem I thought I had discovered.

I found it days later, by accident, grepping `VerificationService` for something else.

The reason I missed it is worth more than the miss. I had been reasoning from the frontend: I traced
what the app calls, found nothing that grants a badge, and concluded nothing grants a badge. But this
endpoint has no caller and never will — having no UI is the entire point of it. **A capability with
no caller is indistinguishable, from the call-site side, from a capability that does not exist.**
Tracing imports and following the code the app actually runs is the right instinct almost always, and
it is precisely blind to test-and-ops affordances, which are the ones you go looking for when you are
stuck.

So: before writing "we would need to build X", grep the backend for X by name and by the noun it
operates on. It costs one search. A plan that sends the next person to build something that already
ships is worse than no plan, because it carries authority — and I nearly spent a seed change, a
fixture-registry entry and a new invariant reimplementing a shipped endpoint.

The general form: **absence of evidence in the caller graph is not evidence of absence in the
codebase**, and the gap between the two is exactly where dev-only, ops-only and test-only tools live.




### A route that borrows another module's data inherits that module's permission ceiling

The user timeline is one native query that unions six tables, and one of them is `audit_log`. I
guarded it with `users:read`, which staff hold, and the admin-only test came back 200 where it
wanted 403. The atom was not the problem. `audit:read` is one of the six admin-only atoms precisely
so that staff cannot page through moderation history at `GET /admin/audit-log` — and I had just
built a second door into the same rows, unlocked, in a different module.

The fix was a separate constant, `TIMELINE_READ = ADMIN_ONLY + " and " + REQUIRE_USERS_READ`: keep
the capability atom that describes what the route is *for*, and raise the role term to match the
strictest table it touches. The general rule is that a composite read is only as public as its least
public ingredient, and the permission you would pick by looking at the endpoint's name is exactly the
one that will be wrong.

### The console's status text is the server's own word, verbatim

Seven of nine live assertions failed on `getByText('Suspended', { exact: true })`. `Badge.jsx`
does not Title-Case anything; it prints whatever string it is handed, and the string is now the wire
value `suspended`. Under the mock this had been a display label chosen in the browser, so the
capitalisation was a frontend decision. It is not one any more. Every conversion that moves a status
column onto the API silently moves its casing too, and a spec written against the old page will fail
in a way that reads like a missing row rather than a changed letter.

### `Table.jsx` paginates in the browser, so a named row is not reachable by locator alone

The same run could not find `Nikhil Nair` anywhere. The page asks the server for every account and
then hands the whole list to `Table`, which slices it at `pageSize={10}` — so 71 of 81 accounts
exist in memory, are absent from the DOM, and no amount of waiting will produce them. This is a
second, separate trap from the one already recorded about `Table` rendering each row twice; that
one makes a locator match too much, this one makes it match nothing. The fix was to stop treating the
table as the directory and use the search box, which is the affordance a real operator would use and
which now actually asks the server.

### A field the operator has to discover cannot be a required field

`InternalNote` was the obvious component to reuse for the flag reason: it is the shared
"add a note" control the console already uses for maker-checker actions. It was the wrong one twice
over. It reads its history from `lib/mockApi.js`, so reusing it would have quietly reintroduced the
seam violation this whole change exists to remove — and it hides its textarea behind a collapsed
toggle labelled "Internal note (optional)". The reason for a flag is not optional and it is not a
note about the action; it *is* a request field the server refuses to proceed without. A control whose
label contradicts the rule behind it will be read as the label, so the label wins and the operator
learns the rule from an error message instead.

### `PageResponse` says `totalElements`, so a spec that asks for `total` is asking the wrong envelope

Two of seven backend tests failed with `No value at JSON path "$.total"` against the *paged*
staff-activity route, while the identical assertion passed against the summary. Both endpoints
return a count called "total" in every sense that matters to a reader; only one of them wraps it in
`PageResponse`, whose record components are `content`, `page`, `size`, `totalElements`,
`totalPages`. Our own DTOs may name the field `total` and several do. The page envelope cannot,
and the resulting inconsistency is invisible until a test names it. Worth remembering as a shape,
not a fact: paged reads answer `content`/`totalElements`, everything else answers what its record
says.

### A null `Instant` bound to a native query leaves Postgres with no type at all

The staff-activity filters are optional, which on a native query means every parameter is bound on
every call and most of them are bound to null. Postgres answered
"could not determine data type of parameter", because `setParameter("from", (Instant) null)` gives
the driver nothing to infer from — there is no value and no declared column. Two changes fix it
together: bind the value as ISO text (`instant.toString()`, or null), and cast in the SQL
(`cast(:from as timestamptz)`). The same applies to the `cast(:x as text) is null or ...` idiom
already used across `AdminMetricsRepository`; it is not decoration, it is what makes an optional
filter bindable.

### A provider module *is* the provider — exporting a factory silently produces an empty object

`createProvider(domain)` resolves `./providers/{http|mock}/{domain}Provider.js` and calls methods
on the module namespace directly. I wrote `export function createStaffActivityProvider() { return
{...} }` plus a default export, which is the shape most codebases use and the wrong one here: the
service would have found `listStaffActivity` undefined on a module that exports only a factory.
The registries glob these files, so nothing type-checks the contract and nothing fails at build time
— the page just does not work. Every provider exports named top-level `async function`s, and the
existing files are the specification.

### Two identically-named seed rows make a toggle look broken fifteen seconds later

`twoDecisionsAbout('Isha Mehta')` clicked Suspend, then waited out the full timeout for a
Reactivate button that never appeared. The seed has two Isha Mehtas — one owner, one staffer — so
`.first()` matched whichever the server listed first, and the account I suspended was not the
account I was then looking at. The failure presents as a stale re-render, which sends you to look at
the page's refresh logic, which is fine. Any fixture that reaches a row by human name needs that
name to be unique across the whole directory, and in a realistically-generated seed it usually is
not; check with a `group by name having count(*) > 1` before choosing one.

### An id in the record column is not the same failure as an id in the actor column

I asserted that a staff-activity row contains no UUID, to prove the actor had been resolved to a
person. It fails, correctly: the Record column prints `entity_id`, because that *is* the thing
acted on and there is nothing friendlier to show for it. The claim I actually wanted was about one
cell, not the row. A negative assertion scoped wider than the claim will find something true and
call it a bug — and the tempting fix (soften the pattern, or stop printing the id) would have
damaged the page to protect the test.

## Mock-retirement migration lessons (feature/backend-integration)

- **`localeCompare`, not `<`, when pinning a server-side `ORDER BY` on text.** A code-point
  compare put "NIBM Road" before "Narhe" (`I` is 0x49, `a` is 0x61); Postgres's collation is
  linguistic and puts it between "Narhe" and "Nigdi". The server was right and the test was
  wrong. It took exactly **one row out of 155** to expose it, so this passes on most datasets
  and fails the day an acronym or a mixed-case name is seeded.
- **Pin an order the server promises; do not pin one it merely happens to produce.**
  `findByActiveTrueOrderByNameAsc()` is a decision and is asserted. `findByArchivedFalse()`
  with no `Sort` is heap order — asserting it would make an accident look intentional. Record
  the difference as a finding instead.
- **A list endpoint usually does not carry what the detail endpoint does.** Repointing the
  reels feed from the mock to `propertyService` looked like a one-line import swap and emptied
  the page: `GET /properties` sends `coverImage` and no `images`, `GET /properties/{id}` sends
  the gallery, and the mapper's `gallery: p.images ?? []` therefore yields `[]` for every list
  row. The page's three-photo gate then rejected everything, it did not throw, and its own
  catch-all rendered the empty state — so the bug read as "no reels today". **Diff the actual
  field list of both responses before moving any page that renders a collection.**
- **Verify a count against a different endpoint, not against the field it came from.** The
  locality spec asserts `listingCount` equals what `GET /properties?locality=<slug>` reports.
  Comparing a computed count to the stored one it replaced proves only that the migration
  copied a number.
- **Two functions can share a name and make different entities.**
  `lib/mockApi.createServiceRequest` creates a *ticket*; `serviceRequestService.createServiceRequest`
  creates a *service request*. Two pages import both, distinguishable only by an alias. Check
  the import before assuming what a call does.
- **A schema built for the old shape does not mean the API will accept it.** `tickets` has
  `service`, `customer`, `mobile`, `value` and `detail` columns matching the mock exactly, and
  `TicketCreate` deliberately withholds four of them — "a client that could set its own deal
  value would be writing the pipeline report". Read the DTO's Javadoc, not the table.
- **Mutation-test a concurrency guard.** Deleting the single `lockCaseFileFor` line made the
  new race test fail with the exact `duplicate key value violates unique constraint` the
  production log had shown. A race test that has never been seen to fail is not evidence.
- **StrictMode turns "idempotent when called twice in a row" into a live bug.** The review
  modal's open effect fires two *concurrent* POSTs, so a `findBy…().orElseGet(insert)` raced
  and one caller got a constraint violation. The fix is a transaction-scoped advisory lock plus
  a double-checked read — a row lock cannot help, because the contended resource is the
  *absence* of a row and `SELECT … FOR UPDATE` cannot lock one of those.
- **A modal that returns `null` when its data fails to load is indistinguishable from a modal
  that never opened.** The screenshot showed the page with the button still present and no
  error, which sent the investigation to the wrong layer entirely. The backend log had the
  answer; the UI had erased it.
- **Anonymous lead-capture forms cannot move to an authenticated endpoint at all.** Every
  mapping is wrong: sending it authenticated locks out the visitor the form exists for, and
  attributing it to whoever is signed in loses the mobile that was the point of the form.
- **Adding a domain to the seam needs `VITE_API_DOMAINS` in `playwright.live.config.js`.**
  `frontend/.env.live` is `*` and will mislead you into thinking a new provider is already live.

## D223 — the test-quality sweep, and what a green suite was hiding

- **`title=` contributes to a button's accessible name.** `getByRole('button', { name: 'Archive',
  exact: true })` matched ten card icon buttons, not the modal footer, because every card renders
  `<button title="Archive">`. A role-based selector is not automatically safer than a class-based
  one — it is safer only about the *role*. Scope modal footer buttons to
  `page.getByRole('dialog', { name: … })`.
- **A component that renders the same data twice makes every unscoped `getByText` a strict-mode
  violation, not an assertion.** The `Table` component ships a desktop `<table>` and a mobile card
  list, so `getByText('No transactions match.')` matched two elements. Scope to
  `getByRole('table')` — and then remember that the empty state *is itself a `tbody tr`*, so
  `toHaveCount(0)` on rows could never pass. What distinguishes empty from populated is a row with
  more than one cell.
- **A counter and a list can legitimately disagree.** `{rows.length} of {all.length}` is uncapped;
  the list under it is `slice(0, PAGE_LIMIT)`. Asserting card count equals the counter's second
  number fails against any corpus larger than a page. Derive from the first number and cap it.
- **A test that needs a specific data state must seed that state, not hope for it.** The
  `Unconfirmed (stale)` sub-filter needs an approved, non-archived, stale-or-dormant listing. The
  demo seed sometimes has one. The right move was to delete the test and point at the spec that
  already seeds `Unconfirmed Stale Flat` explicitly — duplicating it with a weaker fixture would
  have added a flake, not coverage.
- **Three patterns account for almost all dead weight in an old spec, and all three are invisible
  in a green run:** an assertion inside `if (await x.isVisible())`; an assertion on something that
  renders unconditionally (a counter, a heading) placed after an action, as if the action caused
  it; and a `waitForTimeout` standing in for the assertion on the next line. The first no-ops in
  exactly the broken state you wrote it for. The second passes for every input. The third is slower
  *and* weaker than the assertion it replaced, because `toBeVisible()` retries and a fixed sleep
  does not.
- **A stale count is stale in the direction that cannot fail.** "all 7 tabs are visible" against a
  strip that renders nine, and "all 5 KPI cards" against seven, both stayed green while two tabs
  and two cards had no test at all. Assert the count, not a list of names.
- **"Still imports `mockApi`" and "still depends on the mock" are different questions.** Of the
  three remaining consumer call sites, one was real work, one was blocked on a product decision
  nobody has made, and one had been dead code under the live provider for months. Grepping the
  import tells you none of that.
- **A migration from sync to async introduces races the old tests cannot see.** Repointing
  `Contact.jsx` from a synchronous `useMemo` over localStorage to an awaited API read meant the
  prefill could land *after* the user started typing and clobber it. The test that catches this
  holds the response open with `page.route` and a manual `release()`, types, then releases — and it
  was worth mutation-testing, because a prefill guard that does nothing looks exactly like one that
  works.
- **The client should not recompute a verdict the server already sent.** `submit.js` reimplemented
  three re-check rules in the browser and stored its own answer, while the server's was sitting
  unread in the response. Any drift produced a mirror that disagreed with the row it mirrors,
  silently, in whichever direction the client guessed.
- **Contract tests go red for two different reasons and only one is a bug.** All three foundation
  tests failed on code that was correct — the OpenAPI file had simply fallen behind three routes and
  six fields. That is still worth fixing immediately: a red contract test cannot report the next
  drift, which might be a field meant to stay internal.
- **`-Dtest=A+B+C` matches nothing.** Surefire wants commas. The failure is
  `No tests matching pattern`, and with `-DfailIfNoTests=false` it still exits 1 — so it reads like
  a test failure rather than a typo.

## D224 — a delegated survey is a lead, not a verdict

- **Spot-check every claim a subagent makes before acting on it.** A read-only survey of 242
  spec files reported 10 guarded assertions; three of them did not survive being read. One was
  documented idempotency cleanup against a real database and was correct as written; two already
  carried floors the survey had not noticed. Two "unconditional" `test.skip` calls were in fact
  conditional. Roughly 30% of the specific citations were wrong in some way, while the *shape* of
  the finding — sleeps are the real debt, guards are nearly gone — was right. Trust the shape,
  verify the instances.
- **Ask the survey to name the directories it swept.** It did, and that is the only reason the
  totals are usable: a partial sweep presented as complete would have made "10 guarded assertions"
  a floor rather than a count.
- **A regex sweep for anti-patterns over a codebase that documents its anti-patterns will
  massively over-report.** The first automated pass found 40 guarded assertions across 86 files;
  nearly all of the excess was the rewritten specs' own docblocks *describing* the patterns they
  had removed. Any future sweep needs to exclude comment bodies before counting.

## D224 — the skip message that was describing itself

`live-sheets-and-actions.spec.js` skipped with `'wizard gated (auth/paywall) in this environment'`
when `.lp-step-actions` was missing. `/list-property` is wrapped in `ProtectedRoute` and the test
never signed in, so it was not gated *in that environment* — it was gated in every environment,
and the assertion had never once run.

- **A conditional `test.skip` whose message sounds like a diagnosis is the most expensive kind of
  comment**, because it stops anyone looking again. The message was a guess written at the moment
  the author saw a missing element, and it then stood for however long as an explanation.
- **A skipped test is invisible in a summary that counts failures.** Prefer a failing test over a
  skipped one whenever the condition describes a broken application rather than a genuinely
  unsupported environment. "no listings rendered" and "no filter panel in this build" are the
  former.
- **When converting a skip to an assertion, check the route's guard first.** The fix here was not
  to assert harder; it was to sign in.

## D224 — floors, and the two shapes that pass on an empty page

- **`[].every(...)` is `true`, and `expect([]).toEqual([])` passes.** Both shapes are extremely
  common in sweep-style tests and both are satisfied perfectly by a blank, crashed or 404 page.
  Every such assertion needs a floor asserting the scan found something to measure.
- **The floor belongs in the helper's return value, not in each test.** `undersizedText` now
  returns `{ bad, measured }`; before, each of its three call sites would have had to re-derive the
  population count, and they would have drifted.
- **Look for the comment that already knows.** `live-text-legibility.spec.js` carries a comment
  explaining that a 404 page has no five-stat band to measure "so the sweep would have passed by
  finding nothing" — and then did not guard against it. When a file documents a failure mode,
  check whether it also defends against it.
- **A stale-fixture failure and a code failure look identical from the log.** `live-contact-ref`
  passed alone and failed at position 109 of the full suite, because the live database resets once
  per run and earlier specs had posted listings that sorted newest-first with no owner name. The
  fixture must be *selected* for the fields the test asserts on, never taken as `rows[0]`.

## D224 — "element is not stable" names the symptom, not the cause

A wizard step click failed with `element is not stable` after fifteen seconds of retries. The
cause was a `localStorage` draft restored in an effect: the first paint is the empty form, the
restore is a second render, and everything above the sticky footer changes height in between.

- **Waiting on a restored *value* is the honest wait for a hydration race** — it is true exactly
  when the restore has landed, and it fails loudly if the seed never loaded, which a
  `waitForTimeout` would have hidden until it surfaced as a confusing validation error two steps
  later.

## D225 — a sleep is a comment that says "I don't know what I'm waiting for"

Fifty-three `waitForTimeout` calls came out of ten spec files today. Sorting them turned out to be
mechanical once I stopped asking "how long does this need?" and started asking **"does the next line
retry?"**

- **Next line is a Playwright assertion** (`expect(locator)...`) or an auto-waiting action (`.click()`,
  `.fill()`) → the sleep does nothing. Delete it. Playwright already retries, which is the entire point
  of it.
- **Next line is a non-retrying read** — `innerText()`, `.count()`, `allInnerTexts()`, `page.evaluate()`
  → the sleep is load-bearing and deleting it will cause a flake. It must be *replaced* by an assertion
  on whatever state change it was really waiting for.

That second category is where the value is, because writing the replacement forces you to name the thing
you were waiting for — and about a third of the time, naming it revealed the test was wrong.

**Forty of the fifty-three were a single application detail.** `Select.jsx` renders its menu through
`createPortal` behind a `portalOpen` flag set one `requestAnimationFrame` after the open. Every spec that
touched a dropdown had independently discovered this and independently papered over it with 200ms. Nobody
wrote down *why*. When one component has a timing quirk, it does not produce one sleep — it produces one
sleep per call site, scattered across a dozen files, each looking like an isolated bit of sloppiness. **If
you find the same sleep duration repeated across unrelated files, stop fixing the tests and go read the
component.** The fix is one helper, not forty edits.

## D225 — `if (await x.count())` after a sleep is a skipped test with a straight face

Two files had this:

```js
await page.waitForTimeout(250);
const opt = page.locator('.pn-dropdown__option', { hasText: 'Flat / Apartment' });
if (await opt.count()) await opt.first().click();
```

`count()` does not retry. When the sleep ran short — on a loaded CI box, on a cold chunk — the count came
back 0, the click was skipped, and the test continued against a wizard that still held its *default*
property type. The test was named for choosing a type. It sometimes never chose one, and passed anyway.

The guard was almost certainly added *because* the sleep was flaky: someone saw an intermittent failure on
the click, wrapped it in a conditional, and the intermittency went away. It went away because the test
stopped testing. **A defensive `if` around an action is not defensive — it converts a loud failure into a
silent change of scenario.** The tell is that the `if` has no else and no comment; nobody who genuinely
believed the element might legitimately be absent would leave it at that.

## D225 — when the app gives a test nothing to wait for, change the app

`refer.spec.js` asserts that a *cancelled* native share does not count a referral invite. A cancelled
share is defined by mutating nothing: no counter moves, nothing renders, no request goes out. So there was
no signal, and the test settled for `waitForTimeout(150)` then "the counter still reads 0".

That assertion is worthless. It passes against a Share button wired to nothing at all, against a button
that does not exist, and against a page that failed to load its handler — every one of those also leaves
the counter at 0. It was measuring the absence of an effect it had never established could occur.

The fix was not in the test. The `reject` stub now increments `window.__shareAttempts`, so the test can
wait for the handler to have *run* and only then claim the counter did not move. **A negative assertion
needs a positive anchor, and if the application does not expose one, the honest move is to add one to the
test double rather than to keep asserting nothing carefully.**

## D225 — the strongest replacement is often not the one the sleep was covering

Two cases came out better than break-even, both by swapping a negative check for a positive one.

`p3.spec.js` asserted that submitting without a document raises **no** document error. At the instant of
the click the form has not validated at all, so `toHaveCount(0)` passes immediately and for the wrong
reason. It now waits for the *photos* error to appear first. The photos error is proof the validation pass
ran; only then is "and there is no document error" a decision the form made rather than a race the test
won.

Similarly, the photo-upload test waited for an error class to *disappear*. A page that never processed the
upload also has no error class. It now waits for the thumbnail to render, which only happens once the file
is in state.

**When you replace a sleep, you get to choose the new anchor — so choose the one that can only be true if
the thing actually happened, not merely the one that is true afterwards.**


## D225 — a workaround and the defect it hides travel together

The `if (await opt.count())` guard turned out to be in **eight** spec files, not the two the survey found.
Every copy was identical, and every copy sat directly under a `waitForTimeout(250)`:

```js
await page.waitForTimeout(250);
const opt = page.locator('.pn-dropdown__option', { hasText: 'Flat / Apartment' });
if (await opt.count()) await opt.first().click();
```

Somebody wrote the sleep once, hit an intermittent failure, added the guard, and the pair got pasted into
the next seven files as a working recipe. It *was* a working recipe — for making the suite green. What it
actually did was let eight different tests silently decline to choose a property type and carry the wizard
default through assertions that were named for the type they thought they had picked.

**The lesson is about the shape of the search, not the bug.** I found the first two because a survey
listed them. I found the other six because I went looking for the *pattern* rather than for more sleeps.
When a workaround turns out to be load-bearing for a defect, grep the whole tree for it before assuming
the survey was complete — copy-paste is the main way a small mistake becomes a systemic one, and the
copies are always literal enough to find with one regex.

Corollary worth remembering: `git grep` for the *guard* found more than grepping for the *sleep* did,
because the guard is distinctive and the sleep is everywhere. When two anti-patterns appear together,
search for the rarer one.

## D225 — `networkidle` is the same mistake with better manners

122 call sites across 31 files, and one of them failed in the live run — on a page the failure artefact's
own snapshot shows had rendered perfectly. `waitForLoadState('networkidle')` reads like an intention
("wait until the page is ready") and means something else entirely ("no request has been in flight for
500ms"). It is a property of the network, not of the DOM the next line asserts on, and a page with a hero
image, a lazily-loaded grid or any beacon can simply never satisfy it.

It is worse than `waitForTimeout` in one specific way: a sleep is obviously arbitrary, so nobody defends
it. `networkidle` looks principled, so it survives review. The failure it produces names the load state
rather than the page, which sends whoever triages it looking at the application first.

Fixed the three sites in the file that failed and left the other 119 alone with a note. Changing 122
navigation calls without running them would trade one known flake for thirty unknown ones, and the
replacement is per-route by design — the point is to name what *that* page is waiting for.
