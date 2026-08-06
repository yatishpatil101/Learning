# PuneNest Backend — Tech-Debt Register

**Status:** living document, and the **single source of truth for outstanding backend work**.
**Nothing here is scheduled until the backend feature slices are complete.** This is the parking
lot: the place a deliberate shortcut goes so it stops being a thing someone has to remember.

**Companion doc:** items that need a *human decision* rather than engineering time live in
[`open-questions.md`](./open-questions.md). The split is deliberate — mixing "we know what to do,
we haven't done it" with "we don't know what we want" makes a register unactionable, because you
cannot pick up the top item and start.

**Why this file exists.** Deferred items were accumulating inside `tasks/todo.md`, interleaved with
per-slice plans and RESULTS blocks across 2,600+ lines. That file is a *worklog* — chronological,
append-only, correct for "what happened in slice 6". It is the wrong shape for "what do we still
owe", because answering that meant grepping nine `### Deferred` headings and reconciling them by
hand. This register is the answer to that question, and it is the SSOT for it.

## Rules

1. **An entry needs a reason, an owner and a trigger.** "Deferred" with none of those is not debt
   management, it is forgetting with extra steps.
2. **Debt is deliberate.** A bug is not debt — fix it. Debt is a shortcut we would take again given
   the same information, and would not take with more time.
3. **Closing counts as progress.** An item removed with a written "won't do, because…" is as good an
   outcome as one implemented. What is not acceptable is an item that quietly stops being mentioned.
4. **This file does not schedule work.** When a slice picks an item up, it goes into `tasks/todo.md`
   as a checkable plan item; the entry here is then marked done with the commit or slice that did it.
5. **Per-slice RESULTS blocks stay in `tasks/todo.md`.** Only the *carried-forward* residue lands
   here, and it lands here **once** — no duplicate bookkeeping in two files.
6. **If it needs a decision, it is not debt yet** — it goes to `open-questions.md` and returns here
   once answered. An item blocked on "what do we actually want?" will never be picked up from a
   backlog, because the person reading the backlog is not the person who can answer it.

---

## 1. Decided: Lombok adoption policy

**Status:** DONE — implemented after slice 15, the last feature slice. **Owner:** backend.
Applied to all **62** entities; `mvn -o verify` green at **646 tests, 0 failures** — the identical
count to before the refactor, which is the proof that it changed no behaviour.

### The decision

- **DTOs → keep Java records.** Lombok adds lines and removes a security guarantee.
- **Entities → adopt Lombok `@Getter` at class level and `@Setter` at field level**, with a
  `lombok.config` banning `@Data`, `@ToString`, `@EqualsAndHashCode` and `@Builder`.

> **Amended on implementation.** This section originally said "34 entities" and prescribed
> `@Getter @Setter` at class level. Both were wrong; see *What the survey actually found* below.
> A blanket class-level `@Setter` would have been a real regression.

### Why records stay on DTOs

A record *is* the terse form — `public record KycStartResponse(String ref, String verificationUrl,
Instant expiresAt) {}` is already shorter than Lombok's `@Value` plus a class body plus three
`private final` declarations. There is no boilerplate to save here; the boilerplate problem is in
entities.

More importantly, **immutability is load-bearing for the trust model**. The contact gate rests on
"the mapper decides what to reveal, and that decision is final". Give `ContactRequestResponse` or
`PropertyResponse` setters and `response.setContact(...)` becomes legal anywhere downstream — the
reveal stops being a decision and becomes a default. `security-reviewer` probes for premature contact
reveal on every slice; records make that class of bug unreachable by construction rather than by
review. `@Value` would preserve that, but then we have surrendered the mutability that was the entire
argument for switching.

Two framework details also favour records: `JwtProperties` is a `@ConfigurationProperties` record
using `@DefaultValue` constructor binding (the idiomatic Spring Boot 3+ form), and records
deserialize natively on Jackson 3 with no annotation processor involved — where Lombok's
`@Jacksonized` still warns until told which Jackson generation to target.

There are **73 records** in the codebase, 16 of them carrying real behaviour (static factories,
nested types, compact constructors). Converting them would be a large diff that makes the code longer
and the security posture weaker.

### Why Lombok is right for entities

Entities cannot be records — JPA needs a no-arg constructor and mutable fields — so the accessor
boilerplate is unavoidable *by hand*. It is substantial: `catalog/property/Property.java` is 623
lines, of which **96 are accessor declarations** (~290 lines once bodies and braces are counted,
roughly 46% of the file). Across **62 entities** that is a few thousand lines nobody reads, reviews,
or benefits from.

Lombok removes essentially all of it. That is the whole win, and it is worth having.

### What the survey actually found

Counted before converting anything, across all 62 entities:

| | |
|---|---|
| Entities | **62** (this section originally guessed 34) |
| Fields | 485 |
| Hand-written **trivial getters** | 476 |
| Hand-written **trivial setters** | **139** |
| Accessors with real logic | 4 |

**The asymmetry is the finding.** Roughly **345 fields have no setter at all** — they are
constructor-set by design, and that is deliberate. `City` says so in its own Javadoc: *"Reference
data — seeded, never written by application code, so no setters."* A class-level `@Setter`, as
this section first prescribed, would have generated a public setter for every one of those 345
fields and quietly undone the immutability each entity was written to have.

So the correct translation is **class-level `@Getter` + field-level `@Setter` only where a setter
already existed**. That reproduces the previous public API exactly: after conversion the count of
`@Setter` annotations is **139**, matching the 139 setters removed.

Three further details the survey settled:

- **Boolean naming: 0 collisions.** Lombok emits `isX()` for primitive `boolean` and `getX()` for
  the `Boolean` wrapper. The codebase already followed exactly that convention, so no call site or
  mapper had to change. `Property.negotiable` is the wrapper case and keeps `getNegotiable()`.
- **9 fields have no getter and must keep none**, so they carry `@Getter(AccessLevel.NONE)` with a
  Javadoc giving the reason. Three are `idempotencyKey` (`Boost`, `ServiceOrder`, `Subscription`) —
  dedupe keys that must never reach a response body; `Referral.handledReason` is fraud-desk
  internal; `ReferralCode.createdAt`/`updatedAt` and `DealParty.updatedAt` are bookkeeping columns
  nothing reads. The sharpest two are `ReviewChecklistItem.review` and `ReviewMessage.review`:
  `@ManyToOne` back-references where a getter completes the `PropertyReview → children → review`
  cycle and makes the graph serialisable into **infinite recursion**.
- **4 accessors carry real logic and stay hand-written**: `Property.isPubliclyVisible()`,
  `OtpCode.isExpired()`, `RefreshToken.isExpired()` (all computed, with no backing field, so Lombok
  cannot collide with them) and `DocumentRequest.setCategories()`, which makes a defensive copy.

### Why the ban list is non-negotiable

| Banned | Reason |
|---|---|
| `@ToString` | **The sharp one.** Slice 3 ensured `User.mobile` is masked at every edge and `masked_aadhaar` never reaches a log. A generated `toString` on `User` or `IdentityVerification` re-opens exactly that hole through the back door — one `log.debug("{}", user)` away. |
| `@EqualsAndHashCode` / `@Data` | Generated `equals` spans all fields on a JPA entity: it triggers lazy loads, and identity changes when the id goes null→assigned, silently breaking `Set` membership across a persist. |
| `@Builder` | Fights the current design, where constructors like `new Property(owner, title, deal, type, price, locality, city)` *are* the invariant. A builder makes every required field optional again. |

The ban lives in `backend/lombok.config` — `flagUsage = ERROR` (never `WARNING`; a warning in a
build that prints thousands of lines is a rule nobody enforces) for `toString`, `equalsAndHashCode`,
`data`, `builder`, `value`, `allArgsConstructor`, `requiredArgsConstructor` and `sneakyThrows`. It is
enforced by the compiler, not by whoever reviews the PR.

**Verified, not assumed:** injecting `@ToString` onto `City` fails the build with
`Use of @ToString is flagged according to lombok configuration`. Repeat that check if the config is
ever moved — Lombok finds it by walking *up* from the source file, so relocating it silently
disarms every rule.

### Known cost, priced in

Lombok + MapStruct is the ecosystem's most notorious annotation-processor ordering problem; it needs
`lombok-mapstruct-binding` in the correct slot in `annotationProcessorPaths`. This project has
already lost time twice to processor and build-path issues (the `target`/`target-cli` collision, and
the MapStruct object-factory bug that silently blanked verified badges), and `pom.xml` carries
comments about both. Compatibility itself is **not** a blocker: Lombok has supported JDK 25 since
1.18.40 and Jackson 3 since 1.18.44/46.

**Do this as its own commit with a green `mvn verify`, never folded into a feature slice.**

### How it actually went

The processor-ordering problem was real but tractable. `annotationProcessorPaths` is ordered
**lombok → lombok-mapstruct-binding → mapstruct-processor**, and that order is load-bearing.
Rather than trust it, the generated `CityMapperImpl.java` was read to confirm MapStruct is calling
Lombok-generated accessors (`city.getSlug()`, `city.getName()`, `city.isLive()`). Repeat that check
if anything looks off. The failure mode is at least loud, not silent: `PropertyMapper` sets
`unmappedTargetPolicy = ERROR`, so a mis-ordered processor fails the compile with "Unmapped target
property". **Do not "fix" that by relaxing the policy.**

One constraint worth remembering: builds here run **offline**, and the Boot 4.1 BOM manages Lombok
**1.18.46**, which is not in the local repository (1.18.44 is the newest cached). `pom.xml`
therefore pins `<lombok.version>1.18.44</lombok.version>`. That is not a compromise — JDK 25
support landed in 1.18.40 and Jackson 3 in 1.18.44. Drop the pin once the network allows resolving
1.18.46.

---

## 2. Decided: validation framework — three layers, one shared package

**Status:** ANALYSED, decided, not implemented. **Trigger:** after the last backend feature slice.
**Owner:** backend. Register rows: D23–D25 — **D23a and D25 are delivered (§5); D23 alone
remains, blocked on Q1.**

### The question asked

*"Can we have a separate package handling validation from a single point?"*

### The answer: for one of the three things "validation" means, yes

A validation spine already exists and is sound — Bean Validation on DTO records, rendered by the
single `common.error.GlobalExceptionHandler` into `422 ValidationProblem { fields[] }`, with four
handlers covering request bodies, path/query params, method-level validation and programmatic
constraints. **That does not change.** The gap is consistency, not capability, and it is only in one
of three layers:

| Layer | Question it answers | Home | State today |
|---|---|---|---|
| **Format / syntax** | "Is this a well-formed Indian mobile / IFSC / account number?" | **nowhere — copy-pasted** | ❌ the actual gap |
| **Vocabulary** | "Is `mode` one of `physical\|virtual`?" | feature constants (§7.1) | ⚠️ right pattern, ~60% applied |
| **Domain invariant** | "May this caller accept this offer, in this state?" | the owning service | ✅ already correct |

### The evidence — this is a live contract violation, not a style preference

The OpenAPI spec defines **one** `Mobile` schema (`pattern: '^[6-9][0-9]{9}$'`) `$ref`'d by 21
fields. Java re-spells it inline **five times with four different messages**, and three of those
were wrong — one more than this section originally recorded:

```java
// DealCloseRequest.java:17  and  DealPartyCreateRequest.java:16  (before D23a)
@Pattern(regexp = "^[0-9]{10,15}$", message = "must be a 10–15 digit mobile number")
String counterpartyMobile

// ConversationCreate.java  (before D23a) — no pattern at all
@NotBlank @Size(max = 20) String counterpartyMobile
```

Spec line 4002 says `counterpartyMobile: { $ref: '#/components/schemas/Mobile' }`. **And it had a
second-order effect:** `MobileMask.mask()` deliberately returns `null` for anything that is not
exactly 10 digits, and `DealService.addParty` stored `body.mobile()` unnormalised. So a 15-digit
`counterpartyMobile` was accepted, stored, and then silently serialised as `null` on every masked
read. A validation inconsistency became a data-integrity bug — which is the general argument for
this work stated concretely.

**The three regexes are fixed (D23a, done).** What remains under D23 is the shared package below,
which removes the *cause* rather than this instance of it — and that is still blocked on Q1.

Also inline where a §7.1 constant should exist: `unfurnished|semi-furnished|furnished` (duplicated
across `ListingCreate` **and** `ListingUpdate`), and `^(accept|decline|counter)$` in
`OfferRespondRequest` — a file that declares `ACCEPT`/`DECLINE`/`COUNTER` constants and then does not
compose its own regex from them.

### What goes in the shared package (D23)

A deliberately small `com.punenest.api.common.validation`, sibling to `common.error`:

```
common/validation/
  IndianMobile.java         @Constraint → ^[6-9][0-9]{9}$
  Ifsc.java                 ^[A-Z]{4}0[A-Z0-9]{6}$
  BankAccountNumber.java    ^[0-9]{9,18}$
  ValidationMessages.java   message strings, so every 422 body reads identically
```

**What actually shipped, and why it differs (D25).** The package exists, with one file:
`Formats.java`, holding the mobile pattern **and its message together**. Two corrections to the
sketch above, both learned by doing it:

1. **A separate `ValidationMessages` is the bug, not the fix.** The message exists only to say in
   English what the regex says in symbols. The moment they live in different files, changing one and
   not the other is a one-line mistake nothing catches — which is exactly how one rule came to be
   described three ways. Paired constants were already the house style (`PropertyPossession`,
   `Furnishing`, `DealIntent`); this is that style, not a new one.
2. **`Ifsc` and `BankAccountNumber` did not move**, because this section's own admission criteria
   exclude them: each appears at exactly **one** call site (`PayoutAccountUpdateRequest`), as do PAN
   and Aadhaar (`OwnerKycUpdateRequest`). Hoisting a rule with one caller builds the dumping ground
   the criteria exist to prevent, and moves `identity.kyc`'s rules out of `identity.kyc`.

`@IndianMobile` — the composed `@Constraint` — is what is still outstanding under D23, and it is
still blocked on Q1, which decides what the regex *is*. D25 was only ever about there being one of
it, and `foundation/SharedFormatsTest` now fails the build on a tenth inline copy.

Composed **meta-annotations** over `@Pattern` — no `ConstraintValidator` implementations are needed
for any of these. Roughly 4 small files and ~15 call-site edits, with **zero new runtime behaviour**
beyond what D23a already landed — the regexes are now correct at each site; the package is about there being one site.

This is the same argument that already justified `common.trust.MobileMask`, whose own Javadoc records
that it was created *because* three divergent digit-stripping helpers had appeared. `common.validation`
is that precedent applied to input rather than to output.

**Admission criteria — so it cannot become a dumping ground.** A rule belongs here only if it is
(1) used by ≥2 bounded contexts, (2) defined by the OpenAPI spec, and (3) dependency-free. Anything
that fails all three stays in its feature.

### What does NOT move, and why

**Vocabulary stays feature-owned** (`api-standards.md` §7.1 is right). Centralising
`ContactRequestStatuses` beside `OfferStatuses` beside `VisitModes` builds a package that every
feature imports *and* that imports every feature's concepts — precisely the coupling
`package-structure.md` forbids, and the thing that makes later service extraction stop being
mechanical. Contact-request status is meaningful only inside `leads.contact`.

**Domain invariants stay in services. This is the trap in the original question.** The "single
point" instinct tends to produce a `ValidationService`. Consider what `OfferService.respond()`
actually enforces: caller is buyer-or-owner (needs the JWT plus two repositories), accept/decline is
owner-only, `counterAmount` is required when countering, and `OfferStatuses.canTransition`. To
centralise that, the validation package would have to inject `OfferRepository`,
`PropertyRepository`, `DealRepository`, `ContactRequestRepository` and `UserRepository` — then repeat
that for 32 other services. It inverts the dependency graph into a god-package and separates each
rule from the transaction that makes it atomic. **A service enforcing its own invariants is not
scattered validation; that is what a service is.**

### Sequencing

The `common.validation` package and the §7.1 cleanup (D24) are one clean standalone commit. The
`counterpartyMobile` fix (D23a) is separable and cheap, and is a contract violation rather than debt
— **it can be pulled forward into any slice that touches `deals` without waiting for the rest.**

One prerequisite is a decision, not code: `MobileMask.normalise()` accepts `+91 9821000123` while
the DTO `@Pattern` rejects it. Those two disagree about what a valid mobile is, and the shared
annotation cannot be written until that is settled — see `open-questions.md` Q1.

---

## 3. Decided: code quality — the measured baseline

**Status:** DONE — implemented after slice 15, the last feature slice. **Owner:** backend.
Applied to all **62** entities; `mvn -o verify` green at **646 tests, 0 failures** — the identical
count to before the refactor, which is the proof that it changed no behaviour.

The brief was "improve readability, cut unnecessary lines, reuse code, keep classes under 500–600
lines". Rather than assert where the fat is, it was **measured**. The measurements changed the
answer, so they are recorded here — a register row without the number behind it gets re-argued.

### The measurements

Taken across `backend/src` at the close of slice 8.

| Metric | Value | Reading |
|---|---|---|
| Main source | 330 files, 22,143 lines | — |
| — comments | **9,458 (42.7%)** | near 1:1 with code; the largest single block of removable text |
| — blank | 2,839 (12.8%) | normal |
| — code | 9,846 (44.5%) | — |
| Main files > 500 lines | **2** | `Property.java` 623, `Routes.java` 591 |
| Largest service | `RentService` 405 | healthy, but trending up |
| `@param` tags | **562** | vs only **26** `@return` — a 20× asymmetry |
| — of which ≤ 4 words | **232** | pure ceremony; restates the parameter name |
| Test source | 36 files, 9,292 lines | |
| Test files 400–647 lines | **13** | `RentEndpointsTest` 647 is the only file in the repo over 600 |
| Shared test fixtures | **1** (`support.AbstractApiTest`, D34) | was: 34 classes injected `JwtService`, **26 hand-rolled a byte-identical `bearer()`** |
| Static-analysis plugins in `pom.xml` | **0** | no checkstyle / spotless / pmd / spotbugs / archunit |
| `package-info.java` files | **0** | across 22 bounded contexts |

### What the numbers actually say

**Class length is already a solved problem — do not act on it.** Only two main files exceed 500
lines, and neither should be split:

- `catalog/property/Property.java` (623) is 89 lines of hand-written accessors. **D1 (Lombok on
  entities) alone takes it to ~250.** No structural change is needed; the fix is already in §1.
- `common/web/Routes.java` (591) is a deliberate flat constant registry (`api-standards.md` §2.1).
  **Its length is the feature** — one file you can grep for every route. Splitting it by feature
  would reintroduce exactly the scatter the rule exists to prevent. **Argue against any future
  proposal to split it.**

The real waste is in two places the brief did not name: **the 42.7% comment ratio** and **test
fixture duplication**. Together with the accessors, roughly **1,200 lines (≈4% of the codebase) are
removable with zero behaviour change** — 232 `@param` lines + ~370 accessor lines + 600–900 lines of
test duplication.

### The items

| Ref | Item | Register row |
|---|---|---|
| C1 | Trim `@param` ceremony (~230 lines) | D33 |
| C2 | Shared test fixtures (`AbstractApiTest`) | **D34, delivered** — see §5. The `Fixtures` half was refused, not done |
| C3 | Lombok on entities | **D1, delivered** — see §5 |
| C4 | `NotFoundException.of("Property")` factory | D35 |
| C5 | Collapse the bespoke exception subclasses | **rejected** — see §5 |
| C6 | Formatter + linter + boundary tests in `verify` | D36 |
| C7 | Service-split trigger at ~450 lines | D37 |
| C8 | One `package-info.java` per bounded context | D38 |

Effort-to-value order was **D34 > D33 > D36 > D38 > D37 > D35**. D34, D1 and D35 are done; of what remains, **D33 is blocked** until `api-standards.md` §10 is amended (deleting the lines without changing the rule that mandates them just grows them back), so the live order is **D36 > D38 > D37**.

### D33 — trim the `@param` ceremony, and amend the rule that caused it

562 `@param` against 26 `@return` is not documentation, it is a habit. **232 of them are ≤4 words**
and restate the parameter name: `@param city → city (required)`, `@param lat → latitude, nullable`,
`@param name → display name`, `@param bhk → bedroom count, nullable`. The remaining 330 carry real
information and **stay**.

There is a second, stronger argument than brevity: the `(required)` / `nullable` suffixes **duplicate
the `@NotBlank` / `@Nullable` annotation on the very next line**. That is two sources of truth for
one fact, and the Javadoc is the one that will silently drift when the annotation changes.

**This item is not complete without amending `api-standards.md` §10**, which currently requires
Javadoc on every public type and method and is therefore the direct cause of the 232 lines. The
replacement rule: *document a component only when its name does not already say it; never restate
what an annotation enforces.* Delete the lines without changing the rule and they grow back.

### D34 — shared test fixtures (done)

**Done.** The census, re-counted before the work rather than trusted from the original estimate,
was worse than recorded here: **35** classes autowired `MockMvc`, **34** `JwtService`, **19**
`JdbcTemplate`, and **30** declared a `bearer()` of which **26 were byte-identical**. Field naming
was already 100% uniform (`mvc` / `jwtService` / `jdbc`), and all 25 standard-`bearer()` classes
carried exactly `@SpringBootTest + @AutoConfigureMockMvc + @Transactional` — uniform enough that a
base class was safe.

`support/AbstractApiTest` now carries those three annotations, the three fields, and `bearer(User)`.
**34 classes extend it**; `bearer()` copies fell 30 → 5 and identical bodies 26 → 0, removing
≈400 lines. `services/ServiceFixtures` — which held a 27th copy — extends it too and keeps only
what is genuinely slice-11's: the team-scoped `staff()` builder and the multipart helpers.

A base class rather than the `@TestComponent` originally sketched, because
`@SpringBootTest`/`@AutoConfigureMockMvc`/`@Transactional` must sit on the test class or something
it inherits — they cannot be injected. Once a superclass exists for them, the fields belong there
too. Spring resolves all three up the hierarchy; the full suite staying green at 650 with no
unique-constraint failures is the proof that `@Transactional` in particular is still being applied.

**`user()` and `listing()` were deliberately left alone.** 24 `user()` declarations have **19
distinct bodies**; 16 `listing()` have 9. They differ in display name, locality, price and status
— that is, they encode each test's preconditions. Hoisting them means either an unreadable
parameter list or a default that silently changes what a test asserts. The `Fixtures`
`@TestComponent` half of this item is therefore closed as **not worth doing**, not as done.

### D36 — formatter first, linter second (config stored, baseline measured)

**The config is already in the repo:** `backend/config/checkstyle/checkstyle.xml`, seeded from the
Google Java Style config supplied by the project owner. The two supplied files
(`checkstyle.xml`, `checkstyle-checker.xml`) were **byte-identical** — same SHA-256 — so one copy is
stored, not two. It was copied *into the repo* deliberately: a build must not depend on a path
inside someone's personal OneDrive.

**One change was required to make it run at all:** the supplied file is an older revision that
declares `LineLength` under `TreeWalker`. Checkstyle moved that module to `Checker` in 8.24, so as
supplied it fails with *"TreeWalker is not allowed as a parent of LineLength"*. The module has been
hoisted to `Checker` level in the repo copy; nothing else was altered.

**Measured baseline — 717 violations across 333 main-source files** (Checkstyle 10.13.0). Test
sources were not scanned in this run, so the true figure is higher.

| Count | Rule | Who should fix it |
|---|---|---|
| 357 | `ImportOrder` | **A formatter.** The config also enables `CustomImportOrder`, which is duplicative and near-contradictory; and `groups=java,javax,com,org` does not match Spring Boot convention. Half the baseline, and no human should touch any of it. |
| 208 | `SingleLineJavadoc` | **Nobody — drop the rule.** It forbids `/** One line. */`, which is exactly the terse form D33 moves *toward*. Enforcing it would make the codebase worse. |
| 43 | `RightCurlyAlone` | A formatter |
| 37 | `LeftCurly` | A formatter |
| 31 | `EmptyLineSeparator` | A formatter |
| 13 | `OperatorWrap` | A formatter |
| 6 | `JavadocTagContinuationIndentation` | A formatter |
| 5 | `Indentation` | A formatter |
| 3 | `SummaryJavadoc` | Nobody — same conflict as `SingleLineJavadoc` |
| 2 | `JavadocParagraph` | A formatter |
| 7 | `OneTopLevelClass` | **A linter — genuine finding** |
| 2 | `LocalVariableName` | **A linter — genuine finding** |
| 2 | `VariableDeclarationUsageDistance` | **A linter — genuine finding** |
| 1 | `OverloadMethodsDeclarationOrder` | **A linter — genuine finding** |

Which totals: **494 auto-fixable layout · 211 rules to delete · 12 genuinely semantic.**

### The finding that changes the tool choice

**12 of 717 violations (1.7%) actually need a linter.** The other 98% either delete themselves with
the rule, or are layout a formatter rewrites in one command without asking anyone's opinion.

That is the argument against making Checkstyle the centrepiece. Checkstyle **reports**; it does not
**fix**. Adopting it as designed here means assigning a human ~494 mechanical edits, then relying on
that human to re-do them forever — which is precisely the failure mode that produced the 232 `@param`
lines in the first place. A rule that a machine can enforce should never be enforced by a person.

### Versions: we are behind, but that is the smaller problem

| | In use | Current | Gap |
|---|---|---|---|
| Checkstyle engine | **10.13.0** (Jan 2024) | **13.9.0** (2026-07-27) | 3 major versions |
| `maven-checkstyle-plugin` | 3.4.0 | 3.6.0 | plugin absent from local cache |
| Style config | Google style, **pre-8.24** | — | old enough that `LineLength` was still under `TreeWalker` |

Two consequences worth naming:

- **13.x removed `JavadocStyle`** and reworked the Javadoc AST; the supplied config would need real
  work, not a version bump, to run on it.
- **10.13.0 predates Java 22–25 syntax.** This project is **Java 25 / Spring Boot 4.1**. It parsed
  today's 333 files only because nothing yet uses post-21 syntax — that is luck, not compatibility.
  The first flexible constructor body or module import declaration breaks the build step.

### The better shape: three tools, each doing what it is actually good at

1. **Spotless (Maven plugin 3.9.0) + a Java formatter — owns all 494 layout violations.**
   `mvn spotless:apply` fixes them in seconds; `spotless:check` bound to `verify` stops them coming
   back. No ruleset to maintain, no style debates, zero human edits. Prefer `palantir-java-format`
   over `google-java-format`: the Google formatter forces 2-space indent (a far larger diff against
   this codebase) and needs `--add-exports` flags because it reaches into `javac` internals.
   **Verify the chosen formatter actually runs on JDK 25 before committing** — both reach into
   compiler internals and that is where they break first.
2. **A bug finder — the gap Checkstyle cannot fill.** Checkstyle found **zero defects** in 717
   findings, because it does not look for any. Error Prone (annotations 2.43.0 are already in the
   local cache) catches null dereferences, `equals` across unrelated types, format-string mismatches
   and ignored return values. On Java 25 it needs `-XDcompilePolicy=simple` plus add-exports — real
   friction, so treat it as its own decision, not a freebie.
3. **Boundary rules — the ones that actually matter here**, and the only ones
   specific to this codebase rather than to Java in general.

**Checkstyle then shrinks to a ~12-rule residual config** covering only the semantic checks above —
or is dropped entirely and those 12 issues fixed once by hand. Either is defensible; what is not
defensible is a 253-line config and a build step whose real yield is twelve findings.

### Why none of this happens today

- **Maven cannot reach the corporate Artifactory** (`artifacts.mastercard.int` — connect timeout), so
  nothing new can be resolved. Locally cached and usable: Checkstyle 10.13.0, `maven-checkstyle-plugin`
  3.4.0. **Absent:** Spotless, PMD, SpotBugs, google/palantir-java-format, ArchUnit. OpenRewrite's
  libraries are cached (8.70.3, including `rewrite-java-25`) but its Maven plugin is not.
  So the honest position is: today the only runnable option is the stale one. **Do not wire a
  half-measure into `verify` to feel productive.**
- **A repo-wide reformat collides with in-flight work.** The trigger stays "after the last feature
  slice" for a concrete reason: on 2026-07-31 a `documents` + `identity/kyc` slice was being written
  while this assessment ran. Reformatting 330 files under an active slice buys a merge conflict in
  every one of them.

**When it does happen:** land Spotless first (mechanical, uncontroversial, deletes 494 findings),
then decide whether the residual 12 justify keeping Checkstyle at all. (The boundary half is already delivered — D3, without an ArchUnit dependency.) Do not
switch anything to `failOnViolation` on the first commit — 330 files have never been linted.

**And note the conflict rather than importing it silently:** `SingleLineJavadoc`, `SummaryJavadoc`
and any `JavadocMethod`-style rule pull directly against D33 and the `api-standards.md` §10
amendment. The style config follows the house rule; it does not overrule it.

### D37 — service-split trigger

Services top out at 405 lines and are trending up. Agree the rule now, while it is free and nobody is
defending a specific file: **past ~450 lines, split by use-case, never by layer.** A `RentService`
that grows becomes `RentBillingService` + `RentPaymentService`, never `RentServiceHelper` — a helper
class named after its parent is a file split, not a design.

### D38 — `package-info.java` per bounded context

Zero exist across 22 contexts. One short file per context stating what it owns and what it may not
import lets class-level Javadoc **stop re-establishing context in every file** — so this is a net
*reduction* in comment volume, not an addition. It also gives the delivered boundary rules (D3) a documented home,
which is what turns the boundary rules from folklore into something checkable.

---

## 4. Open register

**60 open.** Twenty-two items sit in §5 — the 13 lifted by the register audit, then D24, D35,
D40, D74, D75, and most recently D48, D25, D66 and **D81**.
**5 High**, 2 Med-High, 32 Med, 21 Low. Largest clusters: `design` 15, `security` 7, `frontend` 5.

**D81 was opened and closed the same day** — the dev database could not boot, could not be repaired
forward, and held the only copy of the demo catalogue. It is now rebuilt from a committed Flyway
seed and reproducible from empty. See §5.

> **API-polish pass (pre-integration).** The backend was reviewed end to end before frontend
> integration started. Five defects were found and fixed rather than recorded — they were bugs, not
> debt (rule 2): the 400 handler echoed Jackson's message verbatim, 405/415 were being swallowed into
> 500s by the catch-all, `server.servlet.context-path=/api` was documented everywhere and set
> nowhere, `punenest.web.cors.allowed-origins` was unset in prod, and the foundation-field rule
> covered five of the seven search facets, so an approved listing could be relabelled "furnished" or
> "ready to move" without re-moderation. Four endpoints were added (`listPropertyRooms`,
> `updateSavedSearch`, `listListingBoosts`, `listReviewsForModeration`) and four reads paged. Suite:
> 705 → 733 tests, green. The pass also *created* five new entries — D76–D80 below — because several
> fixes revealed adjacent problems that were out of its scope.

**The five High items are all blocked on something other than effort**, which is the single most
useful fact about this list:

| # | What it needs |
|---|---|
| D2 | a rate-limiter design (pairs with D73 — one atomic principal-keyed counter answers both) |
| D22 | Google Cloud console access to rotate the key |
| D57 | a scheduler — nothing in the platform runs on a timer yet |
| D59 | a ranking design: what a paid boost is actually worth against relevance |
| D67 | a wire-or-remove call on `settings.permissions` / `customRoles` |

**Actionable today without any decision** — the honest short list is now short. **D38**
(`package-info.java` per context) is the only one of any size, and it is 22 files of prose whose
value depends entirely on the prose being accurate; done shallowly it is worse than not done.
**D46**, **D49** and **D60** are one-liners, but each of the three is explicitly waiting on a
consumer that does not exist — an unassign gesture, a message attachment, a share channel — and
building the field before the caller is how the register filled up with `settings.permissions`
(D67).

**D36** (Spotless) is blocked on repo access, not on a decision. **D54** turned out to need more
machinery than its Low priority justifies — see its trigger. Everything else above the one-liners
now needs a product or infrastructure decision rather than an afternoon, which is the useful summary
of this list: **the backlog that could be worked around is worked; what is left is what was
deferred on purpose.**

`P` = rough priority. `T` = what unblocks it.

| # | Item | Area | P | Owner / Trigger |
|---|---|---|---|---|
| D2 | Rate limiting on **authenticated writes**, plus the anonymous `GET /documents/shared` | security | **High** | platform / first real deploy |
| D4 | `CashfreePaymentGateway.createOrder` live HTTP | payments | Low | whoever obtains the merchant account |
| D5 | Owner `hideNumber` preference (`users.hide_number`) | product | Low | product decision first |
| D7 | Saved-search alerting job writing `new_count` | engagement | Low | needs a scheduler |
| D9 | Frontend still computes the platform fee | frontend | Med | rent-UI integration slice |
| D10 | Refresh-token pruning job | auth | Low | when the table grows |
| D11 | `role` / `status` as `String`, not enums | style | Low | — (deliberate, see §5) |
| D12 | Staff-login timing equalisation | security | Low | if staff enumeration becomes a concern |
| D13 | Scoped-staff `roleId` / `moduleAccess` | admin | Med | admin slice (needs spec + backend) |
| D15 | Notification preferences (R9) | engagement | Low | no table, no contract |
| D16 | `reels.locality` holds display names, not slugs | catalog | Low | frontend integration slice |
| D17 | Legacy `enquiries` surface — implement or formally deprecate | leads | Med | needs a product call |
| D19 | Residual mojibake in 7 e2e specs (comments/titles only) | hygiene | Low | cosmetic |
| D20 | `ProfileTab.save` sends `city`, absent from `UserUpdate` | frontend | Low | silently dropped on http |
| D21 | Verify-funnel Playwright coverage (modal → mock → badge) | e2e | Med | e2e owner |
| D22 | **Rotate `VITE_GOOGLE_MAPS_API_KEY`** | security | **High** | real key is in git history (2 commits) |
| D23 | `common.validation` shared format package (§2) | backend | Med | backend / blocked on Q1 |
| D26 | Frontend derives trust client-side (`applyVerifiedBadgeToListings`, `isSeriousBuyer`) | frontend | Med | moot on `http` flip; live in mock mode |
| D28 | e2e `expect(errors).toEqual([])` assertions are network-dependent | e2e | Med | flaky offline / in CI |
| D29 | e2e `services-loans-team.spec.js` failing (pre-existing) | e2e | Med | e2e owner |
| D30 | Owner-scoped mock stores keyed on owner **mobile**, not `ownerId` | frontend | Med | Phase 3/4 integration |
| D32 | ProfileTab identity chips are hardcoded English | i18n | Low | ProfileTab i18n pass |
| D33 | Trim 232 ceremonial `@param` lines + amend `api-standards.md` §10 (§3) | quality | Med | backend / after last feature slice |
| D36 | **Formatter-first**: Spotless owns layout, Checkstyle shrinks to ~12 semantic rules (§3). The boundary third is already delivered by `ArchitectureBoundaryTest` (D3), so this is now a two-tool question, not three | build | Med | backend / blocked on repo access (Spotless is not in the offline repo) |
| D37 | Service-split trigger at ~450 lines, by use-case not layer (§3) | architecture | Low | agree now, apply on next service that crosses it |
| D38 | One `package-info.java` per bounded context (§3) | architecture | Low | with D36 — its original trigger, D3, is delivered |
| D41 | Deleting a document leaves its object in the store — needs a bucket lifecycle rule | storage | Low | with the real object store |
| D42 | Share token travels as a query parameter — any request logging that is turned on must exclude `token` | security | Med | platform / first real deploy |
| D44 | **Service requests are not team-scoped** — `service_requests` has no `team` column and `type` is free text, so every ops user sees every request while tickets are desk-scoped. Inferring a desk from `type` would silently hide work the day a new type appears | design | Med | when the service catalogue is a closed vocabulary (Billing & Growth slice) |
| D45 | **A ticket and a service request do not mirror each other** — the ops board and the customer's workflow are two tables with no link, so ops working a request has to find the ticket by hand | design | Med | with the Services & Support slice (`/support-tickets`) |
| D46 | **`TicketUpdate` cannot unassign** — a record cannot distinguish an absent field from an explicit `null`, so `assigneeId: null` is read as "leave it". Needs a sentinel or a dedicated endpoint | design | Low | when ops asks for it |
| D47 | **`TicketDto` carries internal notes** and is returned to the customer who created the ticket. Safe today only because a new ticket has none; it must be split before the board gains any customer-facing read | security | Med | before `/support-tickets` exposes a ticket to its raiser |
| D49 | **`MessageCreate.attachments` is accepted and dropped** on both message surfaces, matching the `PropertyVerification` precedent. The wire field exists, the behaviour does not | contract | Low | when the frontend actually attaches files to a message |
| D50 | **Ops has no unread signal on support tickets** — `support_tickets.unread` is a single boolean, so it had to mean one thing: "a reply the raiser has not read". A staff member cannot see which tickets have a customer reply waiting. Needs a second column or a per-side read table, not an overload of this one | design | Med | when a support queue screen exists |
| D51 | **No platform-wide support list** — S47 narrowed `GET /support/tickets` to the caller's own for every role, because "every support conversation on the platform" as one unpaged array is a PII export. Admin therefore has no support overview | design | Med | with the Admin & Analytics slice, as a paged `/admin/support-tickets` |
| D52 | **The frontend models a conversation `state`** (`active`/`incoming`/`pending`) in `frontend/src/lib/chat.js` that the contract has no field for. The contract wins; the UI will need either a derived value or a spec change | contract | Low | when the React client is wired to the real API |
| D53 | **A conversation is not moderatable** — participants only, staff and admin included, so a reported chat cannot be read by anyone. Deliberate (a role check hidden inside the participant guard is how private surfaces quietly stop being private), but moderation will need its own audited endpoint | design | Low | when abuse reporting covers messages |
| D54 | **Find-or-create on a conversation races to a 409** — two simultaneous first messages produce one row and one unique-index violation. Downgraded from a 500 in slice 13: `GlobalExceptionHandler` now maps `DataIntegrityViolationException` platform-wide. The loser still does not get handed the existing thread, it just gets a truthful status | reliability | Low | when a client complains — but **not** by catching the violation and re-reading: a constraint violation dooms the JPA transaction, so the retry has to happen outside it (a `REQUIRES_NEW` helper bean or a controller-level retry), which is more machinery than a truthful 409 and a client retry are worth today |
| D55 | **`sameDevice` and `sameIp` on a referral are always false** — no device fingerprint is captured anywhere and the request IP is not recorded, so the two strongest self-referral signals are absent from the fraud desk. Reported as `false` rather than omitted because the contract requires the fields; an absent signal is safer than a fabricated one, but the desk is working blind on exactly the fraud it exists to catch | design | Med | when request-IP capture lands (needs a proxy-header policy first) |
| D56 | **The `qualified` referral status is never produced** — a referral goes `pending` → `rewarded`/`rejected`. `qualified` was meant to mean "the invitee did something real", but nothing tracks invitee activation, so staff approve on judgement alone | design | Med | when there is an activation event worth gating on (first listing, first lead, first payment) |
| D57 | **`past-due` and `expired` subscriptions are never produced** — both statuses exist in the contract and in `SubscriptionStatuses`, but nothing ages a subscription past its `endsAt`. A lapsed paid plan keeps entitling forever until a human intervenes | reliability | **High** | before the first paid subscription renews — needs a scheduled job, which the platform does not yet have |
| D58 | **A service order has no status-advance endpoint** — `ServiceOrder.status` and `amount` can only change by direct SQL. Ops can take an order but cannot quote it, progress it or close it through the API | design | Med | with the ops back-office slice |
| D59 | **A boost does not influence search ranking** — `boosts` records a paid window and `PropertySearch` ignores it entirely, so the thing being sold does not yet do anything. The window is recorded correctly, which is what makes this safe to defer, not correct to ship. *(Narrowed by the API-polish pass: `GET /me/properties/{propId}/boost` now exists, so an owner can at least see the window they bought. What is still missing is the window doing anything.)* | design | **High** | before boosts are sold to a real customer |
| D60 | **`Referral.channel` is derived from the referrer's role, not from how the link was shared** — there is no share-channel parameter on redeem, so the field describes the wrong dimension. Harmless until someone builds a report on it | contract | Low | when redemption carries a share context |
| D61 | **Referral farming is caught by humans, not by code** — one person with several mobile numbers can redeem repeatedly; only `uq_referrals_referred_mobile` and the staff fraud desk stand in the way. Deliberate: automated velocity blocks would reject genuine roommates and flatmates, which is the platform's most common referral. Revisit only with D55's signals in hand | design | Med | when the reward budget makes manual review too slow |
| D63 | **`payoutsCompleted` and `refunds` on `/admin/finance` are structurally zero** — no payout and no refund path exists anywhere on the platform (`payout_accounts` stores a destination and nothing writes a remittance). Reported rather than omitted so the figures move the day payouts ship instead of appearing from nowhere, but a finance screen showing four numbers of which two can never be non-zero invites the reader to trust all four equally | design | Med | with the payout execution slice |
| D64 | **Boost revenue is counted from `starts_at`, not from a payment record** — `BoostStatuses.EXPIRED` conflates "the window closed" with "the payment failed", so the status column cannot answer "was this paid". `starts_at` is set only by `activate`, which makes it the truthful marker today, but it is a proxy: the day a boost can be activated without payment, revenue silently overstates | reliability | Med | when boosts gain a comp/manual-grant path |
| D65 | **Service orders are excluded from platform revenue** — `service_orders.amount` is a quote, not a receipt, and the marketplace takes no money through the gateway, so counting it would report revenue the platform has not received. The consequence is that `/admin/finance` under-reports the moment the marketplace does start collecting | design | Med | when a service order has a payment path (see D58) |
| D67 | **`settings.permissions` and `settings.customRoles` are stored and never read** — the contract declares both, the settings endpoint round-trips both, and no guard anywhere consults either. Authorisation is `@PreAuthorize` on four fixed roles. An admin who edits the permission map will believe they have changed access control and will be wrong | security | **High** | before the settings screen renders a permissions editor — either wire it or remove it from the contract |
| D68 | **The abuse-report queue is absent from the admin dashboard** — `pendingModeration` counts `properties` awaiting a decision and deliberately does not fold in `reports`, because the two queues are worked by different people against different SLAs. The consequence is that the one scorecard ops looks at does not show the reports backlog at all | design | Med | when the dashboard grows a second queue tile |
| D69 | **The analytics series is computed on every request with no cache** — four grouped scans, up to 366 buckets, available to any staff account with no throttle beyond the bucket cap. Correct and cheap at today's data volume; the first slow morning will be this endpoint | performance | Low | when a table it scans passes ~1M rows |
| D70 | **A poster's only record of who answered is the notification stream** — the contract has no "who replied to my ad" endpoint and `share_flat_interests` is not readable over the API, so the sender's name and number exist for the poster only as a notification. Dismiss it and the lead is gone, with the row still sitting in the table | design | Med | when share-flat gets a second screen — needs a spec addition, so it could not be fixed inside the slice |
| D71 | **Nothing can take a share-flat post down** — `share_flat_posts.archived` is written by no code path and the contract declares no delete or archive operation, so the five-live-post cap can be reached and never relieved. The 429 message was reworded to say "contact us" rather than "archive one", because the obvious advice is advice to do something impossible | product | **Med-High** | the sixth post a real user tries to write — needs one spec operation |
| D72 | **Share-flat posts are published unmoderated** — they appear on a `security: []` page the moment they are written, with no queue, no report action and no takedown (D71). Every other public-facing thing a user writes (listings, reviews) passes a moderator first. The board is free-text `title` and `locality`, which is exactly where a broker puts a phone number to route around the contact rules | moderation | **Med-High** | before the board is linked from anywhere public — pairs naturally with D71 |
| D73 | **Every rate limit on the platform is check-then-write and therefore racy** — `OtpService`, `SocietyLeadService` and `ShareFlatService` all `countBy…` and then insert, with no lock between the two. Concurrent requests all read the pre-insert count and all pass, so a burst clears a cap that a serial client could not. Raised by `security-reviewer` against share-flat's ten-interests-per-hour cap, recorded platform-wide because fixing one caller and leaving two is worse than fixing none. Bounded in practice: every send carries the sender's own OTP-verified number, and the unique index still stops repeat contact of the same person | security | Med | with D2 — the same infrastructure (a principal-keyed limiter with an atomic counter) answers both, and neither is a per-service patch |
| D76 | **The client's foundation-field list disagrees with the server's, in both directions** — `lib/store/listings.js` names twelve fields; the server reverts on the seven *searchable* ones. The client warns on `title`/`area`/`facing`/`floor`/`age` (which do not revert) and stays silent on `price` (which does), so the UI both threatens re-moderation that will not happen and conceals the one that will. The server half is fixed and self-enforcing (`ListingFoundationTest` reads the facets by reflection); this is the client half | frontend | Med | before the listing domain flips to http — it is a wrong warning on the owner's most consequential edit |
| D77 | **Sixteen more per-user reads grow with inbound demand and are still unpaged** — `/me/contact-requests`, `/me/offers`, `/me/visit-requests`, `/me/flatmate-requests`, `/me/finalization-requests`, `/me/documents/requests`, `/me/deals`, `/visits`, `/tenancies` and others. Rows are written by *other* users, so §5.1's "one user's own actions" test does not apply to them; the successful owner is the one an unpaged read punishes. `/me/saved` and `/messages` were paged in the API-polish pass because they were the largest payloads; the rest were left because the shape change is breaking and the frontend has no consumer for them yet | design | Med | with each domain's http provider — page it in the same change that first reads it, not after |
| D78 | ~~**`/me/contact-requests` cannot be paged until a server-side pending count exists**~~ — **Closed in the contact integration slice.** `GET /me/contact-requests/pending-count` was added first and the inbox paged second, in exactly the order this entry prescribed. The badge now counts in the database (`countByPropertyIdInAndStatus`) rather than by filtering a downloaded array, so it stays correct past page one. `services/contactService.js` exposes the two as separate calls with a comment recording *why* the count is not derived from the page | design | — | **Closed** |
| D79 | **`GET /properties/{propId}/reviews` cannot be paged while the client computes the rating summary** — ruling D8.6 permits the unpaged read because the per-target UNIQUE index bounds it, and the property page computes the star average, the 1–5 distribution and the per-category averages from the full list. The bound is real, so this is not urgent; recorded because "page everything" applied here would make three visible numbers silently describe page one. `ReviewRepository` already has the aggregate query if the summary ever moves server-side | design | Low | only if the aggregates move server-side |
| D80 | **`FlatmateRoomDto` is 47 fields, by a distance the largest DTO on the platform** — the next largest is `PropertySummary` at 22. It is returned by the room feed, the mixed flatmates feed and now `GET /properties/{id}/rooms`. Not wrong today (rooms per flat is naturally small, and the derived occupancy fields are the point), but a 47-field row is a DTO that has stopped being a view of anything and become the entity with a different name | design | Low | if the flatmates payload ever needs trimming — split the feed shape from the detail shape |
| D82 | **The consumer dashboard renders the owner KPI strip twice** — `getByText('Total Views')` resolves to two identical `<p>` nodes, one of them inside a "View my properties" button, so `consumer/account/dashboard.spec.js:59` fails on a Playwright strict-mode violation. Confirmed pre-existing and unrelated to the contact slice: it reproduces identically on a clean tree at `7a2257f` (stash the working tree, re-run, same single failure). Found while baselining the contact integration. Not a contact bug, so it was left alone rather than folded into an unrelated change | bug | Med | next dashboard change — dedupe the strip, then tighten the assertion |
| D83 | **The home "Find a flatmate" rail routes to `?view=team-up`, but `consumer/home/flatmates-rail.spec.js:18` expects `?view=flatmates`** — one of the two is wrong and it is not obvious which: `team-up` may be a deliberate rename that the spec never followed, or a copy-paste from the neighbouring team-up CTA. Found while running the card suites for the saved slice; no flatmates file is touched by that change. Needs a product call on which view the rail should open, not just a spec edit | bug | Low | next flatmates change — decide the intended view first |
| D84 | **The alert switch is a boolean over a four-state server field** — `SavedSearch.alertFrequency` is `off\|instant\|daily\|weekly`, but the only control is an on/off `Switch`, so the seam derives `alerts = alertFrequency !== 'off'` and writes back `daily` when switched on. Currently unreachable loss (nothing can produce a non-default cadence), but the moment a frequency picker ships, a user holding `instant` who toggles off and on lands on `daily`. The seam carries `alertFrequency` explicitly so the fix is a UI change, not a contract change | design | Low | when a cadence picker is designed |
| D85 | **Anonymous alert capture has no server home** — `NotifyMeCard` and `FlatmateAlertCard` exist to capture a *signed-out* visitor's demand against a mobile number, but `POST /me/saved-searches` is caller-scoped and `SavedSearchCreate` carries no `mobile`, so the call would 401 for exactly that visitor. Both cards now split: signed in → the seam; signed out → localStorage as before, so the alert is still claimed on this device after sign-in. The http provider throws a named error rather than silently writing locally while every read comes from the server — that would produce an alert the user was told they created and can never see again | design | Med | needs a public demand-capture endpoint, or an explicit "sign in to create an alert" product decision |
| D86 | **`/flatmates?view=rooms` stores the tab as `move-in`** — `consumer/flatmates/alerts.spec.js` asserts a `rooms` alert round-trips with `tab: 'rooms'` and gets `move-in`. Same family as D83: a `view` query alias disagreeing with the stored tab vocabulary. Confirmed pre-existing — reproduces identically on a clean tree at `6b5ebba` with the saved-search work stashed. Two failures | bug | Low | fold into the D83 fix — the flatmates view/tab vocabulary needs settling once |
| D87 | **A visit cannot be rescheduled through the API** — the dashboard offers reschedule (pick a new slot, visit returns to `scheduled`), but `PATCH /visit-requests/{id}/status` carries a status and a note only, and there is no slot-update route. The http provider throws a named error rather than substituting cancel-and-rebook, which would mint a new id (breaking the row the UI holds), discard the visit's history, and hit the duplicate-visit 409 against the row it had just cancelled | design | Med | needs `PATCH /visit-requests/{id}` accepting a slot, or an explicit product decision that rescheduling is cancel-and-rebook |
| D88 | **`parseWhen` discards the year and reconstructs it from "now"** — the human `when` string carries a year (`"19 Jul 2026, 10:30 AM"`) but the parser matches only day + month and rolls forward when the result would be in the past. Harmless for upcoming visits, which is every visit the calendar sorts; wrong for a *completed* visit, which displays a year in the future. Surfaced while adding the slot↔when conversion for the visit slice: the parity harness has to use a future date for its round-trip assertion to mean anything | bug | Low | when visit history gets a real view — parse the year the format already contains |
| D89 | **The mock's visit reads were unscoped** — `listVisits()` returned the *entire* seeded collection to every caller, so on real data a user would have seen strangers' visits. Fixed in the visit slice (both reads are now caller-scoped, matching `/visits` and `/me/visit-requests`), but recorded because `consumer/property/scheduled-visits.spec.js` was passing *because of* it: the fixture asserted on visits belonging to other owners. The spec now seeds visits against the owner's own listing. Worth checking whether other mock `collGetter` reads have the same shape | bug | — | **Closed** — noted so the pattern is recognised elsewhere |
| D90 | **A rate-limited OTP request answers `500`, not `429`** — `POST /auth/login` inside `OtpService.SEND_COOLDOWN` (60s) logs `RateLimitedException: A code was just sent — wait a moment` and then `Application exception overridden by commit exception` → `UnexpectedRollbackException` → the catch-all handler returns `internal`. The carefully-worded message and its `retryAfterSeconds` never reach the caller; the user is told the server broke when in fact they were told to wait. The exception is thrown inside a `@Transactional` boundary that has already marked itself rollback-only, so the commit fails after the handler would have run. Found while writing the live moderation specs — three tests each signing in tripped it, which is also why the suite now caches the session rather than re-authenticating. Same shape presumably affects the other `RateLimitedException` throwers (`SocietyLeadService`, `FlatmateSeekerService`, `FlatmateSupplyService`) — all are inside transactional services | bug | **Med** | out of scope for the moderation slice; needs the exception thrown outside the transaction (or the boundary made `noRollbackFor`) plus a test asserting `429` |
| D91 | **The verification queue still cannot be enumerated** — `PropertyReviewRepository` exposes only `findByPropertyId(UUID)`, so the maker-checker case files (`/properties/{id}/verification`) can be read and decided one at a time but never listed. `GET /admin/properties?status=pending` now finds the *listings* awaiting review, which is what the Verification tab renders, so the tab works; what is still missing is a list of open **review cases** with their checklists and threads. `ensureReview`/`decideReview` therefore stay on `lib/` for now — wiring the decision without the list would let ops decide a case they cannot find | design | Low | when the verification thread UI is wired — needs a paged finder + `GET /admin/property-reviews` |
| D92 | **Almost nothing writes notification rows** — `new Notification(...)` appeared at exactly five call sites, all flatmates (`FlatmateSeekerService` ×2, `FlatmateSupplyService` ×2, `FlatmateModerationService`). A contact request approved, a visit confirmed or rescheduled, a listing approved or rejected, a document share granted, an offer made — none of them notify anyone. The inbox is wired to the API and correct; it is simply near-empty for any user who has not used flatmates, which is why the notification seam still merges client-derived alerts. **The gap is in the writers, not the seam.** *Partially closed 2026-08-06 by the conversations slice:* `ConversationService.send` now writes a `message.received` notification to the other side, through a new `common.trust.Notifier` port implemented by `engagement.notification.NotificationPublisher` — that port is the reusable mechanism, so the remaining writers are one injected dependency and one call each, not five more repository imports | design | **Med** | one writer per slice as each domain is touched — messages done; moderation and contact are the two with the clearest remaining need |
| D93 | **`dismiss` on a notification is a client-side tombstone** — there is no `DELETE /notifications/{id}`, so the http provider records dismissed ids in `pnDismissedNotifs` and filters reads through them. Consequences, all deliberate and all documented on the provider: it does not sync across devices, clearing site data brings the row back, and the unread count excludes tombstoned rows so the bell stays clearable. Chosen over hiding the X in http mode (removes a working control) or throwing (a dead button) | design | Low | needs `DELETE /notifications/{id}`, or a product decision that dismiss is device-local |
| D94 | **Notification preferences have no server surface at all** — `getNotifPrefs`/`setNotifPrefs`/`inQuietHours` cover email/sms/whatsapp channels, a master `matchAlerts` switch, quiet hours and language, and every one of them lives only in localStorage. `ProfileTab.jsx` was deliberately not touched by the notification slice for that reason. The practical consequence is that quiet hours suppress *client-derived* alerts only — a server-written notification arrives at 3am regardless, because the server has never been told | design | Low | needs `GET/PUT /me/notification-preferences`; pair it with the D92 writers, which are what would have to honour it |
| D95 | **The verify funnel has no e2e coverage** — modal → DigiLocker mock → badge earned → listings update is the sequence that makes the whole badge-not-gate model work, and no Playwright spec drives it end to end. Carried in the worklog since the KYC slice and never picked up. The pieces are individually covered; the *transition* is not, which is where a regression would actually land | test-gap | Med | one spec, no product decision needed — good candidate for the next UI-touching slice |
| D96 | **50 of 67 e2e specs assert "zero console errors" with no noise filter** — `e2e/helpers/console.js` exports `trackErrors`/`IGNORE` for exactly this, and 3 specs use it; 14 rolled their own local regex; the remaining 50 filter nothing. Those 50 fail on any machine behind a TLS-intercepting proxy, or when a CDN/tile server hiccups — a failure that reads as an app bug. Deliberately left for now: it is a 50-file mechanical change and a cleanup pass is the wrong place to hide one | test-gap | Low | migrate all 50 onto the shared helper in one dedicated pass, then delete the 14 local copies |
| D97 | **Four flatmates source findings, handed back from the redesign and never picked up** — (a) `/services/rent-agreement?flat=&reissue=1` params are never read, so that CTA opens a blank wizard; (b) room `share` intent is dropped by `addFlatmateRequest` and survives only in the chat opener; (c) `occupancyOf` collapses a stored `'filling'` to `occupied` (the at-rest enum is `empty\|occupied`); (d) `AdminFlatmates` reads `rawDb()` while the consumer flows write localStorage, so rooms are invisible to admin moderation. (d) is the one with a user-visible consequence — ops cannot moderate what it cannot see | bug | Med | (d) first; the rest are small and independent |
| D98 | **Two mobile items blocked on a design/product call, not on engineering** — (a) at 200% font scale the raised centre "Post" slot cannot fit a 56px circle plus a 24px label in a 56px bar (needs ~74px), so that one label squeezes; the fix is to drop the redundant text under an already-`aria-label`led FAB, which is a design decision. (b) "B7" bottom-nav density: 7 targets and 265px of painted control in a 360px row, with the account pill ending at exactly x=360 — real and measured, but the item's suggested escape hatch does not exist, so it needs a call on what leaves the bar | design | Low | needs a design/product decision before any code |
| D99 | **Swipe-to-dismiss / swipe-to-remove gestures deferred** — sheets close via backdrop, X and the grab handle; Saved has a remove button. Destructive-by-gesture needs an undo affordance to be safe, and touch-drag handling is real state machinery for a P2 win. Recorded rather than dropped so the decision is visible next time the sheets are touched | design | Low | only alongside an undo affordance |

### Detail on the ones that need it

**D2 — rate limiting on authenticated writes.** Raised by `security-reviewer` during slice 3 and
deferred each slice since as platform-wide. Today only `POST /auth/login` is limited (OTP send, the
one `429` in the contract). Every slice since has added more authenticated write surfaces — contact
requests, offers, visits, reviews, saved searches. The right shape is a filter or interceptor keyed
on principal id, not a per-controller annotation. **This is infrastructure work that should land at
first deploy, not another slice's scope creep.**

**D5 — owner `hideNumber`.** The frontend mock has the preference; there is no backing column and no
contract field. Would live as `users.hide_number boolean not null default false`, masking the owner
mobile *even after approval*. Blocked on a product decision — `open-questions.md` Q2.

**D17 — legacy `enquiries`.** `GET /enquiries` is the pre-ADR-019 lead model. V4's own header calls
the schema deprecated but retained for back-compat. It is neither implemented nor formally sunset —
the worst of both. Pick one: implement it, or mark it `deprecated: true` in the spec with a sunset
note. Needs a product call — `open-questions.md` Q3.

**D22 — Maps key rotation.** A real key was committed in `.env.example` and is in git history across
two commits. A placeholder is committed now, but **history exposure means the key must be rotated** —
replacing the file does not undo the leak. This is the highest-urgency item in the register and the
only one that is externally exploitable today.

**D26 — client-side trust derivation.** `applyVerifiedBadgeToListings` sets `ownerVerified` in the
browser, and `isSeriousBuyer(mobile)` infers trust from a phone number. Both are forgeable. The
backend now owns verified state properly — only the DigiLocker webhook may set it — so **the durable
fix is the `mock→http` flip, not a patch to the mock.** Recorded so the flip is understood as closing
a security item rather than only swapping a data source. Live in `AadhaarVerifyModal.jsx`,
`lib/mockApi/properties.js`, `lib/seriousBuyer.js`, `dashboard/EnquiriesPanel.jsx`.

**D28/D29 — e2e.** `expect(errors).toEqual([])` treats *any* console error as a failure, including
ones from third-party network calls, so the suite is green only on a good connection — it will fail
in CI for reasons unrelated to the code under test. `services-loans-team.spec.js` was failing before
the work that recorded it and has not been re-triaged since. Neither should be confused with the
`qa-location-search`/`admin-*` cluster, which **was** root-caused and fixed.

**D30 — owner-scoped mock stores keyed on mobile.** Deals/visits mock stores key on the owner's
mobile. A masked number (`98XXXXX210`) strips to a short-but-plausible digit string, so two owners
can collapse onto the same key. The durable fix is re-keying on `ownerId`, which the API already
returns (`propertyMapper.js:125`) and which the mock fixtures lack. Backend slices 4+ made
deals/offers/visits server-authoritative, so the remaining exposure is mock-mode only.

**D75 — empty files that lie.** Found while sweeping temp scripts after the register audit, not by
any guard. Six 0-byte files survive in the tree, and each one is a claim the repo cannot honour:

| File | Tracked? | What it claims |
|---|---|---|
| `frontend/src/pages/consumer/list-property/MapInner.jsx` | yes, 0 bytes in HEAD | a map component. `LocationPicker.jsx:10` says it was *replaced*; nothing imports it |
| `frontend/src/pages/consumer/listings/QuickFilters.jsx` | yes, 0 bytes in HEAD | a filter component. Nothing imports it at all |
| `e2e/tests/listings-mobile-only-controls.spec.js` | yes, 0 bytes in HEAD | **coverage of mobile-only listing controls.** Playwright finds no tests in it and says nothing; the suite stays green while the named scenario is untested |
| `e2e/_live_auth_probe.mjs` | no | `LOCAL_DEV.md:109` tells a developer to run it for real-OTP login + silent-refresh |
| `e2e/_crosstab_refresh_probe.mjs` | no | `LOCAL_DEV.md:112` tells a developer to run it for two-tab reuse-detection |

The empty spec is the one that matters: an empty `.jsx` is dead weight, but an empty spec is a
**test that reports success by having nothing to fail.** The two probes are worse than missing —
`node _live_auth_probe.mjs` exits 0, so the documented check appears to pass.

Ten more 0-byte ghosts (`backend/apply_v9.sql`, `flyway_checksum.py`, `gen_seed.py`, `scan_spec.py`,
`speccheck.py`, `verify_checksums.py`, `e2e/debug-live.mjs`, `_guard_probe.mjs`, `_race_probe.mjs`,
plus three in `tasks/`) were deleted during this pass — untracked, unreferenced, all dated
2026-07-31, the same day as the D39 regeneration. **Same generator, wider blast radius than D39
assumed.**

That is the actionable part. `SourceTreeHygieneTest` scans `.java` under `backend/src` only, which is
why it caught none of these. Widening it to every text extension under the repo (minus
`node_modules`, `target`, `.git`) is a few lines and turns this from a thing found by accident into a
thing found by the build. Deleting the two dead `.jsx` and either writing or removing the empty spec
is a separate, smaller decision — they are tracked, so they belong in a frontend change, not this
one.

---

## 5. Closed

### Delivered — lifted out of the open register

Removed from §4 because the work is done, kept here because rule 3 forbids an item that quietly
stops being mentioned, and because these numbers are cited from source Javadoc, `tasks/todo.md`
RESULTS blocks and prior checkpoints. **Numbers are never reused** — new debt continues at D82.

| # | Item | How it closed |
|---|---|---|
| D81 | The dev database was unbootable, unrepairable, and held the only copy of the demo catalogue | **Closed the day it was opened.** Backed up first (`~/punenest-db-backup`, both `-Fc` and `--column-inserts`), verified the dump actually loads into a fresh V30 schema *before* touching anything, then extracted the 38 listings / 78 users / conversations / visits / contact requests into `db/seed/R__zz_dev_demo_data.sql` and rebuilt. Rebuilt DB matches the original exactly on every business table. Three traps surfaced on the way and are recorded in that file's header: repeatable migrations sort by description across *all* locations, so the demo seed ran before the reference data it depends on (hence `zz_`); `ON CONFLICT (id)` was too narrow and failed on `users_mobile_key`; and one conversation row violated `conversations_pair_ordered`, a constraint added after the data was created — **data extracted from an old schema is not automatically valid under the current one**. The old database is kept as `punenest_pre_rebuild` and the pass added `MigrationChainTest` + `TestDatabaseIsolationTest` so both halves of the mistake fail the build next time |
| D1 | Lombok on entities (§1) | **Done.** 62 entities: class `@Getter`, 139 field-level `@Setter`, 9 `@Getter(AccessLevel.NONE)`; `lombok.config` ban list verified to bite. Suite unchanged. |
| D3 | ArchUnit boundary test for feature→feature imports | **Done differently, and better.** `foundation/ArchitectureBoundaryTest` enforces the boundary with a **rank-based layering table** instead of the allowlist this item proposed — an import may only point at a strictly lower rank, so there is no allowlist to grow. It also catches **fully-qualified inline** references, which a bytecode import rule misses. The item's own trigger ("when a 3rd exception appears") is moot: the design has no exception list. No ArchUnit dependency was needed. |
| D6 | Review moderation queue + `reviews.archived` | **Done, and the column was correctly refused.** The queue exists (`moderation/review/ReviewModerationController`, covered by `ReviewTakedownTest`). `reviews.archived` was **not** added: `reviews.status` already carries moderation state and *every* read filters `status = 'published'`, including `ReviewRepository.aggregateFor`. A second boolean would be two columns for one concept and a second way to be invisible that the rating aggregate does not know about. Reasoning recorded in `V18__moderation_admin_indexes.sql`. |
| D8 | Tenancy creation on rent-close | **Done.** `DealService.close` calls `tenancyService.openFromClosedDeal` inside the same transaction when the property's deal intent is `RENT`, and logs both outcomes. Returns empty for an off-platform counterparty, which is expected. Buy deals get nothing — there is no ongoing relationship to model once a sale closes. |
| D14 | Share-flat (3 ops) | **Done, slice 15.** Left behind D70–D73, which are still open. |
| D18 | `backend/validate_spec.py` tracked at repo root | **Done.** Moved to `backend/tools/`, `SPEC` made script-relative so it runs from any cwd, PyYAML import guarded, stale `createTenancy` check dropped. |
| D23a | `counterpartyMobile` accepts 10–15 digits vs spec's `Mobile` | **Done.** **Three** sites, not the two recorded: `DealCloseRequest`, `DealPartyCreateRequest` — which stored the value unnormalised, so masked reads returned `null` — and `ConversationCreate`, which carried no pattern at all. Does **not** close D23. |
| D27 | `AGENTS.md` references a non-existent instructions file | **Done.** Points at the skills; "Spring Boot 3" corrected to 4.1. |
| D31 | `verifiedStats` should count distinct owners, not mobiles | **Done.** Mock keys on `ownerId \|\| last10(ownerMobile)`. |
| D34 | Shared test fixtures (§3) | **Done.** `support/AbstractApiTest`; 34 classes extend it, `bearer()` copies 30 → 5, identical bodies 26 → 0, ≈400 lines removed. `user()`/`listing()` deliberately not hoisted — see §3. |
| D39 | Zero-byte ghost `.java` packages regenerate | **Done as a guard, not a root-cause.** `foundation/SourceTreeHygieneTest` fails the build naming any `.java` that declares nothing; verified by planting one. An enforcer or antrun rule was impossible — neither plugin's jars are in the offline repo. A ghost carrying a syntax error still fails at compile first. |
| D43 | Private `parseUuid` duplicates collapse into `common.web.Ids` | **Done.** There were **19**, not the three recorded, under five names plus four `load(String)` methods. All route through `Ids.parseUuid`; the per-site 404 message stays at the call site. Raised **D74** for the one site that answers 400. |
| D62 | Deleted plan or boost pack falls back silently | **Done.** Both paths `log.warn`. `SubscriptionService` was restructured to resolve `Optional<Plan>` first so it can tell *plan deleted* from *unrecognised billing cycle* — the old `.map(…).orElse(null)` conflated them. |
| D24 | §7.1 cleanup: `Furnishing.PATTERN`, `OfferActions.PATTERN` from constants | **Done.** Two new vocabulary classes on the `PropertyPossession` model: `catalog.property.Furnishing` and `deals.offer.OfferActions`, each with a `PATTERN` composed from its own constants and a paired `PATTERN_MESSAGE`. The furnishing regex had been hand-copied into `ListingCreate` and `ListingUpdate`; the offer constants lived on the request DTO, so `OfferService` imported a wire schema to name a domain concept — it now reads `OfferActions.COUNTER`. **Not blocked on Q1 after all:** the "with D23" trigger implied a mobile-format dependency neither vocabulary has. |
| D35 | `NotFoundException.of("Property")` factory for wire-message consistency (§3) | **Done, and it found more drift than it was raised for.** `NotFoundException.of` added; **73** generic `"X not found"` call sites converted across 36 files. The audit turned up three separate divergences the register had not recorded: two rephrasings (`"No such property"`, `"No such owner"`), **nine** sites that appended the caller's own id to the message, and a private dialect in `ReviewTargetKey` (`"No society 'x'"`) that broke that file's *documented* posture — it answers identically for a malformed id and a missing row on purpose, which only works if the two sentences are actually identical. They were not. Ten bespoke messages remain and are bespoke for a reason (`"No such staff member to assign"` distinguishes a bad assignee id from a bad ticket id on the same request). |
| D40 | **Magic-byte sniffing on document uploads** — the vault trusts the declared `Content-Type` | **Done.** `DocumentUploads.validate` now takes the bytes and returns the type it *proved*; both upload paths persist that and discard the client's string, so a declared type can no longer reach the object store or come back out as a response `Content-Type`. Five signatures (PDF, JPEG, PNG, WebP, and the ten-brand HEIF set an iPhone actually emits) read from the first 12 bytes — no parsing, which would be a larger attack surface than the one it closes. Order is allowlist → size → sniff, so an oversized file is still reported as oversized. 12 new tests. |
| D74 | **A malformed notification id answers 400 while every other id in the platform answers 404** | **Closed by reasoning: the 400 is correct and stays.** `Ids`' 404 rule is about *path* tokens — a non-UUID there names a resource that does not exist, and a 400 would tell a prober the id space is UUIDs. None of that holds for `POST /notifications/read`: the id is an element of a request *body*, the endpoint exists, and there is nothing to be 404. The register's premise that "no test asserts either code" was also wrong — `markRead_malformedId_returns400NotServerError` has pinned it since slice 8. What was genuinely worth fixing was the echo: the message reflected the offending token back, and no longer does. Reasoning recorded in both `Ids` and `NotificationController` so it is not re-raised. |
| D75 | Empty files that lie: 2 committed 0-byte `.jsx`, 1 committed 0-byte e2e spec, 2 documented-but-0-byte probes | **Done.** All five deleted — `git log` proved the three tracked ones were **born empty at the initial commit**, so nothing was lost. `LOCAL_DEV.md` had documented the two probes for checks they never performed (`node _live_auth_probe.mjs` exited 0 and verified nothing); both checks are now written out as manual steps. `SourceTreeHygieneTest` widened from `.java` under `backend/src` to 16 source extensions across the whole repository, pruning build output and dependencies — 1,420 files, and the class of bug is now caught by the build instead of by accident. |
| D48 | **No optimistic locking on service requests or tickets** — two staff editing the same row last-write-wins | **Done, scoped to the three tables that have the problem.** New `common.persistence.VersionedEntity`; `Ticket`, `ServiceRequest` and `SupportTicket` extend it, and `V26` adds `version bigint not null default 0` to those three. `OptimisticLockingFailureException` maps to **409** with advice to reload — deliberately a different sentence from the constraint-violation 409, because the caller did nothing wrong and their recovery differs. **The trigger's "platform-wide, with `@Version` on the audited entities" was rejected and the reasoning is in `VersionedEntity`'s Javadoc:** that is 37 tables including `users`, `properties` and `transactions`, none of which have a second concurrent writer, in exchange for a new failure mode on every write path and a landmine under every raw-SQL test fixture. The full suite confirmed the blast radius — the only tests that moved were the new ones. Three tests, none of them threaded: a race reproduced with threads is a race reproduced *sometimes*, and the thing that makes a lost update possible is staleness, not simultaneity. |
| D25 | Message-string consistency across 422 bodies | **Done, and it was never actually blocked on Q1.** The mobile regex was spelled inline at **nine** sites with **three** different messages, so one rule was described three ways depending on which endpoint rejected you. New `common.validation.Formats` holds the pattern and its message *together* — splitting them, as §2 originally sketched, is precisely what lets them drift. All nine sites converted, and `foundation/SharedFormatsTest` now fails the build on a tenth: hoisting the duplicates fixes the nine that exist and nothing about the next one, which is how three messages appeared in the first place. PAN, Aadhaar, IFSC and account number stayed put — one call site each, so §2's own admission criteria exclude them. D23's `@IndianMobile` meta-annotation is still open and still blocked on Q1, which decides what the regex *is*; D25 was only ever about there being one of it. |
| D66 | **`/admin/settings` has no version or ETag** — two admins editing the same top-level key last-write-wins and neither is told | **Done (spec fix S68), and not the way the trigger proposed.** `GET` now returns a strong `ETag`; `PUT` honours an optional `If-Match` and answers **412** with nothing written and no audit row. **`@Version` on `Setting` would have been wrong:** the resource an admin edits is the union of several `settings` rows, so a per-row counter cannot describe "the document you were looking at", and versioning all of them would leave the endpoint concatenating numbers into a tag — at which point the numbers do nothing the content was not already doing. A content hash also gets a property a counter gets wrong: saving a block unchanged leaves the tag alone, so an admin who presses Save twice does not invalidate a colleague's open editor for nothing. Body and tag are returned together (`SettingsDocument`) because computing them in two transactions can hand a caller a tag for a document they were never shown — and on the `PUT` path that fails in the dangerous direction. `If-Match` is optional so shipping it broke no existing caller; `*` and comma-separated lists are honoured per RFC 9110, weak tags are not. Seven tests. |

### Rejected or superseded — do not re-litigate

Recorded so future reviewers (human or agent) do not re-raise settled questions.

| Item | Ruling |
|---|---|
| Records vs Lombok for DTOs | **Records.** See §1. |
| A central `ValidationService` / rule engine | **No.** See §2 — it inverts the dependency graph and separates each rule from its transaction. Format rules only move; invariants stay in services. |
| Centralising status/vocabulary constants in one package | **No.** §7.1 stands; a shared vocabulary package would import every feature's concepts. |
| `role`/`status` as `String` not `enum` | Deliberate (`api-standards.md` §7.1). Feature-owned constants mirror the DB `CHECK` and the spec vocabulary; enums add a mapping layer and break on a spec-side value addition. |
| Duplicated `maskMobile` in two mappers | Deliberate. Both are `private` so MapStruct cannot adopt them as implicit `String→String` converters. A security rule readable in place beats one you have to go find. |
| `tools.jackson` import "is wrong" | It is correct. Spring Boot 4 ships Jackson 3. |
| `pendingContactCount` / `pendingOfferCount` etc. | Client-derived from the list responses. No endpoint, no spec addition. |
| Server mask format `98XXXXX210` vs mock `+91 98••• ••10` | Server format stands; the prettier rendering is client-side presentation. |
| `GET /reels` declares `page`/`size` but returns a bare array | Correct for an infinite-scroll feed — bounded input, no total needed. |
| `ReviewResponse.categories` empty-not-null | Deliberate, so clients iterate without a guard. |
| e2e `qa-location-search` (×13) + `admin-*` (×9) timeouts | **Fixed**, not deferred. Re-verified: 290 passed, 0 failed. |
| Backend not in version control | **Fixed** — 209 files tracked. |
| 24 zero-byte orphan `.java` files from the package refactor | Reopened as **D39**, now **closed by a guard**: `SourceTreeHygieneTest` fails the build and names any file that declares nothing. The generator was never identified, so the guard is the fix — a third recurrence now costs one red test instead of a debugging session. |
| `identity/IdentityVerification.java` 84-byte stub | Same recurrence; covered by the same **D39** guard. |
| Broken unimported `frontend/src/components/Header.jsx` | **Fixed** in `66d5eb7`. |
| Stale "guaranteed by the Aadhaar gate" comment in `submit.js` | **Fixed** — no longer present. |
| Slice-8 spec items S26/S27 (`Review.context`, `PageEnvelope` on notifications/reviews) | **Done** — verified in the spec (143 paths, 17 `PageEnvelope` refs) and in V16/V17. The unticked boxes in `tasks/todo.md` are stale bookkeeping. |
| Slice-2 plan checkboxes (a–j reconciliation, `prop-*` build items) | **Done** — the slice shipped with a RESULTS block. Unticked boxes are stale. |
| `package-structure.md` §4 inline `from()` style | **Fixed** — replaced by the `api-standards.md` §8.1 mapper rule, with the reason recorded (a factory on the response record never sees the viewer, so it cannot mask). |
| Collapsing the 5 bespoke exception subclasses into one parameterised type (C5) | **No.** `AadhaarAlreadyRegistered`, `ReviewNotEligible` and friends each carry a distinct wire error code the React client branches on. Named types are greppable, testable, and impossible to get subtly wrong at the call site; collapsing them saves ~5 files and costs the one property that matters. |
| Splitting `common/web/Routes.java` because it is 591 lines | **No.** Its length is the feature — one greppable registry of every route (`api-standards.md` §2.1). Splitting it by feature reintroduces the scatter the rule exists to prevent. See §3. |
| "Classes are too long, we need to split them" | **Measured and false.** Only 2 main files exceed 500 lines; one is fixed by D1 and the other should stay long. The real waste is the 42.7% comment ratio and test duplication — see §3. |
| "Just upgrade Checkstyle to the latest and turn it on" | **No — the version is the smaller problem.** Measured: **12 of 717 findings (1.7%) actually need a linter**; 494 are layout a formatter fixes for free and 211 come from rules that must be deleted because they contradict D33. Upgrading 10.13.0 → 13.9.0 and enabling it would hand a human ~494 mechanical edits and still find zero bugs. Formatter first (Spotless), then reassess whether the residual 12 justify keeping Checkstyle at all — the boundary rules that would have been ArchUnit's job already ship as D3. See §3 D36. |

### A note on `tasks/todo.md` unchecked boxes

A sweep of that file found **34 unticked `- [ ]` items**; the majority are *stale plan checkboxes*
from slices that subsequently shipped, not outstanding work. They were verified individually against
the source, spec and migrations before landing here. **This register — not the checkbox state in
`todo.md` — is authoritative for what remains.**
