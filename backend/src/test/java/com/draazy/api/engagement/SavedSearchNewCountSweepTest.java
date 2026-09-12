package com.draazy.api.engagement;

import static org.assertj.core.api.Assertions.assertThat;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import jakarta.persistence.EntityManager;
import com.draazy.api.engagement.search.SavedSearch;
import com.draazy.api.engagement.search.SavedSearchRepository;
import com.draazy.api.engagement.search.SavedSearchService;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

@DisplayName("D7 - saved-search new_count sweep")
class SavedSearchNewCountSweepTest extends AbstractApiTest {

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

    @Test
    @DisplayName("recomputeNewCounts counts only matching recent approved listings")
    void recomputeCountsOnlyMatchingRecentListings() {
        User owner = owner("9820500001");
        String seededLocalitySlug = "d7-test-locality";
        jdbc.update("""
                insert into localities (slug, name, city, active)
                values (?, ?, ?, true)
                on conflict (slug) do nothing
                """, seededLocalitySlug, "D7 Test Locality", "Pune");

        SavedSearch search = new SavedSearch(owner.getId(), "rent d7-test-locality");
        search.setFilters("{\"deal\":\"rent\",\"localities\":[\"" + seededLocalitySlug
                + "\"],\"bhk\":[99]}");
        search = searches.saveAndFlush(search);

        Property oldMatch = new Property(owner, "Old 99BHK D7", "rent", "apartment", 28000L,
                "D7 Test Locality", "Pune");
        oldMatch.setLocalitySlug(seededLocalitySlug);
        oldMatch.setBhk(new BigDecimal("99"));
        oldMatch.setStatus("approved");
        oldMatch = properties.saveAndFlush(oldMatch);

        Instant baseline = Instant.now();
        jdbc.update("update saved_searches set updated_at = ? where id = ?",
            Timestamp.from(baseline), search.getId());
        jdbc.update("update properties set created_at = ? where id = ?",
            Timestamp.from(baseline.minusSeconds(3600)), oldMatch.getId());

        Property matching = new Property(owner, "99BHK D7", "rent", "apartment", 32000L,
                "D7 Test Locality", "Pune");
        matching.setLocalitySlug(seededLocalitySlug);
        matching.setBhk(new BigDecimal("99"));
        matching.setStatus("approved");
        matching = properties.saveAndFlush(matching);

        Property wrongDeal = new Property(owner, "99BHK D7 Buy", "buy", "apartment", 9000000L,
                "D7 Test Locality", "Pune");
        wrongDeal.setLocalitySlug(seededLocalitySlug);
        wrongDeal.setBhk(new BigDecimal("99"));
        wrongDeal.setStatus("approved");
        properties.saveAndFlush(wrongDeal);

        em.flush();
        em.clear();

        long updated = savedSearches.recomputeNewCounts(Instant.now());

        SavedSearch refreshed = searches.findById(search.getId()).orElseThrow();
        assertThat(updated).isGreaterThanOrEqualTo(1);
        assertThat(refreshed.getNewCount()).isEqualTo(1);

        // Running again with the same corpus advances the baseline and clears the count.
        long updatedAgain = savedSearches.recomputeNewCounts(Instant.now());
        SavedSearch second = searches.findById(search.getId()).orElseThrow();
        assertThat(second.getNewCount()).isZero();
        assertThat(updatedAgain).isGreaterThanOrEqualTo(1);

        // Keep variable used so static analysis doesn't collapse setup intent.
        assertThat(matching.getId()).isInstanceOf(UUID.class);
    }
}
