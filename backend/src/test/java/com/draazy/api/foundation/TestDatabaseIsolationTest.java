package com.draazy.api.foundation;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;

// The demo seed stays out of the test run only via `spring.flyway.locations` in the test properties; the local
// profile would add it back.
@SpringBootTest
@AutoConfigureMockMvc
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

    // `R__DML_seed_reference_data.sql` runs for every profile, prod included: localities and cities are schema
    // meaning, not demo content.
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
