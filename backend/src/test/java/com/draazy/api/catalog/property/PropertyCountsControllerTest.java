package com.draazy.api.catalog.property;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

@DisplayName("Property counts — public category aggregates")
class PropertyCountsControllerTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;
    ObjectMapper objectMapper = new ObjectMapper();

    @Test
    @DisplayName("counts match the public search for each home category")
    void countsMatchPublicSearch() throws Exception {
        User owner = user("9860000101");
        listing(owner, "Buy flat", "buy", "Apartment", PropertyStatus.APPROVED);
        listing(owner, "Rent office", "rent", "Office Space", PropertyStatus.APPROVED);
        listing(owner, "Buy plot", "buy", "Open Plot", PropertyStatus.APPROVED);
        listing(owner, "Buy farm", "buy", "Farm Land", PropertyStatus.APPROVED);
        listing(owner, "Buy villa", "buy", "Villa", PropertyStatus.APPROVED);

        PropertyCountsResponse counts = counts();

        assertThat(count(counts, "flat", "buy")).isEqualTo(searchTotal("buy", "flat"));
        assertThat(count(counts, "commercial", "rent")).isEqualTo(searchTotal("rent", "commercial"));
        assertThat(count(counts, "plot", "buy")).isEqualTo(searchTotal("buy", "plot"));
        assertThat(count(counts, "farmland", "buy")).isEqualTo(searchTotal("buy", "farmland"));
        assertThat(count(counts, "villa", "buy")).isEqualTo(searchTotal("buy", "villa"));
    }

    @Test
    @DisplayName("pending, rejected and archived listings are excluded")
    void nonVisibleListingsAreExcluded() throws Exception {
        User owner = user("9860000102");
        listing(owner, "Live flat", "buy", "Apartment", PropertyStatus.APPROVED);
        listing(owner, "Pending flat", "buy", "Apartment", PropertyStatus.PENDING);
        listing(owner, "Rejected flat", "buy", "Apartment", PropertyStatus.REJECTED);
        Property archived = listing(owner, "Archived flat", "buy", "Apartment", PropertyStatus.APPROVED);
        archived.archive("withdrawn");
        properties.saveAndFlush(archived);

        PropertyCountsResponse counts = counts();

        assertThat(count(counts, "flat", "buy")).isEqualTo(1);
        assertThat(searchTotal("buy", "flat")).isEqualTo(1);
    }

    private PropertyCountsResponse counts() throws Exception {
        String json = mvc.perform(get("/properties/counts"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readValue(json, PropertyCountsResponse.class);
    }

    private long searchTotal(String deal, String type) throws Exception {
        String json = mvc.perform(get("/properties").param("deal", deal).param("types", type))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode root = objectMapper.readTree(json);
        return root.path("totalElements").asLong();
    }

    private long count(PropertyCountsResponse response, String category, String deal) {
        return response.counts().stream()
                .filter(c -> category.equals(c.category()) && deal.equals(c.deal()))
                .mapToLong(PropertyCount::count)
                .sum();
    }

    private User user(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Counts " + mobile);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property listing(User owner, String title, String deal, String type, String status) {
        Property p = new Property(owner, title, deal, type, 9000000L, "Baner", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setArea(new BigDecimal("950"));
        p.setPriceUnit(DealIntent.priceUnitFor(deal));
        p.setLocalitySlug("baner");
        p.setStatus(status);
        return properties.saveAndFlush(p);
    }
}
