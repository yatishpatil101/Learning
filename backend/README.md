# PuneNest API (Spring Boot skeleton)

Empty/skeleton Spring Boot service that hosts the hand-authored **OpenAPI 3.1** contract for the
PuneNest platform. No business endpoints are implemented yet — this is the scaffold plus live API
documentation.

- **Java:** 21
- **Spring Boot:** 4.1.0 (Spring Framework 7)
- **Build:** Maven

## What it serves

| Path | Purpose |
|------|---------|
| `/` , `/docs`, `/swagger-ui` | Redirect to Swagger UI (`/docs/index.html`) |
| `/docs/index.html` | Swagger UI rendering the spec |
| `/openapi/punenest-api.yaml` | Raw OpenAPI 3.1 contract (126 paths / 160 operations / 101 schemas) |
| `/actuator/health` | Liveness/readiness health |

The contract lives at `src/main/resources/static/openapi/punenest-api.yaml`.

> **Note:** springdoc-openapi is intentionally **not** used — its current releases target Spring
> Boot 3.x / Spring 6 and are incompatible with Boot 4.x. Documentation is served as a static YAML
> plus the `org.webjars:swagger-ui` webjar, which is framework-version-agnostic.

## Build & run

Requires JDK 25. On a corporate network you may also need a truststore + a Maven settings file that
points `central` at public Maven Central:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Zulu\zulu-25'
$env:MAVEN_OPTS = '-Djavax.net.ssl.trustStoreType=Windows-ROOT'   # corporate TLS interception

mvn -DskipTests package        # add -s <settings.xml> if your ~/.m2 mirror is internal
java -jar target-cli\punenest-api-0.0.1-SNAPSHOT.jar
```

> **Why `target-cli`?** Command-line Maven builds write there instead of `target`, via
> `-DbuildDirName=target-cli` in `.mvn/maven.config` (applied automatically). `target` is left to the
> VS Code Java language server, which compiles the project with its own bundled JDK 21 and would
> otherwise overwrite Maven's Java 25 bytecode mid-build — producing `NoClassDefFoundError` or
> `Unresolved compilation problems` at test runtime. See `docs/system/api-standards.md` §8.1.

Then open http://localhost:8080/api/docs.

## Next steps

Implement controllers/entities per bounded context (see
[`../docs/system/backend-api-architecture-review.md`](../docs/system/backend-api-architecture-review.md) and
[the OpenAPI spec](../src/main/resources/static/openapi/punenest-api.yaml)). Keep the spec in sync — it is
the machine-readable source of truth.
