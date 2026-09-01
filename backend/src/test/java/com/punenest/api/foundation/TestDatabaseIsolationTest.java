package com.punenest.api.foundation;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * The test database holds schema and nothing else.
 *
 * <p><strong>Why this needs its own test.</strong> The demo seed
 * ({@code db/seed/R__dev_demo_data.sql}, 38 listings and 78 users) is kept out of the test run by a
 * single line in {@code src/test/resources/application.properties} —
 * {@code spring.flyway.locations=classpath:db/migration}. That line is doing real work and looks
 * like boilerplate, which is a bad combination: the test run activates the {@code dev} profile for
 * its keyless providers, and {@code application-dev.properties} adds {@code classpath:db/seed} to
 * the locations. Delete the override and the seed comes back in through the profile.
 *
 * <p>The failure it would cause is loud but misleading. 126 assertions across the suite are exact
 * counts — {@code PropertiesEndpointsTest} saves four listings and expects {@code totalElements ==
 * 2} after the approved/non-archived filter — so they would all fail at once with {@code expected 2,
 * got 21}, and the natural reading of a hundred simultaneous count failures is "the search filter
 * broke", not "someone changed a properties file". This test fails first and says what actually
 * happened.
 *
 * <p>It also guards the inverse mistake: pointing the test datasource at the dev database. That is
 * the arrangement {@code backend/LOCAL_DB_STATUS.md} used to describe, and it produces the same
 * symptom.
 *
 * <p><strong>Why the assertion is "empty" rather than "small".</strong> Every test in the suite
 * creates the rows it needs and rolls them back. There is no legitimate reason for a committed
 * business row to exist before any test runs, so the honest threshold is zero — and a threshold of
 * zero cannot drift upwards one seeded row at a time.
 */
@SpringBootTest
@DisplayName("The test database — schema only, never the demo seed")
class TestDatabaseIsolationTest {

    @Autowired
    JdbcTemplate jdbc;

    private int count(String table) {
        Integer n = jdbc.queryForObject("select count(*) from " + table, Integer.class);
        return n == null ? 0 : n;
    }

    @Test
    @DisplayName("no demo listings or users were committed before the suite started")
    void demoSeedIsNotLoaded() {
        assertThat(count("properties"))
                .as("the test DB has committed listings. Either spring.flyway.locations in "
                        + "src/test/resources/application.properties no longer excludes "
                        + "classpath:db/seed, or TEST_DB_URL is pointing at the dev database. "
                        + "126 count assertions in this suite depend on this being 0")
                .isZero();
    }

    /**
     * Reference data is the deliberate exception. {@code R__DML_seed_reference_data.sql} lives in
     * {@code db/migration} and runs for every profile including prod — localities and cities are
     * part of the schema's meaning, not demo content, and several tests resolve a locality slug
     * against them. Asserted as present so that moving it to {@code db/seed} (an easy tidy-up to
     * think of, having read the header of the other seed file) fails here rather than as a
     * scattering of locality-resolution failures.
     *
     * <p><strong>Why all nine tables and not just localities.</strong> This assertion used to name
     * {@code localities} alone, and on 2026-08-13 {@code reels} was found empty in the test database
     * while both other databases held the seeded 10. Nothing here noticed. The suite instead failed
     * five reels assertions with {@code expected:<10> but was:<0>}, immediately after an unrelated
     * change to {@code PropertySpecs} — so the first reading was "the change broke it", and the
     * change was innocent. A guard that covers one of the nine tables a file seeds is not a guard on
     * that file; it is a guard on one table that reads like one on the file.
     *
     * <p><strong>Why "non-empty" and not exact counts.</strong> The failure being guarded is *the
     * rows are gone*, which is what actually happened and what silently persists — the seed is
     * repeatable, so Flyway re-applies it only when its checksum changes, and rows deleted out from
     * under it stay deleted for every subsequent run. Pinning 155 localities or 348 societies would
     * instead fail every time someone adds a locality, which is ordinary content work, and a test
     * that cries wolf on ordinary work gets its expectation bumped rather than read. If the rows do
     * vanish again the fix is one line: {@code delete from flyway_schema_history where script =
     * 'R__DML_seed_reference_data.sql'}, which makes Flyway re-apply it on the next context boot. That is
     * safe because the file is {@code ON CONFLICT ... DO UPDATE} throughout.
     */
    @ParameterizedTest(name = "{0}")
    @ValueSource(
            strings = {
                "platform_fees",
                "settings",
                "cities",
                "localities",
                "societies",
                "reels",
                "plans",
                "boost_packs",
                "service_offerings"
            })
    @DisplayName("but reference data is present — it is schema, not demo data")
    void referenceDataIsStillLoaded(String table) {
        assertThat(count(table))
                .as(
                        "%s is seeded by R__DML_seed_reference_data in db/migration and must remain "
                                + "available to every profile. If this is 0, the rows were deleted "
                                + "out from under a repeatable migration, which Flyway will not "
                                + "re-apply on its own: delete its flyway_schema_history rows and "
                                + "boot again",
                        table)
                .isPositive();
    }
}
