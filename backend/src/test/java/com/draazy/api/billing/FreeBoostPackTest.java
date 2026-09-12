package com.draazy.api.billing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.billing.boost.Boost;
import com.draazy.api.billing.boost.BoostRepository;
import com.draazy.api.billing.boost.BoostStatuses;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

/**
 * The free boost pack — the branch that settles without a gateway at all (D172).
 *
 * <p><strong>Why this exists.</strong> Every seeded pack is priced, so the free branch of
 * {@code BoostService.open} had no coverage: it commits {@code active} immediately, writes the
 * listing's promotion window itself, and never touches Cashfree. D172 reordered those two writes —
 * the boost row is saved before the listing is promoted — and reordering an untested branch is how
 * a working path quietly stops working.
 *
 * <p><strong>What the ordering is for, and why no test can prove it here.</strong> Both writes are
 * in one transaction, so today a failure rolls both back and the two orderings are
 * indistinguishable. The argument is about which half survives if that ever stops being true: a
 * boost row with an unpromoted listing is a promotion that did not take, which support can see and
 * re-run; a promoted listing with no boost row behind it is a property ranking above paying
 * customers that nobody can explain, attribute or revoke. Stating that here rather than pretending
 * to assert it — what this class actually holds is that both writes still happen, which is the
 * regression the reorder could have caused.
 *
 * <p>The pack is inserted with SQL because {@code BoostPack} is deliberately immutable reference
 * data with no public constructor and no setters. The insert lives inside the test's own rolled-back
 * transaction, so the catalogue every other suite sees is unchanged.
 */
@DisplayName("D172 — a free boost saves the row, then promotes the listing")
class FreeBoostPackTest extends AbstractApiTest {

    private static final String FREE_PACK = "b2000000-0000-4000-8000-0000000000ff";

    private static final int DURATION_DAYS = 3;

    @Autowired MockMvc mvc;
    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired BoostRepository boosts;
    @Autowired JdbcTemplate jdbc;

    /**
     * Both writes, asserted together. Dropping either one — which is the way a reorder goes wrong —
     * fails here: no boost row means an unattributable promotion, no promotion means the owner got
     * an {@code active} boost that ranks nothing.
     */
    @Test
    @DisplayName("the boost row and the listing's promotion window are both written")
    void aFreeBoostWritesBothHalves() throws Exception {
        freePack();
        User owner = owner("9877700131");
        Property p = listing(owner);

        mvc.perform(post(Routes.Boosts.LISTING, p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"packId\":\"" + FREE_PACK + "\"}"))
                .andExpect(status().isCreated())
                // No gateway is involved, so there is nothing for the client to pay and nothing to
                // resume — the window is already open, which is what the end date proves.
                .andExpect(jsonPath("$.status").value(BoostStatuses.ACTIVE))
                .andExpect(jsonPath("$.endsAt").isNotEmpty());

        List<Boost> written = boosts.findByPropertyIdOrderByCreatedAtDesc(p.getId());
        assertThat(written).hasSize(1);
        assertThat(written.getFirst().getStatus()).isEqualTo(BoostStatuses.ACTIVE);

        assertThat(properties.findById(p.getId()).orElseThrow().getBoostedUntil())
                .isNotNull()
                .isAfter(Instant.now());
    }

    // ---------------------------------------------------------------- fixtures

    /** A zero-price pack, which no environment seeds; rolled back with the rest of the test. */
    private void freePack() {
        jdbc.update("INSERT INTO boost_packs (id, name, price, duration_days, placement) "
                        + "VALUES (?::uuid, ?, 0, ?, 'top') ON CONFLICT (id) DO NOTHING",
                FREE_PACK, "Complimentary Spotlight", DURATION_DAYS);
    }

    private User owner(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Free Boost " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property listing(User owner) {
        Property p = new Property(owner, "Promotable flat", "rent", "apartment", 26_000L,
                "Baner", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setStatus("approved");
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("900"));
        return properties.saveAndFlush(p);
    }
}
