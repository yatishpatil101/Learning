# Draazy Backend API & Code Standards

**Status:** authoritative. Applies to every backend slice. The auth + users slice
(`com.draazy.api.auth`, `com.draazy.api.user`) is the reference implementation — new slices copy
its shape. Where this doc and the OpenAPI spec disagree, **the spec wins** (fix the spec first, then
code); where the spec is silent, this doc governs.

---

## 1. The contract is law

- `backend/src/main/resources/static/openapi/draazy-api.yaml` is the single source of truth for every
  path, verb, request/response shape, status code, `x-roles`, and `security` block.
- Never invent a divergent shape. If the spec is wrong, silent, or self-contradictory: **stop, flag it,
  amend the spec (with rationale), then implement.** Record the decision in `tasks/todo.md`.
- The React frontend consumes these shapes through a provider seam; a byte-compatible response is what
  lets `VITE_API_MODE=mock→http` flip with zero component changes. Treat wire compatibility as a test.

### 1.1 How `SpecCoverageTest` enforces it

- **Both directions of the equality are enforced.** Served-but-undeclared is a surface nobody
  reviewed — it is how an endpoint ships without an `x-roles` line ever being considered.
  Declared-but-unserved is a published promise that 404s, and a client author has no reason to
  suspect the document over their own code. Enforcing only one direction just moves where the drift
  accumulates. Declared-but-unserved is held as an exact set, not a ratchet: such an operation is
  either the next thing to build or it should come out of the contract.
- **`IMPLEMENTED_FLOOR` is a running sum of what each slice added, not the live count.** It is a
  floor, not a target — it catches a slice that silently unmaps something while adding new work. An
  author raises it by exactly what their own slice added; the arithmetic catching up to the live
  count is the next author's to do. Raising it to a number that includes somebody else's in-flight
  work makes the ratchet fail on any branch without that work. Never lower it to make a build pass,
  except when operations are deliberately withdrawn from the contract and the tree.
- **Paths are compared with parameter names erased** — `/{id}` and `/{propId}` are the same route to
  a router and differ only in spelling.
- **`@LocalOnly` controllers are exempt, keyed on the marker annotation and not on the `@Profile`
  expression behind it.** Their routes answer 404 everywhere that matters, so declaring them would
  publish the exact rot the declared-but-unserved rule exists to catch. Reading the profile
  expression instead meant the exemption silently stopped applying the moment that expression
  changed. A controller enabled by some other profile still reaches production under it and must be
  declared like anything else.

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

**`429` is now possible on every mutating request, not just OTP send.** `WriteRateLimitFilter` caps
`POST`/`PUT`/`PATCH`/`DELETE` per caller in a fixed window (closing D2), so a client must treat 429 as
a general answer and honour `Retry-After` rather than special-casing the one endpoint that used to
return it. Because the refusal happens in the filter chain, the body is rendered by `SecurityErrors`
rather than the advice — byte-identical `Error` envelope, same `traceId`, and it is worth keeping that
way: two shapes for one status is how a client ends up parsing only the one it saw first. Reads are
not limited, with the single exception of the anonymous `GET /documents/shared`.

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
  the React client branches on them (e.g. `verification_required` drives the verification prompt), so a
  code is `snake_case` and **stable**: renaming one is a breaking change, not a refactor. The two
  auth messages that both the filter chain and the advice must emit byte-identically live in
  `ErrorCodes.Messages` for the same reason.

### 4.1 `attemptsRemaining` and `retryAfterSeconds` are in the body on purpose

Both duplicate information a header could carry (`Retry-After`) or that a header would be the
obvious home for. They are in the envelope because **the app exposes no CORS response headers**, so a
browser on another origin cannot read one. The header is for proxies; the field is for the screen
that has to put a number in front of a person. Both are nullable and absent on every error that is
not, respectively, a wrong OTP or a rate limit.

`OtpIncorrectException` is a subclass of `UnauthorizedException` rather than a nullable count on the
shared type, so that only the one path that can honestly answer the question is able to claim an
answer. Its machine code stays `unauthorized`: a client switching on `error` must not have to learn a
new value to keep handling a wrong password, and the count's presence is itself the signal that a
countdown is available. `attemptsRemaining: 0` means the *next* verify is refused and the user needs
a fresh code — not that this attempt was the refusal.

### 4.2 Why several codes are deliberately distinct from the generic one

Each of these shares a status with a more general code and exists because the client must do
something different. The recurring test: **does the recovery a client would offer for the generic
code actually work here?**

| Code | Status | Why not the generic code |
|---|---|---|
| `account_archived` | 401 | An ordinary 401 on the OTP route is about the code, so the answer is another code. This one is terminal — every fresh code verifies and lands here again, sending the user round that loop until their send budget is gone. |
| `signups_closed` | 403 | Terminal in the same way, and equally not about the code. A plain 403 is answered by signing in as somebody permitted, which is precisely the move these refusals do not accept. |
| `verification_required` | 403 | The *only* legitimate verification-driven 403 on the contact path (ADR-019, badge-not-gate). A missing L2 badge never blocks anything else, so the client can safely treat this code — and only this code — as "offer the identity-verification prompt". |
| `review_not_eligible` | 422 | No permission fixes it, only going to see the flat does. A review is worth reading only if the person writing it went there. |
| `contact_quota_exhausted` | 422 | Not 403: signing in again does not conjure contacts. Not 429: a 429 promises the request succeeds if you wait, and this quota is a lifetime total. What fixes it is subscribing or referring. |
| `listing_quota_exhausted` | 422 | Same reasoning, except this quota is not a lifetime total — taking a listing down frees the slot. Still not a 429: nothing expires on its own. |
| `otp_attempts_exhausted` | 429 | The promise a 429 normally makes — wait, then retry — is the one thing that cannot work here. `rate_limited` is also what the per-IP write filter answers with, so a client reading only the status cannot tell "this code is dead" from "the network you share is busy", and either mistake strands a user. |
| `maintenance_mode` | 503 | Not 403 (clients answer a 403 by offering to sign in, which does not end a window) and not `rate_limited` (nothing the caller did caused it). The distinct code is what lets a client say "back shortly". |
| `precondition_failed` | 412 | Not `conflict`: the caller asked to be stopped if the resource had moved, so the recovery is re-read and re-apply rather than reconsider the request. |
| `already_reviewed` | 409 | One voice, one review — a rating average one account can move fifty times is not an average of anything. Paired with a UNIQUE index, not only a service check, so the answer holds under concurrent submits. |
| `identity_already_registered` | 409 | One document, one badge (ADR-009b), enforced by the UNIQUE `identity_hash` at approval. Fires only inside the opt-in badge flow; it never blocks posting or contact. |

Two codes are raised from more than one place and **must stay identical across both**, or a client
learns two names for one refusal: `payload_too_large` (our own check *and* the servlet container's
multipart limit, which trips before a controller is entered) and `unsupported_media_type` (the
vault's byte-sniffing check *and* Spring refusing a `Content-Type` the endpoint does not declare).

### 4.3 Handlers in `GlobalExceptionHandler` that exist for non-obvious reasons

- **405, 415 and 404-no-route.** Spring resolves these itself, but only if nothing upstream claims
  them first — and this class carries an `@ExceptionHandler(Exception.class)` catch-all, which is
  broader and wins. Without explicit handlers, `DELETE /properties` or an unmapped path returned a
  500 `internal` with a stack trace, as though the server had failed rather than the caller. The
  no-route case hid in ordinary use because an unauthenticated request is refused by the security
  chain before the dispatcher; you only see it holding a token, which is exactly when someone is
  exploring the surface. The cost is twofold — it inflates error-rate alerting with requests nothing
  went wrong on, and it sends the caller to debug the wrong system. Logged at `debug`: a mistyped URL
  is not an operational event. The `Allow` header on the 405 is part of its semantics, not a nicety.
- **Unparseable bodies say nothing about why.** Jackson writes that message, and it routinely carries
  the target Java class, the JSON pointer and a slice of the submitted payload — publishing the shape
  of the deserialisation layer to anyone willing to POST `{`. Same for a bad query/path parameter:
  the parameter name is safe to return (the caller chose it, and it is in the published contract),
  but `MethodArgumentTypeMismatchException` renders the target Java type. Naming the field is the
  actionable half; the type is the leak. Detail is logged at `debug`.
- **Nested field names win over parameter names in `HandlerMethodValidationException`.** Spring
  routes a method here as soon as *any* of its parameters carries a constraint — and once it does, a
  cascaded `@Valid @RequestBody` arrives as a `ParameterErrors` rather than as the
  `MethodArgumentNotValidException` the same body would have produced on a method with no constrained
  parameters. Reading only `getParameterName()` there reports the Java argument name (`"body"`) and
  drops what the client needs, so the same overlong field answers `"note"` on one controller and
  `"body"` on another purely because a sibling parameter grew a `@Size`.
- **`DataIntegrityViolationException` → 409, handled centrally and never recovered from locally.**
  Several services guard a create with an idempotency lookup and rely on a unique index to settle the
  race when two concurrent requests both miss it. The tempting recovery — catch the violation and
  re-read the winning row — *cannot work*: Hibernate marks the persistence context unusable once a
  constraint fires, so the follow-up read throws `JpaSystemException` and the caller gets a confusing
  500. 409 is the honest reply, and a client retrying the same idempotent request gets the stored
  result because by then the winner has committed. Logged at `warn` with the cause, because a
  not-null or foreign-key violation from a genuine bug also reaches here and must not disappear
  behind a tidy 409.
- **`OptimisticLockingFailureException` → 409, with different advice.** There the database refused a
  write that was never valid; here it refused one that was valid when the caller loaded the row and
  stopped being valid while they were editing it. The caller did nothing wrong and has not lost their
  input, so the message says "reload, look at what changed, decide whether your edit still applies".
  409 rather than 412 because no precondition was supplied; when `If-Match` reaches settings, a
  failed precondition becomes a 412 and this stays the answer for the unconditional case. Logged at
  `info`, not `warn`: a lost race on the ops board is normal concurrency working as designed, and
  logging it at warning level would train whoever reads the logs to ignore the level that also
  carries real database rejections.
- **The `AuthenticationException` / `AccessDeniedException` handlers are a defensive backstop only.**
  Spring Security's `ExceptionTranslationFilter` normally intercepts both *before* the dispatcher and
  routes them to `RestAuthEntryPoint` / `RestAccessDeniedHandler`. These guarantee the contract
  envelope if such an exception ever reaches the controller layer — for example a manual check inside
  a `@Service`.

### 4.4 Platform settings accessors always answer

`common.settings.PlatformSettings` gives each settings value a named accessor with its fallback and
bounds beside it, instead of `settings.get("fees").get("gstPercent")`. Every accessor has a
defaulted, in-range answer, because this class sits in the path of taking money and the alternative
to a default is a 500 on the pay button because somebody mistyped a config value in the back office.

- **Price fallbacks must match what a healthy install answers** and what `GET /pricing` publishes. A
  default that differed would let a broken config row quietly *change* the price rather than merely
  fail to be read.
- **Every ceiling catches a typo, not an attack.** `MAX_PERCENT = 100` stops a fat-fingered `200`
  billing a member twice what they were quoted. `MAX_PRICE = 100000` catches a trailing zero — a lakh
  is two orders of magnitude past anything sold to an individual. `MAX_CONTACT_GRANT = 1000` matters
  most on the referral bonus, where a mistyped extra zero is not one wrong grant but an unbounded
  one, multiplied by however many referrals somebody can generate; past a thousand the number means
  "no limit", which is what `plans.unlimited_contacts` is for and should be deliberate.
  `MAX_REFERRAL_QUALIFY_PER_MONTH` is not a limit on money but on how many rewards one account can
  mint without anyone looking — an arbitrarily large number switches the fraud desk off.
- **`referralQualifyPerMonth` is deliberately generous** (10/month). A flatshare, a floor of
  neighbours and a WhatsApp group of colleagues are the platform's most common referrals and must fit
  under it comfortably. It gates *automatic* minting only — past it referrals stay pending for the
  fraud desk — so setting it too low costs review time, not honest referrers their reward. It is
  configuration rather than a constant because a fraud threshold has to be movable on the day it is
  wrong: a deployment change, not a release.
- **Prices are whole rupees** because they are catalogue prices an operator types into a box, not
  amounts computed from a percentage; `gstPercent` is the one percentage and is `BigDecimal` for that
  reason. Named one accessor at a time rather than returned as a map, which would put the field names
  back in the caller's string literals.
- **`rentAgreementPlatform` is the platform's share only.** Stamp duty and registration are the
  state's, computed per agreement and collected on top, which is why `platform_fees` carries them.
- **`freeContactLimit` lives in settings** because a caller with no subscription has no `plans` row
  to hold it. A "contact" is one `contact_requests` row, never the digits.

**Flag defaults, and why one of them is inverted.** `signupsEnabled` and `staffLoginEnabled` default
to *on* when absent or malformed, matching the client's `flags[key] !== false`: a fresh install must
not be frozen out of its first member or lock its own operators out. `maintenanceMode` defaults to
*off* and is read as `=== true` on both sides, because it names an outage rather than a capability
and the same default would strand a fresh or malformed install behind the maintenance page with no
way in to fix it.

Both `signupsEnabled` and `staffLoginEnabled` are **server-enforced, not merely published on
`GET /flags`**. `signupsEnabled` decides whether a row is written and `POST /auth/login` provisions
on first verified sign-in, so a client-only guard would leave the only account-creating consumer path
wide open while the back office reported onboarding shut. `staffLoginEnabled` is reached for during
an incident, and an attacker posts to the endpoint rather than clicking the button — and it binds
**staff and not admins**, because the flag lives behind the admin console and an admin refused by it
would have destroyed the only route back to the switch.

**`PlatformSettings.flag` puts the repository call outside the `try` on purpose.** "Nobody has
configured this" and "the database did not answer" are different facts and only the first may default
to open: Hibernate has already marked the transaction rollback-only, so a gate that answered `true`
would let the `REQUIRES_NEW` write it guards commit on its own connection and then fail the outer
request — minting the very account the flag exists to prevent, orphaned, behind a 500 nobody reads as
a bypass. A non-boolean is treated as undecided rather than coerced, because it is not a value.

**`GET /flags` is public and deliberately one block wide.** It serves `settings.flags` and nothing
else — not `adminFlags`, not `fees`, not `permissions` — because those toggles gate what an anonymous
visitor sees while the same document holds the fee table and the permission map. Publishing a flag
there is **not** enforcing it: `kycBadgeEnabled` and `boostEnabled` are render-only and the actions
behind them have their own guards. Non-boolean values are dropped rather than forwarded, since the
contract types the map as booleans and a `"false"` string would read as *enabled* either way. A
missing or unparseable row answers `{}` rather than failing, because every consumer is a page render
and the alternative is a blank site because somebody mistyped a config value.

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
| **Time** — rows accrue on a schedule and are never culled | `PageEnvelope` | `/me/finances/{propId}/transactions` |
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

### 5.2 Who narrows a result set

**The server owns the result set: which rows are in it, in what order, how many there are, and which
page you are looking at.** The client owns only *refinements*, and a refinement has to pass all three
of these:

1. it reads fields that are already on a row in hand,
2. it cannot change any number the page displays, and
3. turning it off needs no fetch.

Map pins, card badges and the price a card prints are refinements. A filter is not.

Three corollaries, each of which was learned the expensive way on `/flatmates/feed`:

- **Whoever filters must also count.** A browser that drops rows makes every count on screen a count
  of the survivors. "24 homes available" and "no results match your filters" both became claims about
  a page rather than about the market, and neither was flagged by anything — they are plausible
  numbers, just answers to a question nobody asked.
- **Whoever filters must also sort and page.** Sorting a page re-orders the rows in hand, so the top
  of page 2 outranks the bottom of page 1. This cannot be seen on any single screen, which is why it
  survives review.
- **Never filter the same field on both sides.** Two predicates over one field intersect to the
  *narrower* one, so whatever the server just learned to match is silently discarded by the client
  copy — and only for the newly-matching values, so every existing test stays green. Delete the
  client predicate in the same commit that adds the server clause; do not keep it as belt-and-braces.

The tell that a split has gone wrong is a **fetch ceiling**: code that reads the first N rows and
filters them locally is not paging, it is sampling. If you find one, the filter is on the wrong side
of the wire.

## 6. Auth, roles, trust

- Stateless `Authorization: Bearer <jwt>`; the principal (`security.AuthPrincipal`) is resolved
  server-side from signed claims — **never** trust client-supplied identity/role fields.
- Enforce `x-roles` with `@PreAuthorize("hasRole(Roles.X)")`; `/me/**`-style reads are scoped by the
  principal id, so a caller can only touch their own rows.
- Trust ladder (ADR-019): **mobile-OTP L1 is the floor** to participate; the reviewed Verified badge (L2)
  is a **signal, never a hard gate**. Don't `403` on missing L2.
- Passwordless consumers (OTP); staff/admin use BCrypt email+password. Refresh tokens rotate with
  reuse-detection; logout revokes the refresh family (stateless access tokens expire naturally).
- The refresh token travels **only** as an `HttpOnly; Secure; SameSite=Lax; Path=/` cookie
  (`__Host-draazy_rt`; the bare name over plain-HTTP dev, where a browser rejects the prefix) — it
  is never in a response body and no client can read it, so `POST /auth/refresh`
  takes no credential in its body and answers `401` (not `422`) when the cookie is absent. Browser
  callers must therefore send `credentials: 'include'`. A token replayed within a few seconds of the
  rotation it lost is served from the family's live head rather than read as theft: two of the user's
  own tabs can race, and now that the token is unreadable the client can no longer break the tie.

## 7. Layering & package-by-feature

- Package by **bounded context**, with flat feature/aggregate sub-packages under
  `com.draazy.api.<context>[.<aggregate>]` (e.g. `identity.auth`, `identity.user`); shared machinery
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
- **Constants by default; an `enum` once the vocabulary grows behaviour.** The columns, DTO records,
  and query filters carry `String`, matching the contract's string enums, and promoting one means a
  converter, DTO signature changes, and a migration story for any DB value the enum lacks. That price
  is worth paying exactly when a value gains behaviour — a state machine, a settable subset — because
  the alternative is static helpers taking the `String` they should have been methods on, which the
  compiler cannot police. `ServiceRequestStatus` is the one that has been converted (D11) and the
  shape to copy: a `wire()` value that is the DB and JSON form, a nested `AttributeConverter` named
  on the field (**never `@Enumerated`**, which writes `IN_PROGRESS` into a column whose `CHECK` wants
  `in-progress`), `@JsonValue`/`@JsonCreator` at the wire, `toString()` returning `wire()` so
  interpolated messages do not drift, and JPQL comparisons written as fully-qualified enum literals
  rather than string literals. Delete the old constant holder in the same change — two vocabularies
  for one concept is worse than either. **Revisit per-vocabulary, not wholesale**, and note that
  `Roles` is not a candidate at any size: its upper-case authority form is interpolated into
  `@PreAuthorize`, which requires a compile-time `String` constant.

### 7.2 Route URIs are constants in `common.web.Routes`

Every HTTP route the application serves has exactly one constant in `common.web.Routes`, and both
the controller mapping and the `SecurityConfig` matcher are declared from it.

**Why.** A route string is duplicated across two files that must agree or the app is *insecure*: the
controller that declares it, and the security chain that decides whether it is public. A typo in the
chain fails neither the build nor a happy-path test — it silently leaves a public endpoint
authenticated (an outage), or leaves a matcher too broad and exposes a route that should be guarded.
One constant on both sides makes that class of drift impossible.

Rules:

- **Absolute paths only.** Each constant is the full path from the API root, and controllers declare
  mappings at method level with no class-level `@RequestMapping` prefix. A class-level base plus
  relative constants would force every route to exist twice — relative for the controller, composed
  absolute for the security chain — reintroducing the drift the class removes.
- **Compile-time constants**, so they are legal inside annotations and composable with `+` (see
  `Properties#BY_ID`). Paths are relative to the `/api` servlet context prefix, which is applied by
  configuration and never repeated in a constant.
- **Only routes this application serves.** Framework paths (Swagger UI, actuator, static assets) are
  referenced once, as literals, in the security chain — they have no controller to drift from.
- **Security-chain matchers are single-segment (`*`) unless a deeper route is meant to be public.**
  A `**` sweeps every future deeper route into the public allowlist before anyone has decided it
  should be. Where a deeper read *is* public (e.g. a listing's rooms), it gets its own explicit
  allowlist entry — being a read on a public resource does not make it public by inheritance.
- **An exact path outranks a template one**, so a literal sibling of a `{id}` route (`/properties/
  trust-stats` beside `/properties/{id}`) can never be read as an id.

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

## 12. The platform settings document (`/admin/settings`)

Relocated from `AdminSettingsService`'s code comments.

### Storage shape and why PUT merges

Storage is one row per top-level key (`fees`, `flags`, `site`, ...) so a server component can read
the block it needs without deserialising the whole document; the wire shape is their union. An
unparseable row is skipped with a warning on read, because an admin locked out of the settings
screen cannot fix the row that locked them out.

`PUT` deep-merges rather than replaces, because every property is optional and replace semantics
would have the flags panel silently wipe the fee table. Objects merge key by key; arrays and scalars
are replaced whole, because merging two ordered lists positionally would produce an entry nobody
wrote. A `null` value is skipped rather than treated as a delete: a null from a client that
serialises its whole form is indistinguishable from a deliberate "remove the fee table", and
deleting would quietly unprice the platform.

The merge is depth-bounded at 12 because it recurses over attacker-influenced structure (`site`,
`fees` and `permissions` all allow additional properties), and unbounded means a
`StackOverflowError` in a request thread. Past that depth the incoming subtree replaces the base one
outright - twelve levels deep, nobody is editing a settings form.

### The ETag

A strong ETag over every stored block, hashed from the stored strings so key ordering on the way out
cannot move it, with unparseable rows included so a write that repairs one is not mistaken for no
change. It is a content hash rather than `@Version` because the resource an admin edits is the union
of several rows and a byte-identical save must leave the tag alone. SHA-256 truncated to 128 bits: a
change detector, not a signature. It is private and computed inside the transaction that produced
the body it describes, because a tag read in a second transaction can describe a document the caller
was never shown.

`If-Match` follows RFC 9110 13.1.1: absent means unconditional so callers that omit it keep
last-write-wins, `*` always matches because the document always exists, and a list matches on any
entry. Weak (`W/`) tags are not accepted - RFC 9110 requires strong comparison for `If-Match` and
this endpoint issues strong tags.

### The three refusals, and why they are refusals

All three share a shape: each would otherwise be **stored and enforced by nothing**, while the
console reads the document back and reports the change as saved. They are checked before anything is
written, and a `null` value is refused alongside a real one - a client that sends the key at all is
built against a feature that does not exist.

Unsupported keys are checked **first**, before `If-Match`: an unsupported key is a permanent defect
in the request, whereas a stale precondition succeeds on retry, and answering the transient problem
first loops the client forever.

- **`customRoles`** is a deny-list entry rather than the whole table being an allow-list, because
  the table is deliberately open (`geo` is read by the client and never appears in `AdminSettings`).
  Back-office access is decided by role, team and the `permissions` allow-list.
- **Non-boolean `flags.*`.** Every reader treats a non-boolean as undecided (`AppFlagsController`
  drops it from `GET /flags`; `PlatformSettings.flag` returns its absent-means-ON default), so
  `{"flags":{"signupsEnabled":"false"}}` would be stored, audited as a change, echoed back and
  enforced as *on*. Refused rather than coerced: guessing is unrecoverable in the direction that
  silently opens something.
- **`geo.cities.*.live`.** City launch state is a column on `cities` served by `GET /cities`,
  because a value deciding what a logged-out visitor sees cannot have an administrator-only reader.
  It is nested rather than in the top-level deny set because `geo` is very much supported - it still
  carries `enforceCityLimit`, the map centre and bounds, and the blacklist.
