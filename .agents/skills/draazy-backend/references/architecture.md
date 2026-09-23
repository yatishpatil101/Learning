# PuneNest backend — architecture

How a PuneNest Spring Boot service is structured. Mirror the existing **auth/identity slice**
(`com.punenest.api.identity` + `com.punenest.api.security`); this file generalizes its patterns so
every new feature looks the same.

## Table of contents
- Package-by-feature layout
- Layering & responsibilities
- DTOs as records
- Error handling & the standard error shape
- Pagination
- Auth: JWT & role guards
- The contact / Aadhaar gate
- Provider seams (external services)
- Caching
- Config & profiles
- Build / run / test

## Package-by-feature layout

Group by domain feature, not by technical layer. Each feature is a self-contained package under
`com.punenest.api`:

```
com.punenest.api
├── PunenestApiApplication.java
├── common/            # cross-cutting: error/ (ApiError, GlobalExceptionHandler), web/ (PageResponse,
│                      #   request params), config/, validation/, persistence/, audit/, trust/, settings/
├── security/          # JwtService, JwtAuthFilter, SecurityConfig, @CurrentUser, Roles, Teams
├── provider/          # external-service seams (OtpSender, KycProvider, PaymentGateway, FileStorage)
├── identity/          # login, OTP verify, staff-login, token issue, accounts, roles, Aadhaar/KYC state
│                      #   — the REFERENCE slice; study it before writing new features
├── catalog/           # listings, search, foundation-field rules, archive
├── leads/             # contact requests + the gate, enquiries, visits
├── deals/             # deals, offers, finalization (maker-checker)
└── documents/ finance/ services/ engagement/ moderation/ content/ billing/ admin/
```

Within each feature package:

```
property/
├── PropertyController.java     # @RestController, thin — no business logic
├── PropertyService.java        # business rules, transactions, orchestration
├── PropertyRepository.java     # Spring Data JPA interface
├── Property.java               # @Entity (JPA), snake_case columns
└── dto/
    ├── PropertyResponse.java   # record — outbound shape (matches the OpenAPI spec)
    ├── PropertyRequest.java    # record — inbound shape + validation annotations
    └── PropertyMapper.java     # entity <-> DTO (plain static methods or MapStruct)
```

## Layering & responsibilities

- **Controller** — HTTP only: bind path/query/body, call the service, return a DTO. No business
  logic, no repository calls. Annotate with `@RestController`, `@RequestMapping("/api/...")`.
- **Service** — the brain: business rules, `@Transactional` boundaries, gating checks, mapping
  orchestration, calls to repositories and provider seams. Constructor injection only.
- **Repository** — Spring Data JPA. Derived queries where possible; `@Query` for anything
  non-trivial. Public list queries filter out archived rows.
- **Entity** — JPA `@Entity` mapping the table. Keep persistence concerns here; never leak entities
  out of the service layer — always map to a DTO.

Use **constructor injection** (a `final` field set in a single constructor); do not use field
`@Autowired`. It keeps classes testable and dependencies explicit.

## DTOs as records

Inbound and outbound payloads are Java `record`s — they are immutable, concise, and make the shape
obvious at a glance. Match the OpenAPI spec (`backend/src/main/resources/static/openapi/punenest-api.yaml`)
field names exactly (the frontend depends on them).

```java
public record PropertyResponse(
        String id,
        String title,
        String type,          // "flat" | "house" | "plot" | ...
        int bhk,
        long price,
        String locality,
        String status,        // "pending" | "active" | "archived" | ...
        boolean archived,
        Instant createdAt
) {}
```

Validate inbound records with Jakarta Validation annotations (`@NotBlank`, `@Positive`, ...) and
`@Valid` in the controller; validation failures flow into the standard error shape below.

## Error handling & the standard error shape

Every error returns:

```json
{ "error": "code", "message": "human readable", "status": 400 }
```

Represent it as a record and centralize production in a `@RestControllerAdvice`:

```java
public record ApiError(String error, String message, int status) {}

@RestControllerAdvice
class GlobalExceptionHandler {
    @ExceptionHandler(NotFoundException.class)
    ResponseEntity<ApiError> notFound(NotFoundException e) {
        return ResponseEntity.status(404).body(new ApiError("not_found", e.getMessage(), 404));
    }
    // aadhaar_required (403), validation (400), unauthorized (401), forbidden (403), conflict (409)
}
```

Define small domain exceptions (`NotFoundException`, `AadhaarRequiredException`,
`ContactNotApprovedException`, ...) and map each to its contract error code. Never return raw stack
traces or Spring default error JSON.

## Pagination

List endpoints accept `?page=0&size=20` (zero-indexed) and `?sort=field,direction`. Use Spring Data
`Pageable`, then map `Page<Entity>` into the contract wrapper:

```java
public record PageResponse<T>(List<T> content, int page, int size,
                              long totalElements, int totalPages) {
    public static <E, D> PageResponse<D> of(Page<E> p, Function<E, D> mapper) {
        return new PageResponse<>(p.map(mapper).getContent(), p.getNumber(), p.getSize(),
                                  p.getTotalElements(), p.getTotalPages());
    }
}
```

## Auth: JWT & role guards

- Stateless JWT. A `JwtFilter` (OncePerRequestFilter) reads `Authorization: Bearer <token>`,
  validates via `JwtService`, and populates the `SecurityContext` with the user id + role.
- Roles: `buyer`, `owner`, `admin`, `staff`. Staff tokens also carry `team`/`teams` claims.
- Guard endpoints with method security (`@PreAuthorize("hasRole('OWNER')")`) or in `SecurityConfig`
  URL rules — whichever the existing `com.punenest.api.security.SecurityConfig` already uses; stay consistent.
- Login is **passwordless**: `/auth/login` verifies a mobile OTP and issues a token;
  `/auth/staff-login` is the internal staff path. OTP verification goes through the OTP provider seam.
- Expose the current principal to services via a small `@CurrentUser` argument resolver or by reading
  the `SecurityContext` in a helper — do not thread the token through method signatures.

## The contact / Aadhaar gate

A buyer can only see an owner contact number after (a) they are Aadhaar-verified and (b) a contact
request is approved. Enforce this server-side, not just in the UI:

1. If the caller is not Aadhaar-verified -> throw `AadhaarRequiredException` ->
   `403 { "error": "aadhaar_required", ... }`.
2. If verified but the contact request is not yet approved -> return the **masked** number
   (`98XXXXX210`) in the response DTO.
3. Only when approved does the service include the real number.

Keep the masking in the service/mapper layer so no controller can accidentally leak the raw value.

## Provider seams (external services)

Every outside dependency hides behind an interface in `com.punenest.api.provider` with two
implementations. The live seams are `OtpSender`, `KycProvider`, `PaymentGateway`, and `FileStorage`:

```java
public interface OtpSender { void send(String mobile, String code); }

@Component                         // default in dev — deterministic, no network, no key
class MockOtpSender implements OtpSender { ... }

@Component @Primary                // used when real profile/keys are present
@ConditionalOnProperty("providers.otp.enabled")
class SmsOtpSender implements OtpSender { ... }
```

The whole app must build, run, and demo with only the mock impls — no paid keys required. Copy this
pattern (see the real `cashfree/` payment impl under `provider/`); the mock stays the dev default and
the real impl is `@Primary` only when its profile/keys are present.

## Caching

For expensive-but-stable facts, cache at write time keyed on the stable inputs. Prefer persisting the
computed value in the DB over an in-memory cache when the result is durable, so it survives restarts
and is queryable.

## Config & profiles

- `application.yml` — shared defaults.
- `application-dev.yml` — mock providers on, local Postgres, permissive CORS to the Vite dev origin.
- `application-prod.yml` — real providers `@Primary`, secrets from env, tight CORS.
- Never commit secrets. Read keys from environment variables; document them in the backend README.
- CORS must allow the frontend origin (`http://localhost:5173` in dev) so the `http` provider works.

## Build / run / test (Windows PowerShell)

The build targets Java 25, so pin the JDK and redirect through `cmd` (PowerShell mangles raw maven
output):

```powershell
$env:JAVA_HOME='C:\Program Files\Zulu\zulu-25'
cd backend
cmd /c "mvnw.cmd -o -f pom.xml verify"                     # compile + tests
cmd /c "mvnw.cmd -o -f pom.xml spring-boot:run"            # run on /api (8080, or 8081 if occupied)
cmd /c "mvnw.cmd -o -f pom.xml -Dtest=PropertyServiceTest test"
```

Chain with `;` and gate with `if ($?) { ... }` — PowerShell has no `&&`.
