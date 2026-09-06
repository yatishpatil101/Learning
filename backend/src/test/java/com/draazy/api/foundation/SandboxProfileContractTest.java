package com.draazy.api.foundation;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Path;
import java.util.Properties;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.support.PropertiesLoaderUtils;

/**
 * {@code application-sandbox.properties} is a near-copy of the prod file, and this test is the price
 * of that.
 *
 * <p><strong>Why the duplication exists.</strong> Sandbox used to be activated as {@code
 * prod,sandbox} — a delta that inherited every hardening line from prod and added {@code db/seed}
 * back. That guaranteed the two could never diverge, but it did so by running the profile named
 * {@code prod} against a database full of fabricated listings, which is a confusing thing to have to
 * explain to anyone reading a deployment. The profiles were separated so each environment names
 * exactly one profile and owns its own file.
 *
 * <p><strong>What separation costs.</strong> Inheritance was doing real work: it made drift
 * impossible. Copying the file trades that guarantee for a maintenance hazard whose failure mode is
 * silent and one-directional — someone hardens prod, forgets sandbox, and sandbox quietly stops
 * being a faithful rehearsal of production. Nothing breaks, no test fails, and the environment whose
 * entire purpose is to catch production problems before production does becomes slightly less like
 * production with every such change. By the time it matters, the two files have drifted in a dozen
 * places and nobody knows which differences were deliberate.
 *
 * <p><strong>So this test restores the guarantee as an assertion.</strong> The two files must be
 * byte-for-byte identical in their effective properties except for the keys in {@link
 * #INTENTIONAL_DIVERGENCE}. Adding a line to prod fails this test until the author has either copied
 * it to sandbox or written down, here, why sandbox is different. That is the same protection
 * inheritance gave, except it now also catches the reverse case — a setting loosened in sandbox and
 * never noticed — which the delta arrangement could not see at all.
 *
 * <p>Sibling of {@link ProdProfileContractTest}, which covers the values themselves. This one only
 * covers the <em>relationship</em> between the two files; it deliberately asserts nothing about
 * whether a given value is correct, because duplicating those assertions here would mean two places
 * to update and a second chance to get it wrong.
 */
@DisplayName("The sandbox profile — a standalone copy that must not drift from prod")
class SandboxProfileContractTest {

    /**
     * The keys sandbox is allowed to differ on, and the reason for each. Every entry is a deliberate
     * decision that someone has to defend; the empty case is the healthy one.
     */
    private static final Set<String> INTENTIONAL_DIVERGENCE = Set.of(
            // The entire point of the environment. Prod is migration-only; sandbox adds
            // classpath:db/seed so the shared environment has demo inventory to look at. This is the
            // difference that makes a seeded database unpromotable to production.
            "spring.flyway.locations");

    private static final Pattern PLACEHOLDER = Pattern.compile("\\$\\{([^}]+)}");

    /** See {@code ProdProfileContractTest.MODULE} — same working-directory hazard, same fix. */
    private static final Path MODULE = Path.of(System.getProperty("basedir", "")).toAbsolutePath();

    private static Properties mainResource(String name) throws IOException {
        Path file = MODULE.resolve("src/main/resources").resolve(name);
        assertThat(file)
                .as("run this from the backend module — the working directory was %s", MODULE)
                .exists();
        return PropertiesLoaderUtils.loadProperties(new FileSystemResource(file));
    }

    private static Properties prod() throws IOException {
        return mainResource("application-prod.properties");
    }

    private static Properties sandbox() throws IOException {
        return mainResource("application-sandbox.properties");
    }

    /**
     * The load-bearing assertion. Not "sandbox contains the important keys" — that phrasing needs a
     * list of what counts as important, and the whole failure mode here is someone adding a setting
     * nobody thought to add to such a list. Comparing the complete maps means the test knows about
     * new keys without being told.
     */
    @Test
    @DisplayName("sandbox and prod agree on every key except the declared divergences")
    void sandboxDoesNotDriftFromProd() throws IOException {
        Properties prod = prod();
        Properties sandbox = sandbox();

        var differences = new TreeMap<String, String>();
        var allKeys = new TreeSet<String>();
        prod.stringPropertyNames().forEach(allKeys::add);
        sandbox.stringPropertyNames().forEach(allKeys::add);

        for (String key : allKeys) {
            if (INTENTIONAL_DIVERGENCE.contains(key)) {
                continue;
            }
            String inProd = prod.getProperty(key);
            String inSandbox = sandbox.getProperty(key);
            if (inProd == null) {
                differences.put(key, "only in sandbox (= '" + inSandbox + "')");
            } else if (inSandbox == null) {
                differences.put(key, "only in prod (= '" + inProd + "')");
            } else if (!inProd.equals(inSandbox)) {
                differences.put(key, "prod='" + inProd + "' but sandbox='" + inSandbox + "'");
            }
        }

        assertThat(differences)
                .as("sandbox is a standalone copy of prod, so an undeclared difference is drift, "
                        + "not configuration. Either copy the setting across, or add the key to "
                        + "INTENTIONAL_DIVERGENCE with a comment saying why sandbox is different. "
                        + "The dangerous direction is a hardening line added to prod alone: sandbox "
                        + "keeps passing its own tests while quietly ceasing to resemble the thing "
                        + "it exists to rehearse.")
                .isEmpty();
    }

    /**
     * Sandbox holds real credentials for a real Supabase project and a real Cashfree account, so the
     * fail-loudly-on-a-missing-secret property has to survive the copy. A {@code ${DB_PASSWORD:}}
     * that picked up a default during the split would boot happily against whatever the base file
     * points at, which is a developer's local Postgres.
     */
    @Test
    @DisplayName("every secret is still an ${ENV} lookup with no fallback")
    void noSecretAcquiredADefaultDuringTheSplit() throws IOException {
        Properties sandbox = sandbox();
        var defaulted = new TreeSet<String>();

        for (String key : sandbox.stringPropertyNames()) {
            Matcher matcher = PLACEHOLDER.matcher(sandbox.getProperty(key));
            while (matcher.find()) {
                if (matcher.group(1).contains(":")) {
                    defaulted.add(key + " -> " + matcher.group());
                }
            }
        }

        assertThat(defaulted)
                .as("a default here turns a missing-secret boot failure into a silent fallback to "
                        + "the base file's development values")
                .isEmpty();
    }

    /**
     * The variables an operator has to provision before the first sandbox deploy. Sandbox and prod
     * needing the same set is not a coincidence worth asserting for its own sake — it falls out of
     * the parity test above — but naming it here means the deploy checklist is greppable from the
     * sandbox side too, rather than only from a test named after prod.
     */
    @Test
    @DisplayName("the deploy checklist is the same ten variables prod needs")
    void sandboxNeedsTheSameVariablesAsProd() throws IOException {
        assertThat(placeholdersIn(sandbox()))
                .as("if these sets diverge, one of the two deploy runbooks is now wrong")
                .isEqualTo(placeholdersIn(prod()));
    }

    private static Set<String> placeholdersIn(Properties properties) {
        var found = new TreeSet<String>();
        for (String key : properties.stringPropertyNames()) {
            Matcher matcher = PLACEHOLDER.matcher(properties.getProperty(key));
            while (matcher.find()) {
                found.add(matcher.group(1));
            }
        }
        return found;
    }
}
