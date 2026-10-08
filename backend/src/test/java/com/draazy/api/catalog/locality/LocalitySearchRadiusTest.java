package com.draazy.api.catalog.locality;

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
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

@DisplayName("Property search by locality: the slug, or a pin within 2 km of the locality")
class LocalitySearchRadiusTest extends AbstractApiTest {

    private static final double LAT = 18.5;
    private static final double LNG = 73.8;
    private static final double KM_AS_DEGREES = 1 / 111.045;

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;

    private User owner() {
        User u = new User("9862000001", "owner");
        u.setName("Radius Owner");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private void locality(String slug, Double lat, Double lng) {
        jdbc.update("insert into localities (slug, name, city, lat, lng) values (?, ?, 'Pune', ?, ?)",
                slug, "Name " + slug, lat, lng);
    }

    private void listing(User owner, String title, String slug, Double lat, Double lng) {
        Property p = new Property(owner, title, "rent", "apartment", 20000L, "Anywhere", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setLocalitySlug(slug);
        p.setLat(lat);
        p.setLng(lng);
        p.setStatus(PropertyStatus.APPROVED);
        properties.saveAndFlush(p);
    }

    @Test
    @DisplayName("a pin 1.5 km away under another slug is found; one 2.5 km away is not")
    void radiusAdmitsNearbyListingsOfOtherSlugs() throws Exception {
        locality("zz-r-centre", LAT, LNG);
        locality("zz-r-other", LAT + 0.5, LNG + 0.5);
        User o = owner();
        listing(o, "Bound by slug", "zz-r-centre", null, null);
        listing(o, "Near 1.5km", "zz-r-other", LAT + 1.5 * KM_AS_DEGREES, LNG);
        listing(o, "Far 2.5km", "zz-r-other", LAT + 2.5 * KM_AS_DEGREES, LNG);
        listing(o, "Unpinned elsewhere", "zz-r-other", null, null);

        mvc.perform(get("/properties").param("locality", "zz-r-centre"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.content[?(@.title=='Bound by slug')]").isNotEmpty())
                .andExpect(jsonPath("$.content[?(@.title=='Near 1.5km')]").isNotEmpty())
                .andExpect(jsonPath("$.content[?(@.title=='Far 2.5km')]").isEmpty());
    }

    @Test
    @DisplayName("a locality with no pin matches on its slug alone")
    void localityWithoutCoordinatesUsesTheSlugOnly() throws Exception {
        locality("zz-r-nopin", null, null);
        locality("zz-r-neighbour", LAT, LNG);
        User o = owner();
        listing(o, "Bound no pin", "zz-r-nopin", LAT, LNG);
        listing(o, "Neighbour", "zz-r-neighbour", LAT, LNG);

        mvc.perform(get("/properties").param("locality", "zz-r-nopin"))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].title").value("Bound no pin"));
    }

    @Test
    @DisplayName("an unknown slug finds nothing")
    void unknownSlugFindsNothing() throws Exception {
        locality("zz-r-known", LAT, LNG);
        listing(owner(), "Somewhere", "zz-r-known", LAT, LNG);

        mvc.perform(get("/properties").param("locality", "zz-r-unknown"))
                .andExpect(jsonPath("$.totalElements").value(0));
    }
}