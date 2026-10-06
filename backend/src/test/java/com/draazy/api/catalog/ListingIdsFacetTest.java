package com.draazy.api.catalog;

import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import java.math.BigDecimal;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** The {@code ids} facet on {@code GET /properties}: one search instead of a detail read per card. */
class ListingIdsFacetTest extends AbstractApiTest {

    private static final String LOCALITY = "ids-facet-fixture";

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;

    @BeforeEach
    void createFixtureLocality() {
        jdbc.update("insert into localities (slug, name, city) values (?, ?, 'Pune')"
                + " on conflict (slug) do nothing", LOCALITY, "Ids Facet Fixture");
    }

    private User owner(String mobile) {
        User u = new User(mobile, "owner");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property listing(User owner, String slug, String title, String status) {
        Property p = new Property(owner, title, "rent", "apartment", 25000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("1000"));
        p.setLocalitySlug(LOCALITY);
        p.setSlug(slug);
        p.setStatus(status);
        return properties.saveAndFlush(p);
    }

    /** Both forms the browser holds — slug and UUID — and nothing that was not asked for. */
    @Test
    void returnsExactlyTheListingsNamedBySlugOrUuid() throws Exception {
        User u = owner("9811200001");
        listing(u, "ids-a", "Ids A", PropertyStatus.APPROVED);
        Property b = listing(u, "ids-b", "Ids B", PropertyStatus.APPROVED);
        listing(u, "ids-c", "Ids C", PropertyStatus.APPROVED);

        mvc.perform(get("/properties").param("ids", "ids-a", b.getId().toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[*].title", containsInAnyOrder("Ids A", "Ids B")));
    }

    /** Naming an id must not reach past the public floor. */
    @Test
    void aNamedListingThatIsNotLiveStillDropsOut() throws Exception {
        User u = owner("9811200002");
        listing(u, "ids-live", "Ids live", PropertyStatus.APPROVED);
        listing(u, "ids-pending", "Ids pending", "pending");

        mvc.perform(get("/properties").param("ids", "ids-live", "ids-pending"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content", hasSize(1)))
                .andExpect(jsonPath("$.content[0].title").value("Ids live"));
    }

    /** An unsafe token is a filter that matches nothing, never one silently dropped to "everything". */
    @Test
    void anUnusableIdMatchesNothing() throws Exception {
        mvc.perform(get("/properties").param("ids", "'; drop table properties; --"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content", hasSize(0)));
    }
}
