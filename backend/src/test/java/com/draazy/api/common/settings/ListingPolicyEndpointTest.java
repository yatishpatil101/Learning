package com.draazy.api.common.settings;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

@DisplayName("GET /bootstrap listingPolicy — the photo limit an admin sets is the one a visitor is quoted")
class ListingPolicyEndpointTest extends AbstractApiTest {

    @Autowired UserRepository users;

    private String adminToken() {
        User u = new User("9869200001", Roles.Wire.ADMIN);
        u.setName("Policy Admin");
        u.setMobileVerified(true);
        return "Bearer " + jwtService.issueAccessToken(users.saveAndFlush(u));
    }

    private ResultActions putListings(String json) throws Exception {
        return mvc.perform(put(Routes.Admin.SETTINGS)
                .header(HttpHeaders.AUTHORIZATION, adminToken())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"listings\":" + json + "}"));
    }

    @Test
    @DisplayName("anonymous callers get ten when nobody has configured it")
    void defaultsToTen() throws Exception {
        mvc.perform(get(Routes.Bootstrap.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.listingPolicy.maxPhotos").value(10));
    }

    @Test
    @DisplayName("a limit saved in the back office is the limit published")
    void anAdminChangeIsPublished() throws Exception {
        putListings("{\"maxPhotos\":6}").andExpect(status().isOk());

        mvc.perform(get(Routes.Bootstrap.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.listingPolicy.maxPhotos").value(6));
    }

    @ParameterizedTest
    @ValueSource(strings = {"2", "21", "0", "-1", "10.5", "\"10\"", "true"})
    @DisplayName("a limit outside 3..20, or not a whole number, is refused and nothing is saved")
    void anUnenforceableLimitIsRefused(String value) throws Exception {
        putListings("{\"maxPhotos\":" + value + "}")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message", containsString("listings.maxPhotos")));

        mvc.perform(get(Routes.Bootstrap.BASE))
                .andExpect(jsonPath("$.listingPolicy.maxPhotos").value(10));
    }
}
