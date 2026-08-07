# PuneNest Backend API & Code Standards

**Status:** authoritative. Applies to every backend slice. The auth + users slice
(`com.punenest.api.auth`, `com.punenest.api.user`) is the reference implementation — new slices copy
its shape. Where this doc and the OpenAPI spec disagree, **the spec wins** (fix the spec first, then
code); where the spec is silent, this doc governs.

---

## 1. The contract is law

- `backend/src/main/resources/static/openapi/punenest-api.yaml` is the single source of truth for every
  path, verb, request/response shape, status code, `x-roles`, and `security` block.
- Never invent a divergent shape. If the spec is wrong, silent, or self-contradictory: **stop, flag it,
  amend the spec (with rationale), then implement.** Record the decision in `tasks/todo.md`.
- The React frontend consumes these shapes through a provider seam; a byte-compatible response is what
  lets `VITE_API_MODE=mock→http` flip with zero component changes. Treat wire compatibility as a test.

## 2. URIs, verbs, versioning

- Base path `/api`, set via `server.servlet.context-path`; Spring matchers are written **without** it.
  Infrastructure moves with it — health is `/api/actuator/health`, Swagger UI is `/api/docs` — so
  deployment probes must use the prefixed paths. Pinned by `ApiContextPathTest`, which needs a real
  container: MockMvc does not apply the context path at all, so every other HTTP test passes whether
  the property is set or not.
- Nouns, plural collections (`/properties`, `/deals`); sub-resources nest (`/deals/{id}/parties`).
- Verb semantics: `GET` read (no side effects), `POST` create/action, `PATCH` partial update,
  `PUT` full replace (avoid), `DELETE` = **soft-delete/archive** (never hard-delete business rows).
- Versioning is via the spec's `info.version`; breaking changes get a new spec version, not ad-hoc
  `/v2` paths, until a documented major bump says otherwise.

### 2.1 Route paths are constants, never literals

Every route URI lives in **`common.web.Routes`**. A path string is not ordinary duplicated text: it
is duplicated across the controller that declares it *and* `SecurityConfig`, which decides whether it
is public. A typo there fails no build and no happy-path test — it silently leaves a public endpoint
guarded (an outage) or, worse, a matcher too broad (an exposure). Binding both sides to one constant
removes that class of defect.

Rules:

- **Absolute paths only.** Each constant is the full path from the API root, and controllers declare
  mappings at **method level with no class-level `@RequestMapping` prefix**. The alternative — a
  class-level base plus relative method constants — forces every route to exist twice (relative for
  the controller, composed absolute for the security chain), reintroducing the drift this prevents.
  One route, one constant, one meaning.
- Group by feature in a nested holder: `Routes.Auth.LOGIN`, `Routes.Properties.BY_ID`. Compose with
  `+` (`BY_ID = BASE + "/{id}"`) — these stay compile-time constants and remain legal in annotations.
- Security-chain matchers that differ from the route (e.g. `/properties/*` for the public detail read)
  are named constants too, with the reason in Javadoc — single-segment `*` vs `**` is a security
  decision, not a formatting one.
- **Only application routes belong here.** Framework paths (Swagger UI, actuator, static assets) are
  referenced once in `SecurityConfig` and stay literal — they have no controller to drift from.
- Paths exclude the `/api` context prefix, which is applied by configuration.

## 3. Status codes (house discipline)

| Situation | Status | Envelope |
|---|---|---|
| Success (read/update/action) | `200` | resource / wrapper |
| Created | `201` | resource |
| Success, no body (e.g. logout) | `204` | — |
| Malformed request (unparseable, bad param type) | `400` | `Error` |
| Missing/invalid credentials | `401` | `Error` |
| Authenticated but not permitted (RBAC / owner pref) | `403` | `Error` |
| Not found | `404` | `Error` |
| Conflict (uniqueness, state, lost concurrent update) | `409` | `Error` |
| Failed `If-Match` precondition | `412` | `Error` |
| Semantic validation failure (bean validation) | `422` | `ValidationProblem` |
| Rate limited | `429` | `Error` + `Retry-After` |
| Uncaught | `500` | `Error` (no internals leaked) |

Note the deliberate split: **`400` = can't parse**, **`422` = parsed but invalid**. Auth failures stay
vague (`Invalid credentials`) so endpoints never leak whether an identity exists.

**`409` vs `412` is also a deliberate split, and it is about who asked.** A `409` says the request
conflicts with reality and would conflict again if resent — a duplicate unique key, an illegal state
transition, or a lost optimistic-lock race on a row two ops staff were editing. A `412` says the
caller *asked to be stopped* if the resource had moved, and it had: nothing was written, no audit row
was recorded, and the recovery is to re-read and re-apply rather than to reconsider. Conditional
writes are opt-in per endpoint (`/admin/settings` is the first) and the header is never required —
mandating it would break existing callers and turn a safety feature into an outage.

## 4. Error & validation envelope

- One `@RestControllerAdvice` (`common.error.GlobalExceptionHandler`) owns all error rendering.
- `Error` = `{ error, message, status, traceId? }`; `ValidationProblem` adds `fields[]`
  (`{field, message}`). `traceId` is the request correlation id, omitted when absent.
- Throw the typed hierarchy (`common.error.*Exception`), never raw `ResponseStatusException`; each
  exception carries its contract `error` code. Security-filter failures (pre-dispatch 401/403) are
  rendered by `RestAuthEntryPoint` / `RestAccessDeniedHandler` to the identical envelope.
- Error codes come from **`common.error.ErrorCodes`**, never inline literals. They are API surface —
  the React client branches on them (e.g. `aadhaar_required` drives the verification prompt), so a
  code is `snake_case` and **stable**: renaming one is a breaking change, not a refactor. The two
  auth messages that both the filter chain and the advice must emit byte-identically live in
  `ErrorCodes.Messages` for the same reason.

## 5. Pagination, sorting, filtering

- Wrapper `common.web.PageResponse` = `{ content, page, size, totalElements, totalPages, sort }`.
- Zero-indexed `?page=&size=` (clamp `size`), `?sort=field,dir` (multi-sort joined by `;`).
- Every sort/filter field must be backed by a DB index (see the Flyway schema); don't expose a filter
  the schema can't serve efficiently.
- `size` is capped at **100** globally by `spring.data.web.pageable.max-page-size`. Spring's own
  default is 2000, so this is not optional — and it must be duplicated in
  `src/test/resources/application.properties`, which *shadows* the main file rather than merging with
  it. Without the duplicate, tests "prove" a cap the test run doesn't have.

### 5.1 Which collections get paged

Paginate when the collection's size grows with **the platform**. Return a bare array when it grows
with **one user's own activity**, or when it is fixed reference data.

| Growth driven by | Shape | Examples |
| --- | --- | --- |
| Platform (all users, all rows) | `PageEnvelope` | `/properties`, `/societies`, `/users`, `/tickets`, `/admin/*` |
| One user's own actions | array | `/me/deals`, `/me/offers`, `/me/visit-requests` |
| **Inbound demand** — rows written by *other* users against the caller | `PageEnvelope` | `/messages`, `/me/saved` |
| **Time** — rows accrue on a schedule and are never culled | `PageEnvelope` | `/me/finances/{propId}/transactions`, `/me/rent-ledger`, `/me/rent-payments` |
| Fixed reference / CMS data | array | `/fees`, `/cities`, `/localities`, `/plans`, `/faqs` |

The middle rows are the ones that get confused. A landlord has eight offers, not eighty thousand,
so paging `/me/offers` buys nothing and costs a `count(*)` on every read. But a *ledger* under `/me/`
looks equally personal while growing every month on its own — a five-year tenancy is sixty rent rows
that nothing deletes. **Scope is not the test; growth is.**

**The inbound-demand row was added after the fact, and it is the one that catches people.** "Grows
with one user's own actions" reads as a statement about scope, and several `/me/` collections satisfy
the scope while failing the growth test, because the row is written by somebody else: a contact
request, an offer on your listing, a visit booking, an enquiry. Those grow with how well a listing is
doing, which is precisely the case where the array gets large — the successful owner is the one the
unpaged read punishes. `/messages` carried a Javadoc arguing the opposite for exactly this reason,
and it was true for a seeker and false for an owner.

`/me/saved` is the neighbouring failure: genuinely the caller's own clicks, but its Javadoc claimed
the list was "structurally bounded" while naming no structure, and none exists. **"One user's clicks"
is a rate, not a bound.** A bound is a constraint you can point at — `idx_reviews_author_target`, or
an explicit service cap.

One operation cannot serve two growth profiles. `GET /support/tickets` used to read "my tickets
(all for admin)", which is a bare array for the customer and a platform-wide table for the admin -
so it had to either change shape with the caller's role or return every support conversation on the
platform unbounded. Slice 12 narrowed it to the caller's own. When a role needs the platform-wide
view of something, that is a *different, paginated operation*, normally under `/admin/`.

Two rules that follow, and are not optional:

- **An array response must have a bound.** If a collection can't be shown to stay small, either page
  it or cap it explicitly in the service (`PropertyService.FEATURED_CAP`, `SocietyService.MAX_HOMES`).
  "Small in practice today" is a measurement, not a guarantee — write the cap down.
- **A client-side pager is a smell, not a solution.** `Table.jsx` slices a full array in the browser
  and renders `Showing 1–10 of {rows.length}`. Against a mock that's free; against a real API the
  server has already serialised everything and the pager is a lie about network cost. If a screen
  needs a pager, the endpoint feeding it needs `PageEnvelope`.

## 6. Auth, roles, trust

- Stateless `Authorization: Bearer <jwt>`; the principal (`security.AuthPrincipal`) is resolved
  server-side from signed claims — **never** trust client-supplied identity/role fields.
- Enforce `x-roles` with `@PreAuthorize("hasRole(Roles.X)")`; `/me/**`-style reads are scoped by the
  principal id, so a caller can only touch their own rows.
- Trust ladder (ADR-019): **mobile-OTP L1 is the floor** to participate; the Aadhaar/Verified badge (L2)
  is a **signal, never a hard gate**. Don't `403` on missing L2.
- Passwordless consumers (OTP); staff/admin use BCrypt email+password. Refresh tokens rotate with
  reuse-detection; logout revokes the refresh family (stateless access tokens expire naturally).

## 7. Layering & package-by-feature

- Package by **bounded context**, with flat feature/aggregate sub-packages under
  `com.punenest.api.<context>[.<aggregate>]` (e.g. `identity.auth`, `identity.user`); shared machinery
  lives in `common.*`, `security.*`, `provider.*`. No `service/`/`controller/` layer packages. The
  definitive layout, dependency rules, context→package→schema mapping, and enforcement decision are in
  [`package-structure.md`](./package-structure.md) — that doc is authoritative for *where code lives*.
- Responsibilities: **Controller** = validate envelope + delegate + map at the edge (thin, no logic).
  **Service** = business logic + transactions (`@Transactional`), composes foundation pieces, owns no
  crypto/HTTP. **Repository** = Spring Data queries; soft-delete-aware finders (`…AndArchivedFalse`).
- Constructor injection only (no field `@Autowired`). Compose small single-responsibility services;
  don't build god-services.

### 7.1 Domain vocabulary is constants, owned by its feature

Enum-like domain values (statuses, roles, intents, purposes) are **named constants declared in the
package that owns the concept** — not literals sprinkled across services. They are simultaneously DB
values and API surface, so a stray typo is a data bug and a contract bug at once, and nothing fails
until a user hits it.

| Vocabulary | Home | Source of truth |
|---|---|---|
| Listing moderation status | `catalog.property.PropertyStatus` | OpenAPI `PropertyStatus` enum |
| Deal intent + price unit | `catalog.property.DealIntent` | OpenAPI `DealIntent` enum |
| Roles (both forms) | `security.Roles` | OpenAPI `Role` enum |
| OTP purpose | `identity.auth.OtpCode.PURPOSE_LOGIN` | `otp_codes.purpose` column |
| Error codes | `common.error.ErrorCodes` | Error envelope contract |

Rules:

- **Trace every constant to the spec.** These constants are the Java spelling of a contract enum, not
  a fresh invention. If a value isn't in the spec, fix the spec first.
- **Roles exist in two forms and both are declared together.** The wire form is lower-case (JWT `role`
  claim, `users.role`, client JSON — `Roles.Wire.BUYER`); Spring Security matches upper-case
  authorities (`Roles.BUYER`, used in `@PreAuthorize`). Both must be compile-time constants, because
  the authority form is used inside an annotation and cannot be derived with `toUpperCase()`.
- **A rule that derives one value from another lives with the constants, as a method.** `DealIntent
  .priceUnitFor(deal)` replaced a ternary that was inlined at two call sites — two copies of a domain
  rule that must never disagree, or a rental would advertise a lakh-scale figure as monthly rent.
- **Validation regexes are composed from the constants** (`DealIntent.PATTERN`), so the accepted input
  set and the domain vocabulary cannot drift.
- **Constants, not Java `enum`s — for now, deliberately.** The columns, DTO records, and query filters
  all carry `String`, matching the contract's string enums. Promoting these to real enums means
  converters, DTO signature changes, and a migration story for any DB value the enum lacks. That is
  worth doing when a value gains behaviour (e.g. a moderation state machine); today it buys nothing
  beyond what a typo-proof constant already gives. Revisit per-vocabulary, not wholesale.

## 8. DTOs, mapping & the entity↔wire boundary

- DTOs are Java `record`s. **Never serialize a JPA entity** — map to a response record at the edge,
  so internal columns (`password_hash`, soft-delete triplet) can't leak and the JSON stays pinned to
  the contract.
- Request records carry Bean-Validation annotations mirroring the spec (`@NotBlank`, `@Pattern`,
  `@Email`); validation fails fast at the controller with a `422`.
- Update records accept **only** user-editable fields — server-owned identity/trust fields are omitted
  so a client can't self-escalate by PATCHing them.

### 8.1 Entity→DTO mapping with MapStruct

- **Mechanical mapping is generated, not hand-written.** Each context owns a `@Mapper(componentModel =
  "spring")` interface (`UserMapper`, `PropertyMapper`), constructor-injected into
  services/controllers like any other bean. This removes the long, error-prone `from()` getter/setter
  factories and scales to the 40+-field aggregates coming in later slices.
- **Convention — opaque ids:** each mapper carries `default String map(UUID id)` so entity `UUID`
  primary keys render as the string ids the contract/UI expect. Add it once per mapper.
- **Trust carve-out (non-negotiable):** any masking, gating, or trust-shaping is **hand-written in a
  `default`/`private` mapper method and never left to generation.** Example: `PropertyMapper.toOwner`
  masks the owner mobile (`98XXXXX210`) by hand; its `maskMobile` helper is `private` **specifically**
  so MapStruct will not silently auto-apply it as a `String→String` converter to every field. Security
  behaviour must stay reviewable in source, not buried in generated code (ADR-019, §6).
- **When to hand-write instead:** if a mapping is *entirely* trust-shaping (one masked projection), a
  plain `default` method is clearer than a generated one — prefer the shortest correct form (`ponytail`).

> **Build note (VS Code + Maven output collision).** The MapStruct processor is wired via the
> compiler plugin's `annotationProcessorPaths`. Command-line Maven builds write to **`target-cli`**,
> not `target` — see `<buildDirName>` in `backend/pom.xml` and `backend/.mvn/maven.config`, which
> applies the override automatically. Reason: the VS Code Java language server (redhat.java / m2e)
> continuously compiles this project into `target/classes` with its own bundled **JDK 21** and the
> Eclipse compiler. When a CLI build shares that directory the two race, and the IDE overwrites
> Maven's Java 25 bytecode — surfacing as `NoClassDefFoundError: <Type>` (a descriptor that lost its
> package) or `java.lang.Error: Unresolved compilation problems` at test runtime. This is **not** a
> MapStruct or javac defect: the identical sources built outside the workspace are always green.
> `useIncrementalCompilation` is also disabled so a bad class can never be carried forward.
> If you ever see those errors again, check that `-DbuildDirName=target-cli` is in effect.
> See `tasks/lessons.md`.

## 9. Provider seams

- Every external dependency (OTP/SMS, storage, payments, KYC) sits behind an interface with a
  deterministic mock (`@Profile("!prod")`) and a prod impl/stub (`@Profile("prod")`). The app must run
  and be demoable with **zero paid keys**; secrets come from env only.

## 10. Documentation standard (enforced)

Every public class and method carries Javadoc that explains the **why**, not the what:

- **Class Javadoc:** the responsibility, the design/cost reason for existing, and any invariant or
  security/trust rule it upholds (cite the ADR, e.g. ADR-019). One or two tight paragraphs.
- **Method Javadoc:** the contract it satisfies (operationId where relevant), preconditions, side
  effects, and what it throws and when — especially security-relevant branches.
- **DTO Javadoc:** each field's meaning and constraint; call out fields that are deliberately
  omitted/ignored (and why).
- Restating the signature in prose is banned. Comment only where a reader needs the reason.
- **`@param` is not mandatory, and a `@param` that restates the parameter name is banned.**
  `@param city city (required)` and `@param lat latitude, nullable` document nothing — they cost a
  line, and the `(required)` / `nullable` half is worse than nothing because it **duplicates the
  `@NotBlank` / `@Nullable` annotation on the next line**. Two sources of truth for one fact, and
  the prose copy is the one that drifts silently when the annotation changes. Write `@param` only
  when it says something the name and the annotations do not: which external field it maps to, the
  unit, the coordinate system, what an out-of-range value does.
  *A partly-documented parameter list is fine and expected* — the informative lines earn their place
  precisely because the empty ones are gone.
- `// ponytail:` marks a deliberate pragmatic shortcut, with the justification inline.
- `// why:` marks a non-obvious correctness/security decision inline.

> **Why this clause exists (tech-debt D33).** The original rule required Javadoc on every public
> member, which produced **673 `@param` against 31 `@return`** — a ratio that is a habit, not
> documentation. Deleting the empty ones without changing the rule would have grown them straight
> back, so the rule changed first and the cleanup followed.

## 11. Testing bar per slice

- Prove **contract shape** (status + JSON envelope) and **behavior** for each endpoint's happy and
  failure paths through the real filter chain (`@SpringBootTest` + MockMvc).
- Include a **mock-provider parity** assertion so drift from the frontend's expected shape fails CI.
- Boot runs under `ddl-auto=validate` against the live Flyway'd Postgres — booting is itself a
  schema-validation test. `mvn -o verify` must be green (existing + new).
- Review order per repo policy: `java-reviewer` → `code-reviewer` → `security-reviewer` (auth/user-data).
