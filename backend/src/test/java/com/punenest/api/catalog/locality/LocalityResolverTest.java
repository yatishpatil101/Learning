package com.punenest.api.catalog.locality;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

/**
 * Behaviour proof for the resolution ladder. Runs against the real Flyway'd Postgres because the
 * whole point of the resolver is the FK-constrained curated set — an in-memory fake of the repository
 * would prove nothing about the constraint that motivates returning {@code null}.
 *
 * <p>Localities are seeded per-test inside the rolled-back transaction rather than relying on
 * {@code R__seed_reference_data.sql}, so the assertions state their own fixtures and can't drift when
 * the seed changes.
 */
@SpringBootTest
@Transactional
class LocalityResolverTest {

    @Autowired
    LocalityResolver resolver;
    @Autowired
    JdbcTemplate jdbc;

    @BeforeEach
    void seedLocalities() {
        insert("hinjawadi", "Hinjawadi", 18.591, 73.738, true);
        insert("nibm-road", "NIBM Road", 18.470, 73.901, true);
        insert("kothrud", "Kothrud", 18.507, 73.807, true);
        // Retired locality: still referenced by old rows, must never win a new resolution.
        insert("old-market", "Old Market", 18.500, 73.850, false);
    }

    private void insert(String slug, String name, double lat, double lng, boolean active) {
        jdbc.update("INSERT INTO localities (slug, name, lat, lng, active) VALUES (?,?,?,?,?) "
                + "ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, lat = EXCLUDED.lat, "
                + "lng = EXCLUDED.lng, active = EXCLUDED.active", slug, name, lat, lng, active);
    }

    // ---------------- step 1: slugified name is an exact key ----------------

    @Test
    void resolvesCanonicalNameToItsSlug() {
        assertThat(resolver.resolve("Hinjawadi", null, null)).isEqualTo("hinjawadi");
    }

    @Test
    void resolvesWhenCallerAlreadySentTheSlug() {
        assertThat(resolver.resolve("hinjawadi", null, null)).isEqualTo("hinjawadi");
    }

    @Test
    void isInsensitiveToCaseAndSurroundingWhitespace() {
        assertThat(resolver.resolve("  hInJaWaDi  ", null, null)).isEqualTo("hinjawadi");
    }

    // ---------------- step 2: display-name match where slugify alone would miss ----------------

    @Test
    void resolvesMultiWordDisplayNameWhoseSlugIsNotANaiveSlugify() {
        // "NIBM Road" slugifies to "nibm-road" here, but the case-insensitive name match is what
        // guarantees this class of name resolves even if the slug were curated differently.
        assertThat(resolver.resolve("nibm road", null, null)).isEqualTo("nibm-road");
    }

    // ---------------- step 3: containment, both directions ----------------

    @Test
    void snapsASubAreaUpToItsParentLocality() {
        assertThat(resolver.resolve("Hinjawadi Phase 1", null, null)).isEqualTo("hinjawadi");
    }

    @Test
    void doesNotOverMatchOnShortTypedNames() {
        // "Sus" is a real Pune locality that is not curated here; a naive contains() would be free to
        // match it against anything. The length floor must keep it unresolved.
        assertThat(resolver.resolve("Sus", null, null)).isNull();
    }

    // ---------------- step 4: geo fallback ----------------

    @Test
    void snapsUnknownNameToTheNearestLocalityWithinTheRadius() {
        // ~0.5 km from Kothrud's centroid.
        assertThat(resolver.resolve("Some Unlisted Nagar", 18.510, 73.809)).isEqualTo("kothrud");
    }

    @Test
    void doesNotSnapWhenTheNearestLocalityIsBeyondTheRadius() {
        // Mumbai — far outside any Pune locality.
        assertThat(resolver.resolve("Andheri East", 19.114, 72.869)).isNull();
    }

    @Test
    void prefersTheNameMatchOverTheCoordinates() {
        // Name says Kothrud, coordinates sit on Hinjawadi. The name is what the owner asserted, and
        // it matched a curated locality — geo is only ever a fallback.
        assertThat(resolver.resolve("Kothrud", 18.591, 73.738)).isEqualTo("kothrud");
    }

    // ---------------- null outcomes (the FK-safe default) ----------------

    @Test
    void returnsNullRatherThanCoiningASlugForAnUnknownLocality() {
        // The client may fall back to slugify("Foo Bar") because it has no FK to satisfy; the server
        // must not, or the insert would violate properties.locality_slug -> localities(slug).
        assertThat(resolver.resolve("Completely Made Up Area", null, null)).isNull();
    }

    @Test
    void neverResolvesToAnInactiveLocality() {
        assertThat(resolver.resolve("Old Market", 18.500, 73.850)).isNull();
    }

    @Test
    void returnsNullForBlankAndNullInput() {
        assertThat(resolver.resolve(null, null, null)).isNull();
        assertThat(resolver.resolve("   ", null, null)).isNull();
    }
}
