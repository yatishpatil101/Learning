package com.draazy.api.catalog.locality;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import com.jayway.jsonpath.JsonPath;
import java.math.BigDecimal;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

@DisplayName("Locality reads: listing-derived stats, indexability and the directory")
class LocalityReadEndpointsTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;

    private User owner;

    private void locality(String slug, String name, boolean archived) {
        jdbc.update("insert into localities (slug, name, city, lat, lng, active, archived_at) "
                + "values (?, ?, 'Pune', 18.5, 73.8, ?, " + (archived ? "now()" : "null") + ")",
                slug, name, !archived);
    }

    private User owner() {
        if (owner == null) {
            User u = new User("9861000001", "owner");
            u.setName("Locality Owner");
            u.setMobileVerified(true);
            owner = users.saveAndFlush(u);
        }
        return owner;
    }

    private Property listing(String slug, String deal, String type, long price, String area,
            String status, boolean archived) {
        Property p = new Property(owner(), "Stat " + deal + " " + price, deal, type, price, "Stat", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("rent".equals(deal) ? "per-month" : "total");
        p.setArea(area == null ? null : new BigDecimal(area));
        p.setLocalitySlug(slug);
        p.setStatus(status);
        if (archived) {
            p.archive("test");
        }
        return properties.saveAndFlush(p);
    }

    private void live(String slug, String deal, long price, String area) {
        listing(slug, deal, "apartment", price, area, PropertyStatus.APPROVED, false);
    }

    @Test
    @DisplayName("the admin list is a slim staff read: pin, archived flag and live count, no market stats")
    void adminListIsSlim() throws Exception {
        locality("zz-admin-slim", "Zz Admin Slim", false);
        live("zz-admin-slim", "rent", 20000, "800");
        User staff = new User("9861000002", "staff");
        staff.setName("Locality Ops");
        staff.setMobileVerified(true);
        staff = users.saveAndFlush(staff);

        mvc.perform(get("/admin/localities")
                        .header(org.springframework.http.HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.slug == 'zz-admin-slim')].liveListings")
                        .value(org.hamcrest.Matchers.contains(1)))
                .andExpect(jsonPath("$[?(@.slug == 'zz-admin-slim')].archived")
                        .value(org.hamcrest.Matchers.contains(false)))
                .andExpect(jsonPath("$[?(@.slug == 'zz-admin-slim')].avgRent").isEmpty())
                .andExpect(jsonPath("$[?(@.slug == 'zz-admin-slim')].medianRent").isEmpty());

        mvc.perform(get("/admin/localities")
                        .header(org.springframework.http.HttpHeaders.AUTHORIZATION, bearer(owner())))
                .andExpect(status().isForbidden());
        mvc.perform(get("/admin/localities")).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("below three live listings the page exists but carries no stats and is not indexable")
    void statsHiddenBelowThree() throws Exception {
        locality("zz-stats-low", "Zz Stats Low", false);
        live("zz-stats-low", "rent", 20000, "800");
        live("zz-stats-low", "buy", 6_000_000, "1000");

        mvc.perform(get("/localities/zz-stats-low"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.liveListings").value(2))
                .andExpect(jsonPath("$.indexable").value(false))
                .andExpect(jsonPath("$.avgRent").doesNotExist())
                .andExpect(jsonPath("$.ratePerSqft").doesNotExist());
    }

    @Test
    @DisplayName("from three live listings the rent and the rate per sq ft are derived from them")
    void statsShownAtThree() throws Exception {
        locality("zz-stats-ok", "Zz Stats Ok", false);
        live("zz-stats-ok", "rent", 20000, "800");
        live("zz-stats-ok", "rent", 30000, "900");
        live("zz-stats-ok", "rent", 40000, "1000");
        live("zz-stats-ok", "buy", 6_000_000, "1000");
        live("zz-stats-ok", "buy", 7_000_000, "1000");
        live("zz-stats-ok", "buy", 8_000_000, "1000");
        listing("zz-stats-ok", "rent", "apartment", 999_999, "500", PropertyStatus.PENDING, false);
        listing("zz-stats-ok", "buy", "apartment", 99_000_000, "500", PropertyStatus.APPROVED, true);

        mvc.perform(get("/localities/zz-stats-ok"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.liveListings").value(6))
                .andExpect(jsonPath("$.rentListings").doesNotExist())
                .andExpect(jsonPath("$.indexable").value(true))
                .andExpect(jsonPath("$.archived").value(false))
                .andExpect(jsonPath("$.avgRent").value(30000))
                .andExpect(jsonPath("$.ratePerSqft").value(7000))
                .andExpect(jsonPath("$.fromPrice").value(20000));
    }

    @Test
    @DisplayName("an average needs three samples of its own kind, not just three listings of any kind")
    void eachAverageNeedsItsOwnSample() throws Exception {
        locality("zz-stats-mixed", "Zz Stats Mixed", false);
        live("zz-stats-mixed", "rent", 20000, "800");
        live("zz-stats-mixed", "rent", 30000, "900");
        live("zz-stats-mixed", "rent", 40000, "1000");
        live("zz-stats-mixed", "buy", 6_000_000, "1000");

        mvc.perform(get("/localities/zz-stats-mixed"))
                .andExpect(jsonPath("$.indexable").value(true))
                .andExpect(jsonPath("$.avgRent").value(30000))
                .andExpect(jsonPath("$.ratePerSqft").doesNotExist());
    }

    @Test
    @DisplayName("sale listings without an area never enter the rate")
    void listingsWithoutAreaAreNotAveraged() throws Exception {
        locality("zz-stats-noarea", "Zz Stats No Area", false);
        live("zz-stats-noarea", "buy", 6_000_000, "1000");
        live("zz-stats-noarea", "buy", 7_000_000, "1000");
        live("zz-stats-noarea", "buy", 50_000, null);

        mvc.perform(get("/localities/zz-stats-noarea"))
                .andExpect(jsonPath("$.liveListings").value(3))
                .andExpect(jsonPath("$.ratePerSqft").doesNotExist());
    }

    @Test
    @DisplayName("a retired locality still resolves, and is indexable only while three listings stay live")
    void retiredLocalityKeepsItsPage() throws Exception {
        locality("zz-retired-empty", "Zz Retired Empty", true);
        locality("zz-retired-busy", "Zz Retired Busy", true);
        live("zz-retired-busy", "rent", 20000, "800");
        live("zz-retired-busy", "rent", 30000, "900");
        live("zz-retired-busy", "rent", 40000, "1000");

        mvc.perform(get("/localities/zz-retired-empty"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.archived").value(true))
                .andExpect(jsonPath("$.liveListings").value(0))
                .andExpect(jsonPath("$.indexable").value(false));
        mvc.perform(get("/localities/zz-retired-busy"))
                .andExpect(jsonPath("$.archived").value(true))
                .andExpect(jsonPath("$.indexable").value(true))
                .andExpect(jsonPath("$.avgRent").value(30000));
    }

    @Test
    @DisplayName("an unknown slug is a 404")
    void unknownSlugIsNotFound() throws Exception {
        mvc.perform(get("/localities/zz-no-such-place")).andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("the directory lists active rows and retired rows that still have live listings, nothing else")
    void directoryHidesRetiredRowsWithNothingLive() throws Exception {
        locality("zz-dir-active", "Zz Dir Active", false);
        locality("zz-dir-retired-empty", "Zz Dir Retired Empty", true);
        locality("zz-dir-retired-live", "Zz Dir Retired Live", true);
        live("zz-dir-retired-live", "rent", 20000, "800");
        listing("zz-dir-retired-empty", "rent", "apartment", 20000, "800", PropertyStatus.PENDING, false);

        String body = mvc.perform(get("/localities")).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertThat(JsonPath.<java.util.List<String>>read(body, "$[?(@.slug=='zz-dir-active')].slug"))
                .containsExactly("zz-dir-active");
        assertThat(JsonPath.<java.util.List<String>>read(body, "$[?(@.slug=='zz-dir-retired-live')].slug"))
                .containsExactly("zz-dir-retired-live");
        assertThat(JsonPath.<java.util.List<String>>read(body, "$[?(@.slug=='zz-dir-retired-empty')].slug"))
                .isEmpty();
        assertThat(JsonPath.<java.util.List<Boolean>>read(body, "$[?(@.slug=='zz-dir-retired-live')].archived"))
                .containsExactly(true);
        assertThat(JsonPath.<java.util.List<Integer>>read(body, "$[?(@.slug=='zz-dir-active')].liveListings"))
                .containsExactly(0);
    }

    @Test
    @DisplayName("the curated fields are gone from the response")
    void curatedFieldsAreGone() throws Exception {
        locality("zz-shape", "Zz Shape", false);

        mvc.perform(get("/localities/zz-shape"))
                .andExpect(jsonPath("$.demand").doesNotExist())
                .andExpect(jsonPath("$.focus").doesNotExist())
                .andExpect(jsonPath("$.avgRentPsf").doesNotExist())
                .andExpect(jsonPath("$.avgBuyPsf").doesNotExist())
                .andExpect(jsonPath("$.about").doesNotExist())
                .andExpect(jsonPath("$.lat").value(18.5))
                .andExpect(jsonPath("$.lng").value(73.8));
    }
}