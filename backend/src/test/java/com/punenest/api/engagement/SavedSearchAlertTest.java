package com.punenest.api.engagement;

import static org.assertj.core.api.Assertions.assertThat;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.engagement.search.SavedSearch;
import com.punenest.api.engagement.search.SavedSearchRepository;
import com.punenest.api.engagement.search.SavedSearchService;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.support.AbstractApiTest;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * D94 — a saved search that actually tells its owner something.
 *
 * <p><strong>What was wrong.</strong> {@code saved_searches.alert_frequency} has existed since V7.
 * The card renders it, the user picks it, {@code PATCH /me/saved-searches/{id}} lets them change
 * it, and nothing read it. The sweep computed {@code new_count} every thirty minutes and stopped
 * there, so an alert notified its owner only if the owner came back and looked — which is the
 * thing a saved search exists to replace. The feature was complete in every respect except the one
 * it is named after.
 *
 * <p><strong>Why the cadence is tested and not just the send.</strong> Sending on every sweep
 * would be the easy half and would break the promise in the other direction: "Daily" delivered
 * every thirty minutes is not a partial implementation of the user's choice, it is the opposite of
 * it under the same label. {@link #dailyDoesNotFireTwiceInADay} is the assertion that matters most
 * here, because it is the one that fails if someone later "simplifies" the due check away.
 *
 * <p>Notifications are counted through {@code jdbc} rather than the repository so the assertion is
 * about what reached the table, not about what an in-memory collaborator was asked to do.
 *
 * <p>Fixtures: a locality and listings created inline; nothing here depends on the seed.
 */
@DisplayName("D94 - saved-search alerts are actually sent")
class SavedSearchAlertTest extends AbstractApiTest {

    /** The BHK no seeded or inline listing outside this test uses, so counts cannot drift. */
    private static final String ODD_BHK = "97";

    /** Matches the locality this test inserts, and nothing else. */
    private static final String LOCALITY = "d94-alert-locality";

    @Autowired
    SavedSearchService savedSearches;

    @Autowired
    SavedSearchRepository searches;

    @Autowired
    UserRepository users;

    @Autowired
    PropertyRepository properties;

    @Autowired
    EntityManager em;

    private User owner(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Owner " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private void locality() {
        jdbc.update("""
                insert into localities (slug, name, city, active)
                values (?, ?, ?, true)
                on conflict (slug) do nothing
                """, LOCALITY, "D94 Alert Locality", "Pune");
    }

    /**
     * A saved search watching {@link #LOCALITY} at {@link #ODD_BHK}, with its baseline pinned so
     * that listings created after this call are the only ones that can match.
     */
    private SavedSearch alertFor(User user, String frequency) {
        SavedSearch search = new SavedSearch(user.getId(), "rent " + LOCALITY);
        search.setFilters("{\"deal\":\"rent\",\"localities\":[\"" + LOCALITY
                + "\"],\"bhk\":[" + ODD_BHK + "]}");
        search.setAlertFrequency(frequency);
        search = searches.saveAndFlush(search);
        jdbc.update("update saved_searches set updated_at = ? where id = ?",
                Timestamp.from(Instant.now().minusSeconds(60)), search.getId());
        return search;
    }

    private void listing(User user, String title) {
        Property p = new Property(user, title, "rent", "apartment", 31000L,
                "D94 Alert Locality", "Pune");
        p.setLocalitySlug(LOCALITY);
        p.setBhk(new BigDecimal(ODD_BHK));
        p.setStatus("approved");
        properties.saveAndFlush(p);
    }

    private int alertsFor(User user) {
        Integer n = jdbc.queryForObject(
                "select count(*) from notifications where user_id = ? and type = 'match.saved-search'",
                Integer.class, user.getId());
        return n == null ? 0 : n;
    }

    @Test
    @DisplayName("a rise in matches notifies the owner and stamps last_alerted_at")
    void aRiseNotifiesTheOwner() {
        User user = owner("9820940001");
        locality();
        SavedSearch search = alertFor(user, "daily");
        listing(user, "D94 first match");
        em.flush();
        em.clear();

        savedSearches.recomputeNewCounts(Instant.now());

        assertThat(alertsFor(user)).isEqualTo(1);
        SavedSearch after = searches.findById(search.getId()).orElseThrow();
        assertThat(after.getNewCount()).isEqualTo(1);
        assertThat(after.getLastAlertedAt()).isNotNull();
    }

    @Test
    @DisplayName("alertFrequency 'off' means off, however many homes appear")
    void offMeansOff() {
        User user = owner("9820940002");
        locality();
        SavedSearch search = alertFor(user, "off");
        listing(user, "D94 unwanted match");
        em.flush();
        em.clear();

        savedSearches.recomputeNewCounts(Instant.now());

        // The count is still maintained -- the badge on the card is not an alert, and a user who
        // turned alerts off has not asked to stop seeing what is there when they visit.
        SavedSearch after = searches.findById(search.getId()).orElseThrow();
        assertThat(after.getNewCount()).isEqualTo(1);
        assertThat(after.getLastAlertedAt()).isNull();
        assertThat(alertsFor(user)).isZero();
    }

    /**
     * The regression this whole column exists to prevent. The sweep runs every thirty minutes; a
     * daily alert must survive forty-eight of those without sending twice.
     */
    @Test
    @DisplayName("daily does not fire twice in a day, even as more homes arrive")
    void dailyDoesNotFireTwiceInADay() {
        User user = owner("9820940003");
        locality();
        SavedSearch search = alertFor(user, "daily");
        listing(user, "D94 morning match");
        em.flush();
        em.clear();

        savedSearches.recomputeNewCounts(Instant.now());
        assertThat(alertsFor(user)).isEqualTo(1);

        // A second wave, and a second sweep, twenty minutes later.
        jdbc.update("update saved_searches set updated_at = ? where id = ?",
                Timestamp.from(Instant.now().minusSeconds(60)), search.getId());
        listing(user, "D94 afternoon match");
        em.flush();
        em.clear();

        savedSearches.recomputeNewCounts(Instant.now().plus(20, ChronoUnit.MINUTES));

        assertThat(alertsFor(user))
                .as("daily must not become half-hourly just because inventory moved")
                .isEqualTo(1);
    }

    @Test
    @DisplayName("the cadence is measured from the last alert, so a day later it fires again")
    void afterTheCadenceElapsesItFiresAgain() {
        User user = owner("9820940004");
        locality();
        SavedSearch search = alertFor(user, "daily");
        listing(user, "D94 day one");
        em.flush();
        em.clear();

        savedSearches.recomputeNewCounts(Instant.now());
        assertThat(alertsFor(user)).isEqualTo(1);

        jdbc.update("update saved_searches set updated_at = ? where id = ?",
                Timestamp.from(Instant.now().minusSeconds(60)), search.getId());
        listing(user, "D94 day two");
        em.flush();
        em.clear();

        savedSearches.recomputeNewCounts(Instant.now().plus(25, ChronoUnit.HOURS));

        assertThat(alertsFor(user)).isEqualTo(2);
    }

    /**
     * A fall in the count is bookkeeping, not news. The count drops to zero on the tick after an
     * alert fires because the baseline moves with {@code updated_at}; nobody should hear about it.
     */
    @Test
    @DisplayName("a falling count never notifies")
    void aFallingCountIsSilent() {
        User user = owner("9820940005");
        locality();
        alertFor(user, "instant");
        listing(user, "D94 only match");
        em.flush();
        em.clear();

        savedSearches.recomputeNewCounts(Instant.now());
        assertThat(alertsFor(user)).isEqualTo(1);

        // No new inventory. The baseline has advanced, so the count falls back to zero.
        savedSearches.recomputeNewCounts(Instant.now().plus(1, ChronoUnit.HOURS));

        assertThat(alertsFor(user))
                .as("the count falling from 1 to 0 is not an event")
                .isEqualTo(1);
    }
}
