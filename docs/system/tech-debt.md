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
3. **A finished item is deleted, not archived.** Once the work is done and the reasoning lives
   somewhere it will actually be read — a Javadoc, a comment beside the code, a test that fails if
   the rule is broken — the register entry has no remaining job and is removed outright. *This
   reverses the original rule*, which kept a "Closed" table so nothing "quietly stopped being
   mentioned". That was the right instinct aimed at the wrong risk: a register nobody finishes
   reading is its own failure mode, and by 2026-08-07 the closed section was longer than the open
   one. Git history is the archive. **Two things are still never deleted:** a *ruling* (§5 — a
   settled "no", which exists precisely so it is not re-raised), and any closed item whose lesson
   has no home in code.
4. **Numbers are never reused.** Deleting D19 does not free D19. New debt continues from the
   highest number ever issued, so a reference in an old commit or comment can never resolve to a
   different item than it meant.
5. **This file does not schedule work.** When a slice picks an item up, it goes into `tasks/todo.md`
   as a checkable plan item; the entry here is deleted when that work lands.
6. **Per-slice RESULTS blocks stay in `tasks/todo.md`.** Only the *carried-forward* residue lands
   here, and it lands here **once** — no duplicate bookkeeping in two files.
7. **If it needs a decision, it is not debt yet** — it goes to `open-questions.md` and returns here
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

### Build wiring — where the details actually live

Lombok + MapStruct is the ecosystem's most notorious annotation-processor ordering problem. All of
it — the mandatory `lombok → lombok-mapstruct-binding → mapstruct-processor` order, why the offline
repository forces `<lombok.version>1.18.44</lombok.version>` below the Boot 4.1 BOM's 1.18.46, and
what breaks if either changes — is commented **in `backend/pom.xml` beside the elements it governs**,
which is where somebody editing them will actually read it.

Two things not obvious from the pom: the failure mode is loud rather than silent, because
`PropertyMapper` sets `unmappedTargetPolicy = ERROR`, so a mis-ordered processor fails the compile
with "Unmapped target property" — **do not "fix" that by relaxing the policy**. And if anything ever
does look wrong, read the generated `CityMapperImpl.java` and confirm MapStruct is calling
Lombok-generated accessors (`city.getSlug()`, `city.isLive()`) rather than assuming it.

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
| C1 | Trim `@param` ceremony (~230 lines) | **D33 — open** |
| C2 | Shared test fixtures (`AbstractApiTest`) | **Delivered.** 34 classes extend it; the `Fixtures` half was refused, not done — reasoning in the class Javadoc |
| C3 | Lombok on entities | **Delivered** — see §1 for the policy, which still governs new entities |
| C4 | `NotFoundException.of("Property")` factory | **Delivered** — 73 call sites; see `NotFoundException` |
| C5 | Collapse the bespoke exception subclasses | **Rejected** — see §5 |
| C6 | Formatter + linter + boundary tests in `verify` | **D36 — open** (boundary third delivered as `ArchitectureBoundaryTest`) |
| C7 | Service-split trigger at ~450 lines | **D37 — open** |
| C8 | One `package-info.java` per bounded context | **D38 — open** |

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

**77 open** — 4 High, 2 Med-High, 35 Med, 36 Low. Highest number ever issued: **D104**; numbers are
never reused (rule 4), so gaps in this list are deleted items, not mistakes.

> **The count above was wrong for months and is now derived, not asserted.** The header claimed
> "60 open" while the table held 78 rows — every pass edited the prose and not the arithmetic, so
> the one number a reader takes at face value was the least trustworthy thing here. Recount before
> editing it:
>
> ```powershell
> $l = Get-Content docs/system/tech-debt.md
> $s = ($l | Select-String '^\| # \| Item \| Area \| P \|').LineNumber
> $e = ($l | Select-String '^### Detail on the ones').LineNumber
> $rows = $l[$s..($e-1)] | Where-Object { $_ -match '^\| D\d+ \|' }
> $rows.Count
> $rows | ForEach-Object { ($_ -split '\|')[-3].Trim() -replace '\*','' } | Group-Object | Sort-Object Count -Descending
> ```

**The four High items are blocked on something other than effort**, which is the single most
useful fact about this list:

| # | What it needs |
|---|---|
| D2 | a rate-limiter design (pairs with D73 — one atomic principal-keyed counter answers both) |
| D57 | a scheduler — nothing in the platform runs on a timer yet |
| D59 | a ranking design: what a paid boost is actually worth against relevance |
| D67 | *decided — wire it.* Now blocked on slice capacity, not on a question |

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

**Actionable today without any decision** — the honest short list is now short. **D38**
(`package-info.java` per context) is the only one of any size, and it is 22 files of prose whose
value depends entirely on the prose being accurate; done shallowly it is worse than not done.
**D46**, **D49** and **D60** are one-liners, but each of the three is explicitly waiting on a
consumer that does not exist — an unassign gesture, a message attachment, a share channel — and
building the field before the caller is how the register filled up with `settings.permissions`
(D67). The remaining no-decision items are **D95** (one verify-funnel spec), **D96** (50 specs onto
the shared console helper), **D97(d)** (ops cannot see flatmate rooms — the one with a user-visible
consequence) and **D33** (trim the `@param` ceremony).

> **Debt pass, 2026-08-07.** Nine items closed: D90, D82, D19, D22, D83, D86, D97(d), D95, and the
> durable half of D33. Every fix was mutation-tested — the fix reverted, or damage deliberately
> planted, and the test watched to go red — because in each case a green assertion could have meant
> nothing.
>
> **Four of the nine were filed with the wrong size or the wrong cause**, which is the most useful
> pattern here: *the register's own numbers were the least reliable thing in it.* D19 said "7 files,
> cosmetic" and was 22 files including mangled rupee signs in live prices. D96 said "50 specs filter
> nothing" and was 9. D97(d) said "rooms are invisible" when ops could see nothing at all. D33 said
> 562 `@param` and it is 673. **Measure before scheduling, and re-measure before deleting.**
>
> Findings worth more than the items themselves:
>
> 1. **A `@Transactional` test harness cannot see a bug that happens at commit time.** D90 survived
>    750 tests because every HTTP test extends a rolling-back base class, and the defect was a
>    failing commit. The guard had to be written *outside* the harness that hid it.
> 2. **Detect by round-trip, not by a list of known-bad patterns.** The first D19 repair script used
>    a hand-built map and missed two whole families nobody had grepped for. A table can only ever fix
>    the damage somebody already noticed.
> 3. **A mock more permissive than its server passes tests the real thing would fail** (D97d).
> 4. **A mutation test caught a bad assertion, not just a bad fix.** The D95 one-shot-perk test
>    passed with the guard deliberately disabled: with no guard the perk moves to the *next* listing
>    rather than re-extending the first, so an assertion on the first listing's window could never go
>    red. Counting grants across the set can. An assertion that cannot fail is worse than no test —
>    it reads as coverage.
> 5. **Consolidating filters must merge them first.** The local console-noise lists were not subsets
>    of the shared one, so deleting them and pointing everything at `IGNORE` would have silently
>    *tightened* several specs. The shared list absorbed `gstatic`, `maptiler` and the React DevTools
>    banner first — but deliberately not bare `ERR_` or bare `maps`, which are broad enough to
>    swallow a real error.

> **D97(d) closed — and it was twice the item it was filed as.** The entry said "rooms are invisible
> to admin moderation". True, but the cause was broader: `AdminFlatmates` read `rawDb()` while
> **every** consumer flatmate flow writes localStorage, so ops could not see a single seeker, group
> **or** room a real user had posted — not just rooms. Worse, the second half was silent: nothing on
> the consumer side filtered `modStatus`, so *even the rows ops could see* were unmoderatable —
> "Remove" wrote a value no reader consulted and the post stayed on the board, while the page told
> the moderator that removed posts disappear.
>
> **The server was right the whole time**, which is what makes this a mock-fidelity bug rather than
> a product gap: `FlatmateRoomRepository`, `FlatmateGroupRepository` and `FlatmateSeekerPostRepository`
> filter `mod_status not in ('flagged','removed','rejected')` across nine queries, one commented
> *"the mod_status clause is not decoration: a flagged post must disappear"*. The mock now mirrors
> that set exactly (`MOD_HIDDEN` in `lib/data/flatmates.js`), the admin queue reads both stores and
> has a Rooms tab, and verdicts are written back to whichever store holds the row.
>
> **The filter went on the public board, not on the store getters.** `getRooms`/`getFlatmatePosts`/
> `getFlatmateGroups` have 31 call sites between them and the owner's own dashboard is one of them —
> an owner must still see a post that was taken down, with its status, rather than watch it silently
> vanish. Both halves are mutation-tested: drop the filter and the two "hidden" tests go red while
> the control stays green; revert the admin read and the visibility test goes red.
>
> **The lesson, which is bigger than flatmates:** a mock that is *more permissive* than the server it
> stands in for does not fail loudly — it silently passes tests the real thing would fail. Worth
> checking the other mock providers against their repositories for the same asymmetry.

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
| D20 | `ProfileTab.save` sends `city`, absent from `UserUpdate` | frontend | Low | silently dropped on http |
| D21 | Verify-funnel Playwright coverage (modal → mock → badge) | e2e | Med | e2e owner |
| D23 | `common.validation` shared format package (§2) | backend | Med | backend / blocked on Q1 |
| D26 | Frontend derives trust client-side (`applyVerifiedBadgeToListings`, `isSeriousBuyer`) | frontend | Med | moot on `http` flip; live in mock mode |
| D28 | e2e `expect(errors).toEqual([])` assertions are network-dependent | e2e | Med | flaky offline / in CI |
| D29 | e2e `services-loans-team.spec.js` failing (pre-existing) | e2e | Med | e2e owner |
| D30 | Owner-scoped mock stores keyed on owner **mobile**, not `ownerId` | frontend | Med | Phase 3/4 integration |
| D32 | ProfileTab identity chips are hardcoded English | i18n | Low | ProfileTab i18n pass |
| D33 | **~195 `@param` lines still restate their parameter in a synonym** — the 2026-08-07 pass amended `api-standards.md` §10 first (the durable half: without it they grow straight back) and deleted the **42** that are provably empty — pure name restatements and `(required)`/`nullable` suffixes that duplicate the annotation on the next line. **The remaining ~195 were deliberately not deleted.** The register's criterion was "≤4 words", and applied literally that removes genuinely useful lines: `@param orderId the provider's {@code order_id}` is four words and says which external field it maps to. A synonym (`@param title headline`) is a judgement call a regex should not make unsupervised | quality | Low | by hand, per file, when that file is next edited — §10 now forbids adding more |
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
| D67 | **`settings.permissions` and `settings.customRoles` are stored and never read** — the contract declares both, the settings endpoint round-trips both, and no guard anywhere consults either. Authorisation is `@PreAuthorize` on four fixed roles. An admin who edits the permission map will believe they have changed access control and will be wrong. **Decision taken 2026-08-07: wire it, do not remove it.** That settles the "wire or remove" trigger and makes this a scheduled slice rather than an open question — but it is a slice, not an afternoon: it needs a permission-resolution layer, the four role checks rewritten to consult it, and a migration for accounts whose stored map disagrees with their role. Until then the fields are still inert, so the settings screen must not render a permissions editor | security | **High** | **decision made — wire it**; needs its own slice (resolution layer + guard rewrite). Do not ship a permissions editor before it |
| D68 | **The abuse-report queue is absent from the admin dashboard** — `pendingModeration` counts `properties` awaiting a decision and deliberately does not fold in `reports`, because the two queues are worked by different people against different SLAs. The consequence is that the one scorecard ops looks at does not show the reports backlog at all | design | Med | when the dashboard grows a second queue tile |
| D69 | **The analytics series is computed on every request with no cache** — four grouped scans, up to 366 buckets, available to any staff account with no throttle beyond the bucket cap. Correct and cheap at today's data volume; the first slow morning will be this endpoint | performance | Low | when a table it scans passes ~1M rows |
| D70 | **A poster's only record of who answered is the notification stream** — the contract has no "who replied to my ad" endpoint and `share_flat_interests` is not readable over the API, so the sender's name and number exist for the poster only as a notification. Dismiss it and the lead is gone, with the row still sitting in the table | design | Med | when share-flat gets a second screen — needs a spec addition, so it could not be fixed inside the slice |
| D71 | **Nothing can take a share-flat post down** — `share_flat_posts.archived` is written by no code path and the contract declares no delete or archive operation, so the five-live-post cap can be reached and never relieved. The 429 message was reworded to say "contact us" rather than "archive one", because the obvious advice is advice to do something impossible | product | **Med-High** | the sixth post a real user tries to write — needs one spec operation |
| D72 | **Share-flat posts are published unmoderated** — they appear on a `security: []` page the moment they are written, with no queue, no report action and no takedown (D71). Every other public-facing thing a user writes (listings, reviews) passes a moderator first. The board is free-text `title` and `locality`, which is exactly where a broker puts a phone number to route around the contact rules | moderation | **Med-High** | before the board is linked from anywhere public — pairs naturally with D71 |
| D73 | **Every rate limit on the platform is check-then-write and therefore racy** — `OtpService`, `SocietyLeadService` and `ShareFlatService` all `countBy…` and then insert, with no lock between the two. Concurrent requests all read the pre-insert count and all pass, so a burst clears a cap that a serial client could not. Raised by `security-reviewer` against share-flat's ten-interests-per-hour cap, recorded platform-wide because fixing one caller and leaving two is worse than fixing none. Bounded in practice: every send carries the sender's own OTP-verified number, and the unique index still stops repeat contact of the same person | security | Med | with D2 — the same infrastructure (a principal-keyed limiter with an atomic counter) answers both, and neither is a per-service patch |
| D76 | **The client's foundation-field list disagrees with the server's, in both directions** — `lib/store/listings.js` names twelve fields; the server reverts on the seven *searchable* ones. The client warns on `title`/`area`/`facing`/`floor`/`age` (which do not revert) and stays silent on `price` (which does), so the UI both threatens re-moderation that will not happen and conceals the one that will. The server half is fixed and self-enforcing (`ListingFoundationTest` reads the facets by reflection); this is the client half | frontend | Med | before the listing domain flips to http — it is a wrong warning on the owner's most consequential edit |
| D77 | **Sixteen more per-user reads grow with inbound demand and are still unpaged** — `/me/contact-requests`, `/me/offers`, `/me/visit-requests`, `/me/flatmate-requests`, `/me/finalization-requests`, `/me/documents/requests`, `/me/deals`, `/visits`, `/tenancies` and others. Rows are written by *other* users, so §5.1's "one user's own actions" test does not apply to them; the successful owner is the one an unpaged read punishes. `/me/saved` and `/messages` were paged in the API-polish pass because they were the largest payloads; the rest were left because the shape change is breaking and the frontend has no consumer for them yet | design | Med | with each domain's http provider — page it in the same change that first reads it, not after |
| D79 | **`GET /properties/{propId}/reviews` cannot be paged while the client computes the rating summary** — ruling D8.6 permits the unpaged read because the per-target UNIQUE index bounds it, and the property page computes the star average, the 1–5 distribution and the per-category averages from the full list. The bound is real, so this is not urgent; recorded because "page everything" applied here would make three visible numbers silently describe page one. `ReviewRepository` already has the aggregate query if the summary ever moves server-side | design | Low | only if the aggregates move server-side |
| D80 | **`FlatmateRoomDto` is 47 fields, by a distance the largest DTO on the platform** — the next largest is `PropertySummary` at 22. It is returned by the room feed, the mixed flatmates feed and now `GET /properties/{id}/rooms`. Not wrong today (rooms per flat is naturally small, and the derived occupancy fields are the point), but a 47-field row is a DTO that has stopped being a view of anything and become the entity with a different name | design | Low | if the flatmates payload ever needs trimming — split the feed shape from the detail shape |
| D84 | **The alert switch is a boolean over a four-state server field** — `SavedSearch.alertFrequency` is `off\|instant\|daily\|weekly`, but the only control is an on/off `Switch`, so the seam derives `alerts = alertFrequency !== 'off'` and writes back `daily` when switched on. Currently unreachable loss (nothing can produce a non-default cadence), but the moment a frequency picker ships, a user holding `instant` who toggles off and on lands on `daily`. The seam carries `alertFrequency` explicitly so the fix is a UI change, not a contract change | design | Low | when a cadence picker is designed |
| D85 | **Anonymous alert capture has no server home** — `NotifyMeCard` and `FlatmateAlertCard` exist to capture a *signed-out* visitor's demand against a mobile number, but `POST /me/saved-searches` is caller-scoped and `SavedSearchCreate` carries no `mobile`, so the call would 401 for exactly that visitor. Both cards now split: signed in → the seam; signed out → localStorage as before, so the alert is still claimed on this device after sign-in. The http provider throws a named error rather than silently writing locally while every read comes from the server — that would produce an alert the user was told they created and can never see again | design | Med | needs a public demand-capture endpoint, or an explicit "sign in to create an alert" product decision |
| D87 | **A visit cannot be rescheduled through the API** — the dashboard offers reschedule (pick a new slot, visit returns to `scheduled`), but `PATCH /visit-requests/{id}/status` carries a status and a note only, and there is no slot-update route. The http provider throws a named error rather than substituting cancel-and-rebook, which would mint a new id (breaking the row the UI holds), discard the visit's history, and hit the duplicate-visit 409 against the row it had just cancelled | design | Med | needs `PATCH /visit-requests/{id}` accepting a slot, or an explicit product decision that rescheduling is cancel-and-rebook |
| D88 | **`parseWhen` discards the year and reconstructs it from "now"** — the human `when` string carries a year (`"19 Jul 2026, 10:30 AM"`) but the parser matches only day + month and rolls forward when the result would be in the past. Harmless for upcoming visits, which is every visit the calendar sorts; wrong for a *completed* visit, which displays a year in the future. Surfaced while adding the slot↔when conversion for the visit slice: the parity harness has to use a future date for its round-trip assertion to mean anything | bug | Low | when visit history gets a real view — parse the year the format already contains |
| D91 | **The verification queue still cannot be enumerated** — `PropertyReviewRepository` exposes only `findByPropertyId(UUID)`, so the maker-checker case files (`/properties/{id}/verification`) can be read and decided one at a time but never listed. `GET /admin/properties?status=pending` now finds the *listings* awaiting review, which is what the Verification tab renders, so the tab works; what is still missing is a list of open **review cases** with their checklists and threads. `ensureReview`/`decideReview` therefore stay on `lib/` for now — wiring the decision without the list would let ops decide a case they cannot find | design | Low | when the verification thread UI is wired — needs a paged finder + `GET /admin/property-reviews` |
| D92 | **Almost nothing writes notification rows** — `new Notification(...)` appeared at exactly five call sites, all flatmates (`FlatmateSeekerService` ×2, `FlatmateSupplyService` ×2, `FlatmateModerationService`). A contact request approved, a visit confirmed or rescheduled, a listing approved or rejected, a document share granted, an offer made — none of them notify anyone. The inbox is wired to the API and correct; it is simply near-empty for any user who has not used flatmates, which is why the notification seam still merges client-derived alerts. **The gap is in the writers, not the seam.** *Partially closed 2026-08-06 by the conversations slice:* `ConversationService.send` now writes a `message.received` notification to the other side, through a new `common.trust.Notifier` port implemented by `engagement.notification.NotificationPublisher` — that port is the reusable mechanism, so the remaining writers are one injected dependency and one call each, not five more repository imports | design | **Med** | one writer per slice as each domain is touched — messages done; moderation and contact are the two with the clearest remaining need |
| D93 | **`dismiss` on a notification is a client-side tombstone** — there is no `DELETE /notifications/{id}`, so the http provider records dismissed ids in `pnDismissedNotifs` and filters reads through them. Consequences, all deliberate and all documented on the provider: it does not sync across devices, clearing site data brings the row back, and the unread count excludes tombstoned rows so the bell stays clearable. Chosen over hiding the X in http mode (removes a working control) or throwing (a dead button) | design | Low | needs `DELETE /notifications/{id}`, or a product decision that dismiss is device-local |
| D94 | **Notification preferences have no server surface at all** — `getNotifPrefs`/`setNotifPrefs`/`inQuietHours` cover email/sms/whatsapp channels, a master `matchAlerts` switch, quiet hours and language, and every one of them lives only in localStorage. `ProfileTab.jsx` was deliberately not touched by the notification slice for that reason. The practical consequence is that quiet hours suppress *client-derived* alerts only — a server-written notification arrives at 3am regardless, because the server has never been told | design | Low | needs `GET/PUT /me/notification-preferences`; pair it with the D92 writers, which are what would have to honour it |
| D96 | **14 specs still carry a local console-noise filter or none at all** — the 2026-08-07 pass moved **31** onto `helpers/console.js` and merged every local pattern into the shared `IGNORE` first, so consolidating could not silently *tighten* a spec. What is left is the tail: `search-property-types.spec.js` keeps a self-contained `pageerror`-only helper, `live-property-integration.spec.js` was left alone as in-flight work, and ~12 specs assert on `pageerror` only. **The register's "50 of 67 filter nothing" was wrong** — measured, only **9** had a genuinely unfiltered `console` listener; 35 track `pageerror` alone, which no proxy or CDN can manufacture, so they were never exposed to this defect | test-gap | Low | fold the tail in when those files are next touched |
| D97 | **Three flatmates source findings, handed back from the redesign and never picked up** — (a) `/services/rent-agreement?flat=&reissue=1` params are never read, so that CTA opens a blank wizard; (b) room `share` intent is dropped by `addFlatmateRequest` and survives only in the chat opener; (c) `occupancyOf` collapses a stored `'filling'` to `occupied` (the at-rest enum is `empty\|occupied`). **(d) is closed** — see the note below | bug | Med | small and independent; take them in any order |
| D98 | **Two mobile items blocked on a design/product call, not on engineering** — (a) at 200% font scale the raised centre "Post" slot cannot fit a 56px circle plus a 24px label in a 56px bar (needs ~74px), so that one label squeezes; the fix is to drop the redundant text under an already-`aria-label`led FAB, which is a design decision. (b) "B7" bottom-nav density: 7 targets and 265px of painted control in a 360px row, with the account pill ending at exactly x=360 — real and measured, but the item's suggested escape hatch does not exist, so it needs a call on what leaves the bar | design | Low | needs a design/product decision before any code |
| D99 | **Swipe-to-dismiss / swipe-to-remove gestures deferred** — sheets close via backdrop, X and the grab handle; Saved has a remove button. Destructive-by-gesture needs an undo affordance to be safe, and touch-drag handling is real state machinery for a P2 win. Recorded rather than dropped so the decision is visible next time the sheets are touched | design | Low | only alongside an undo affordance |
| D100 | **The parity harnesses write into the dev database and cannot clean up** — `review-parity.mjs` posts a real locality review on every run, and reviews are **public**, so "Parity probe review." renders on `/locality/aundh` to anybody browsing. This was found the hard way: the first version of the live reviews e2e asserted on "seeded" aundh reviews that turned out to be four rows the harness had littered — *a test whose fixture is another tool's litter*. The e2e now writes its own fixture; the harness pollution remains. `conversation-parity.mjs` does the same but its rows are private, so the blast radius is smaller | testing | **Med** | needs either `DELETE /reviews/{id}` (moderation can hide but not remove), or the harnesses pointed at a dedicated throwaway database rather than `punenest` |
| D101 | **28 of 94 seeded users have no `name`, so their reviews render as "User"** — `ReviewResponse.author` is `NON_NULL` and therefore *absent* from the wire entirely for those users, not empty-string. Both review mappers default to `'User'`, which is the honest fallback, but a review list where a third of the authors are called "User" reads as broken rather than as anonymous. The gap is in the seed data and in the fact that nothing forces a name at sign-up: OTP login mints a user from a mobile alone | data | Low | either backfill the seed, or decide what an unnamed author should be called and say it once (`Verified user`?) rather than defaulting per mapper |
| D102 | **The support form's mobile field is contact detail the API cannot carry** — `/support` is a `ProtectedRoute` and `SupportTicketCreate` has no identity field, so the raiser is the session. The form still shows an editable, validated mobile prefilled from the profile. On the common path that is right; a user who *edits* it to a different callback number is telling us something that goes nowhere. Not gated like priority and attachments, because those set a value that is silently discarded, whereas this is merely not *also* stored — support still reaches them through the account and the thread | design | Low | either make it read-only in http mode, or add a `contactMobile` to the create schema if callback-on-a-different-number is a real need |
| D103 | **The support catalogue and the server status vocabulary disagree** — the page labels `new/open/waiting/resolved/closed`; the server has `open/in-progress/waiting/resolved/closed`. `new` never occurs live, and `in-progress` has no label, so it renders as the raw key. Deliberate: `getStatusLabel` falls back to the key, and collapsing `in-progress` onto `open` would erase a distinction ops made and tell the customer nothing was happening while somebody worked on it | design | Low | add an `in-progress` label (and drop `new`) when the ops surface that sets it exists |
| D104 | **Society and locality catalogues are seeded ~10× thinner than the frontend's** — the frontend ships 348 societies (28 curated + 320 MahaRERA) and 155 localities; the database has 28 and 16. Every slug the extra rows use would 404 against `GET /societies/{slug}` and `PUT /me/societies/{slug}/follow`. **This blocks the societies seam domain**, which is otherwise ready: `GET /societies` already carries `avgRating`/`reviewCount` for the three card call sites that need it. Found while scoping that slice | data | **Med** | seed the RERA import and the full locality list, then the societies slice is a day's work |
| D105 | **A domain enabled in `VITE_API_DOMAINS` under a name that does not match its lookup key falls back to mocks silently** — the allow-list is lower-cased when parsed; `isHttpDomain` was not, so `savedSearch` could never match. The "enabled but has no http provider" warning is itself gated on `isHttpDomain`, so there was **nothing in the console**: a live e2e run would have passed while exercising the mock. Fixed by lower-casing the lookup, but the class of bug survives — a typo'd domain name is still only a `console.warn` | correctness | **Med** | validate `VITE_API_DOMAINS` against the http provider registry at startup and fail loudly on an unknown name |
| D106 | **Four http providers read Spring's `number` for the current page, not the contract's `page`** — `PageEnvelope` declares `page`, and the server sends `page`. `contact`, `saved`, `review` and `report` all read `res?.number ?? page`, so the fallback quietly resolved to the *requested* page. It agrees with the server until the server disagrees — any clamp or redirect and the client reports a page the caller is not on. Two parity harnesses had the same bug in their own unwrapping, which is why it went unreported: harness and provider were wrong in the same direction. Fixed in all six places | correctness | Low | the live e2e now asserts `page` on the wire; consider a shared `unwrapPage` helper so there is one place to be wrong |
| D107 | **The four oldest parity harnesses could not run under current Node** — `visit`, `contact`, `saved` and `saved-search` used a plain `await import()`, which reaches `mockApi/core` → `db.json` (Node ≥ 22 demands an import attribute) and `persist.js` (reads `import.meta.env.DEV`, undefined outside a bundler). They failed before the first assertion, so "the harness passes" had been vacuously true for however long. Migrated to Vite's SSR loader, which the newer three already used | tooling | Low | none — all seven now share one loader; keep new harnesses on it |

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

---

## 5. Standing rulings — do not re-litigate

The only permanent section. Everything here is a settled **"no"** or a deliberate choice that looks
like an oversight, so each entry exists to stop the same question being re-raised by the next
reviewer. Unlike a finished debt item (rule 3), a ruling has no artifact to be deleted into —
its whole value is that it is still written down.

**The delivered-work archive that used to sit here was removed on 2026-08-07.** It had grown to 22
long entries and was longer than the open register above it, which is a real cost: the file people
must read to know what is owed had a majority of text describing what is not. Every entry's
reasoning had already been written into the thing it changed — `VersionedEntity`, `SettingsDocument`,
`common.validation.Formats`, `DocumentUploads`, `Ids`, `NotFoundException`, `ArchitectureBoundaryTest`,
`SharedFormatsTest`, `MigrationChainTest`, and the header of `R__zz_dev_demo_data.sql` — all verified
present before deletion. Git history holds the rest.

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
| Mojibake / BOM "should just be a grep for the bad sequences" | **No — detect by round-trip.** A pattern list only ever catches damage somebody already noticed: the first repair pass used one and missed two whole families. `SourceTreeHygieneTest.noMojibakeOrBom` re-encodes each non-ASCII run to CP1252 and decodes it as UTF-8, accepting only a valid, strictly shorter result — which also leaves genuine `Café` / `पुणे` / `₹` alone. |
| Collapsing the 5 bespoke exception subclasses into one parameterised type (C5) | **No.** `AadhaarAlreadyRegistered`, `ReviewNotEligible` and friends each carry a distinct wire error code the React client branches on. Named types are greppable, testable, and impossible to get subtly wrong at the call site; collapsing them saves ~5 files and costs the one property that matters. |
| Splitting `common/web/Routes.java` because it is 591 lines | **No.** Its length is the feature — one greppable registry of every route (`api-standards.md` §2.1). Splitting it by feature reintroduces the scatter the rule exists to prevent. See §3. |
| "Classes are too long, we need to split them" | **Measured and false.** Only 2 main files exceed 500 lines; one is fixed by D1 and the other should stay long. The real waste is the 42.7% comment ratio and test duplication — see §3. |
| "Just upgrade Checkstyle to the latest and turn it on" | **No — the version is the smaller problem.** Measured: **12 of 717 findings (1.7%) actually need a linter**; 494 are layout a formatter fixes for free and 211 come from rules that must be deleted because they contradict D33. Upgrading 10.13.0 → 13.9.0 and enabling it would hand a human ~494 mechanical edits and still find zero bugs. Formatter first (Spotless), then reassess whether the residual 12 justify keeping Checkstyle at all — the boundary rules that would have been ArchUnit's job already ship as D3. See §3 D36. |

### A note on `tasks/todo.md` unchecked boxes

A sweep of that file found **34 unticked `- [ ]` items**; the majority are *stale plan checkboxes*
from slices that subsequently shipped, not outstanding work. They were verified individually against
the source, spec and migrations before landing here. **This register — not the checkbox state in
`todo.md` — is authoritative for what remains.**
