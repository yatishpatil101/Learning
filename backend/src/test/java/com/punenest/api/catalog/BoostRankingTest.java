package com.punenest.api.catalog;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * Paid placement (D59) — a boost buys rank, but only where saying so is honest.
 *
 * <p>The rule this file pins down has two halves, and the second is the one worth testing. Ranking a
 * paid listing above an unpaid one is the product; ranking it above a listing the buyer explicitly
 * asked to see first is deception. So the promotion applies to the <em>default</em> order only, and
 * an explicit {@code sort} is honoured exactly — the tests below would both pass if the ordering
 * were simply always-boosted-first, which is why {@link #explicitSortIsHonouredExactly} asserts the
 * full sequence rather than just the first element.
 *
 * <p>The window is compared against request time rather than swept by a job, so an elapsed boost
 * stops ranking and stops disclosing on its own. {@link #elapsedWindowNeitherRanksNorDiscloses}
 * exists because the failure mode of a sweeper-based design is silent and permanent: a listing that
 * outlives its promotion keeps the rank it stopped paying for.
 */
@DisplayName("Paid placement — boost ranks and discloses, but never overrides a chosen sort")
class BoostRankingTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;

    private User owner(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Asha Patil");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    /**
     * @param boostedUntil the promotion window's end, or {@code null} for a listing never promoted
     */
    private Property listing(User owner, String title, long price, Instant boostedUntil) {
        Property p = new Property(owner, title, "buy", "apartment", price, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setStatus("approved");
        p.setPriceUnit("total");
        p.setArea(new BigDecimal("1000"));
        p.setBoostedUntil(boostedUntil);
        return properties.saveAndFlush(p);
    }

    private static final Instant LIVE = Instant.now().plus(7, ChronoUnit.DAYS);
    private static final Instant ELAPSED = Instant.now().minus(1, ChronoUnit.DAYS);

    @Test
    @DisplayName("on the default order a boosted listing outranks a newer unboosted one")
    void boostedOutranksNewerUnboostedByDefault() throws Exception {
        User o = owner("9820000001");
        // Saved first, so it is the *older* row: without the boost, newest-first would bury it.
        listing(o, "Promoted", 5_000_000, LIVE);
        listing(o, "Newer plain", 5_000_000, null);

        mvc.perform(get("/properties"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(2))
                .andExpect(jsonPath("$.content[0].title").value("Promoted"))
                .andExpect(jsonPath("$.content[0].boosted").value(true))
                .andExpect(jsonPath("$.content[1].title").value("Newer plain"))
                .andExpect(jsonPath("$.content[1].boosted").value(false));
    }

    @Test
    @DisplayName("an explicit sort is honoured exactly — paid placement does not override it")
    void explicitSortIsHonouredExactly() throws Exception {
        User o = owner("9820000002");
        listing(o, "Dear promoted", 9_000_000, LIVE);
        listing(o, "Cheap plain", 1_000_000, null);
        listing(o, "Mid plain", 5_000_000, null);

        // Ascending price puts the promoted listing last. That is the point: the buyer asked for
        // cheapest-first and money may not buy its way past that.
        mvc.perform(get("/properties").param("sort", "price,asc"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].title").value("Cheap plain"))
                .andExpect(jsonPath("$.content[1].title").value("Mid plain"))
                .andExpect(jsonPath("$.content[2].title").value("Dear promoted"))
                // Still disclosed wherever it lands — the label tracks payment, not position.
                .andExpect(jsonPath("$.content[2].boosted").value(true));
    }

    @Test
    @DisplayName("an elapsed window neither ranks nor discloses, with no sweeper involved")
    void elapsedWindowNeitherRanksNorDiscloses() throws Exception {
        User o = owner("9820000003");
        listing(o, "Expired promo", 5_000_000, ELAPSED);
        listing(o, "Newer plain", 5_000_000, null);

        // The column is deliberately left populated after the window closes, so this also proves
        // the read compares against now() rather than testing the column for null.
        assertThat(properties.findAll())
                .filteredOn(p -> "Expired promo".equals(p.getTitle()))
                .allSatisfy(p -> assertThat(p.getBoostedUntil()).isNotNull());

        mvc.perform(get("/properties"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].title").value("Newer plain"))
                .andExpect(jsonPath("$.content[1].title").value("Expired promo"))
                .andExpect(jsonPath("$.content[1].boosted").value(false));
    }

    @Test
    @DisplayName("the detail read discloses the same flag the card does")
    void detailDisclosesToo() throws Exception {
        User o = owner("9820000004");
        Property p = listing(o, "Promoted", 5_000_000, LIVE);

        mvc.perform(get("/properties/" + p.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.boosted").value(true));
    }
}
