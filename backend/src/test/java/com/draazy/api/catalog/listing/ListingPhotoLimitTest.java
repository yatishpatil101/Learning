package com.draazy.api.catalog.listing;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

@DisplayName("Listings — no gallery may pass the configured photo limit, for any property type")
class ListingPhotoLimitTest extends AbstractApiTest {

    private static final String OURS = "/api/dev/storage/public/photos/";

    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Photo Limit " + role);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private static String gallery(User owner, int count) {
        return IntStream.range(0, count)
                .mapToObj(i -> "\"" + OURS + owner.getId() + "/" + UUID.randomUUID() + "\"")
                .collect(Collectors.joining(",", "[", "]"));
    }

    private ResultActions create(User owner, String propertyType, String images) throws Exception {
        return mvc.perform(post("/me/listings").header(HttpHeaders.AUTHORIZATION, bearer(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"title":"Listing in Baner","deal":"rent","propertyType":"%s","price":28000,
                         "bhk":2,"locality":"Baner","city":"Pune","floor":3,"images":%s}
                        """.formatted(propertyType, images)));
    }

    @Test
    @DisplayName("ten photos are accepted and an eleventh is refused")
    void tenIsTheDefaultCeiling() throws Exception {
        User o = user("9861520001", Roles.Wire.OWNER);
        User second = user("9861520007", Roles.Wire.OWNER);
        create(o, "apartment", gallery(o, 10)).andExpect(status().isCreated());
        create(second, "apartment", gallery(second, 11))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message", containsString("at most 10 photos")));
    }

    @ParameterizedTest(name = "{0}")
    @ValueSource(strings = {"villa", "independent house", "plot", "commercial office", "farmland"})
    @DisplayName("the same ceiling applies to every property type")
    void everyPropertyTypeSharesTheLimit(String propertyType) throws Exception {
        User o = user("9861520002", Roles.Wire.OWNER);
        create(o, propertyType, gallery(o, 11))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message", containsString("at most 10 photos")));
    }

    @Test
    @DisplayName("an edit may not grow a gallery past the limit, whoever makes it")
    void editsAreHeldToTheLimit() throws Exception {
        User o = user("9861520003", Roles.Wire.OWNER);
        User admin = user("9861520004", Roles.Wire.ADMIN);
        Property p = new Property(o, "Bright 2BHK", "rent", "apartment", 25000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setStatus(PropertyStatus.APPROVED);
        p.setLocalitySlug("kothrud");
        p.setImages(List.of(OURS + o.getId() + "/" + UUID.randomUUID()));
        properties.saveAndFlush(p);

        String elevenPhotos = "{\"images\":" + gallery(o, 11) + "}";
        mvc.perform(patch("/me/listings/" + p.getId()).header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON).content(elevenPhotos))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message", containsString("at most 10 photos")));
        mvc.perform(patch(Routes.Moderation.PROPERTY_ADMIN_UPDATE, p.getId()).header(HttpHeaders.AUTHORIZATION, bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON).content(elevenPhotos))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    @DisplayName("raising the limit in the back office takes effect on the next write")
    void theLimitIsConfigurable() throws Exception {
        User o = user("9861520005", Roles.Wire.OWNER);
        User admin = user("9861520006", Roles.Wire.ADMIN);
        mvc.perform(put(Routes.Admin.SETTINGS).header(HttpHeaders.AUTHORIZATION, bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"listings\":{\"maxPhotos\":12}}"))
                .andExpect(status().isOk());

        create(o, "apartment", gallery(o, 12)).andExpect(status().isCreated());
        User second = user("9861520008", Roles.Wire.OWNER);
        create(second, "apartment", gallery(second, 13))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message", containsString("at most 12 photos")));
    }
}
