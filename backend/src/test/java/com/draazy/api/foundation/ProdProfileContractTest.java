package com.draazy.api.foundation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.file.Path;
import java.util.Properties;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.support.PropertiesLoaderUtils;
import org.springframework.mock.env.MockEnvironment;

/**
 * A misspelled key in the prod file is silently ignored and the base file's *permissive* value wins,
 * so the file is loaded and asserted on directly rather than trusted. Variables: docs/DEPLOY.md.
 */
@DisplayName("The prod profile — a contract nothing else in the suite loads")
class ProdProfileContractTest {

    /**
     * The operator's pre-deploy checklist. A new {@code ${ENV}} in the prod file fails this test
     * until someone has decided it is genuinely mandatory. Each is explained in docs/DEPLOY.md.
     */
    private static final Set<String> REQUIRED_DEPLOY_VARIABLES = Set.of(
            "DB_URL",
            "DB_USER",
            "DB_PASSWORD",
            "JWT_SECRET",
            "WEB_ORIGINS",
            "CASHFREE_WEBHOOK_SECRET",
            "INTERNAL_PROXIES",
            // Undefaulted: a salt committed to this repository is no salt at all.
            "REFERRAL_SIGNAL_SALT",
            // Same reasoning; keys the one-way dedup digest of identity document numbers.
            "IDENTITY_HASH_SECRET",
            // A second connection string, and it must be the session pooler, not DB_URL's
            // transaction pooler — defaulting it to DB_URL would default to a hang.
            "FLYWAY_DB_URL",
            // CookieDeliveryCheck's only input for proving the refresh cookie can get back here.
            "API_PUBLIC_ORIGIN");

    private static final Pattern PLACEHOLDER = Pattern.compile("\\$\\{([^}]+)}");

    /** Surefire sets {@code basedir} to the module root; the VS Code runner defaults one level up. */
    private static final Path MODULE = Path.of(System.getProperty("basedir", "")).toAbsolutePath();

    private static Properties load(String resource) throws IOException {
        return PropertiesLoaderUtils.loadProperties(new ClassPathResource(resource));
    }

    /**
     * Read from the source tree, because {@code src/test/resources/application.properties} shadows
     * the main one for the whole suite and a {@code ClassPathResource} would return that instead.
     */
    private static Properties mainResource(String name) throws IOException {
        Path file = MODULE.resolve("src/main/resources").resolve(name);
        assertThat(file)
                .as("run this from the backend module — the working directory was %s", MODULE)
                .exists();
        return PropertiesLoaderUtils.loadProperties(new FileSystemResource(file));
    }

    private static Properties prod() throws IOException {
        // From the classpath deliberately: this doubles as proof the file is packaged at all.
        return load("application-prod.properties");
    }

    /** Every {@code ${...}} placeholder in the file, with any {@code :default} suffix stripped. */
    private static Set<String> placeholdersIn(Properties properties) {
        Set<String> names = new TreeSet<>();
        for (String key : properties.stringPropertyNames()) {
            Matcher matcher = PLACEHOLDER.matcher(properties.getProperty(key));
            while (matcher.find()) {
                String placeholder = matcher.group(1);
                int separator = placeholder.indexOf(':');
                names.add(separator < 0 ? placeholder : placeholder.substring(0, separator));
            }
        }
        return names;
    }

    @Test
    @DisplayName("the file exists and is loadable at all")
    void theProdProfileIsOnTheClasspath() throws IOException {
        // Spring does not complain about a profile with no properties file, so a misnamed or
        // unpackaged file makes `--spring.profiles.active=prod` a silent no-op.
        assertThat(prod()).isNotEmpty();
    }

    @Test
    @DisplayName("it requires exactly the documented deploy variables — no more, no fewer")
    void theRequiredEnvironmentIsExactlyWhatIsDocumented() throws IOException {
        assertThat(placeholdersIn(prod()))
                .as("a new ${ENV} lookup here is a new mandatory deploy input; say so out loud")
                .containsExactlyInAnyOrderElementsOf(REQUIRED_DEPLOY_VARIABLES);
    }

    /**
     * The assertions above read values, so none can see a misspelled *key* — which still resolves,
     * binds nothing, and lets the base file's permissive value stand. Naming the keys catches it.
     */
    @Test
    @DisplayName("the keys carrying those variables are spelled the way the app reads them")
    void noSecretBearingKeyIsMisspelledOrMissing() throws IOException {
        assertThat(prod())
                .as("a key the app never reads is inert, and inert means the base file's value wins")
                .containsKeys(
                        "spring.datasource.url",
                        "spring.datasource.username",
                        "spring.datasource.password",
                        // Misspell this and Flyway silently falls back to the app's datasource,
                        // which is the transaction pooler it cannot run against.
                        "spring.flyway.url",
                        "spring.flyway.user",
                        "spring.flyway.password",
                        "draazy.security.jwt.secret",
                        "draazy.web.cors.allowed-origins",
                        "draazy.webhooks.cashfree.secret",
                        "draazy.security.trusted-proxies");
    }

    /** A {@code ${DB_URL:...localhost}} added during debugging would satisfy every test above. */
    @Test
    @DisplayName("none of them carries a fallback default")
    void noSecretHasADefaultToSilentlyFallBackTo() throws IOException {
        Properties prod = prod();
        for (String key : prod.stringPropertyNames()) {
            String value = prod.getProperty(key);
            Matcher matcher = PLACEHOLDER.matcher(value);
            while (matcher.find()) {
                assertThat(matcher.group(1))
                        .as("%s must fail the boot when unset, not fall back to a default", key)
                        .doesNotContain(":");
            }
        }
    }

    /**
     * A literal, so the placeholder tests above cannot see it, and losing it aborts no boot and
     * breaks no request — a thirty-day credential simply becomes willing to travel in clear.
     */
    @Test
    @DisplayName("the refresh cookie is Secure in prod")
    void theRefreshCookieIsSecure() throws IOException {
        assertThat(prod().getProperty("draazy.security.refresh-cookie.secure"))
                .as("a non-Secure refresh cookie fails silently — no boot error, no failed request")
                .isEqualTo("true");
    }

    @Test
    @DisplayName("prod requires the API's own public origin")
    void theApiPublicOriginIsRequiredInProd() throws IOException {
        // Left blank it would not misbehave — it would make CookieDeliveryCheck skip, in the one
        // environment where a wrong topology signs every user out with nothing in any log.
        assertThat(prod().getProperty("draazy.web.public-origin"))
                .as("the delivery check has nothing to compare against without it")
                .isEqualTo("${API_PUBLIC_ORIGIN}");
    }

    @Test
    @DisplayName("a deploy that supplies all of them resolves cleanly")
    void theContractIsSatisfiableByTheDocumentedSet() throws IOException {
        MockEnvironment environment = environmentSupplying(REQUIRED_DEPLOY_VARIABLES);
        Properties prod = prod();

        // Proves the checklist is sufficient as well as necessary.
        for (String key : prod.stringPropertyNames()) {
            assertThatCode(() -> environment.resolveRequiredPlaceholders(prod.getProperty(key)))
                    .as("%s should resolve once the documented variables are present", key)
                    .doesNotThrowAnyException();
        }
    }

    @Test
    @DisplayName("omitting any single one fails resolution rather than defaulting")
    void everyMissingVariableIsFatal() throws IOException {
        Properties prod = prod();

        for (String omitted : REQUIRED_DEPLOY_VARIABLES) {
            Set<String> supplied = new TreeSet<>(REQUIRED_DEPLOY_VARIABLES);
            supplied.remove(omitted);
            MockEnvironment environment = environmentSupplying(supplied);

            String dependentValue = prod.stringPropertyNames().stream()
                    .map(prod::getProperty)
                    .filter(value -> value.contains("${" + omitted + "}"))
                    .findFirst()
                    .orElseThrow(() -> new AssertionError(
                            omitted + " is listed as required but no property in the file reads it"));

            assertThatThrownBy(() -> environment.resolveRequiredPlaceholders(dependentValue))
                    .as("a deploy that forgot %s must not start", omitted)
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining(omitted);
        }
    }

    /**
     * {@code R__} means Flyway re-runs the seed on every checksum change, so production would
     * re-seed indefinitely. Profiles are not exclusive, so {@code local,prod} needs this override.
     */
    @Test
    @DisplayName("Flyway runs the schema only, never the demo seed")
    void productionNeverRunsTheLocalSeed() throws IOException {
        assertThat(prod().getProperty("spring.flyway.locations"))
                .as("a `local,prod` deploy must still resolve to migration-only")
                .isEqualTo("classpath:db/migration");

        // The override is only load-bearing while some other profile really does add the seed.
        assertThat(mainResource("application-local.properties").getProperty("spring.flyway.locations"))
                .as("this is what the prod override above exists to beat")
                .contains("db/seed");
    }

    /**
     * Inheriting local's loosened window would make the OTP endpoint a free SMS-bombing service.
     * The window, not the cooldown: local matches prod's 60s on purpose so the countdown is exercised.
     */
    @Test
    @DisplayName("the OTP throttle is re-pinned to its secure values")
    void theOtpBudgetIsNotInheritedFromTheLoosenedLocalProfile() throws IOException {
        Properties prod = prod();

        assertThat(prod.getProperty("draazy.otp.send-cooldown-seconds")).isEqualTo("60");
        assertThat(prod.getProperty("draazy.otp.max-sends-per-window")).isEqualTo("5");

        Properties local = mainResource("application-local.properties");
        assertThat(local.getProperty("draazy.otp.max-sends-per-window"))
                .as("if local is no longer the loosened profile, this override needs re-reading")
                .isNotEqualTo("5");
    }

    @Test
    @DisplayName("the actuator surface stays minimal and the logs stay machine-readable")
    void theOperationalSurfaceIsWhatTheDeploymentExpects() throws IOException {
        Properties prod = prod();

        assertThat(prod.getProperty("management.endpoints.web.exposure.include"))
                .as("anything beyond health is an unauthenticated information leak — `info` "
                        + "publishes build, git and Java-version detail, and Cloud Run's probes "
                        + "never ask for it")
                .isEqualTo("health");
        assertThat(prod.getProperty("management.endpoint.health.probes.enabled")).isEqualTo("true");
        assertThat(prod.getProperty("logging.structured.format.console"))
                .as("the log pipeline parses ECS JSON; plain text arrives as unqueryable blobs")
                .isEqualTo("ecs");
    }

    /**
     * The port is set once in the base file, but only prod has an opinion about it — and nothing
     * else in the suite can see the line, since test resources shadow it and socket tests randomise.
     */
    @Test
    @DisplayName("the app listens on the port its platform assigns it")
    void theListenPortIsTakenFromTheEnvironment() throws IOException {
        assertThat(mainResource("application.properties").getProperty("server.port"))
                .as("Cloud Run health-checks the port it injected; a fixed port never gets traffic")
                .isEqualTo("${PORT:8080}");
    }

    /**
     * {@code MockEnvironment}, not {@code StandardEnvironment}: the latter layers the real OS
     * environment underneath, so a withheld variable would still resolve from the developer's shell.
     */
    private static MockEnvironment environmentSupplying(Set<String> variables) {
        MockEnvironment environment = new MockEnvironment();
        variables.forEach(name -> environment.setProperty(name, name));
        return environment;
    }
}
