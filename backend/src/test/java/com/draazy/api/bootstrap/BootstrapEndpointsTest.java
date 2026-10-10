package com.draazy.api.bootstrap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

class BootstrapEndpointsTest extends AbstractApiTest {

    @Autowired UserRepository users;

    @Autowired ObjectMapper objectMapper;

    @Test
    void anAnonymousCallerGetsEveryPublicSection() throws Exception {
        mvc.perform(get(Routes.Bootstrap.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.flags.kycBadgeEnabled").value(true))
                .andExpect(jsonPath("$.geo").isMap())
                .andExpect(jsonPath("$.cities[0].slug").value("pune"))
                .andExpect(jsonPath("$.pricing.ownerPlanYearly").isNumber())
                .andExpect(jsonPath("$.listingPolicy.maxPhotos").isNumber())
                .andExpect(jsonPath("$.movePack.enabled").isBoolean())
                .andExpect(jsonPath("$.plans.length()", Matchers.greaterThanOrEqualTo(4)))
                .andExpect(jsonPath("$.counts.counts").isArray())
                .andExpect(jsonPath("$.trustStats.totalListings").isNumber())
                .andExpect(jsonPath("$.trustStats.verifiedListings").isNumber())
                .andExpect(jsonPath("$.trustStats.verifiedOwners").isNumber());
    }

    @Test
    void theShellReadNeedsASession() throws Exception {
        mvc.perform(get(Routes.Bootstrap.ME)).andExpect(status().isUnauthorized());
    }

    // The client primes each section into the cache slot of the endpoint it replaces, so a section
    // that differs from that endpoint's own answer would be served as if the endpoint had said it.
    @Test
    void everyShellSectionIsExactlyWhatItsOwnEndpointAnswers() throws Exception {
        User u = new User("9877730001", "buyer");
        u.setName("Shell Reader");
        u.setMobileVerified(true);
        String token = bearer(users.saveAndFlush(u));

        JsonNode shell = read(Routes.Bootstrap.ME, token);

        assertThat(shell.get("me")).isEqualTo(read(Routes.Auth.ME, token));
        assertThat(shell.get("subscription")).isEqualTo(read(Routes.Plans.SUBSCRIPTION, token));
        assertThat(shell.get("saved")).isEqualTo(read(Routes.Engagement.SAVED_KEYS, token));
        assertThat(shell.get("notificationsUnread"))
                .isEqualTo(read(Routes.Engagement.NOTIFICATIONS_UNREAD_COUNT, token));
        assertThat(shell.get("messagesUnread"))
                .isEqualTo(read(Routes.Conversations.UNREAD_COUNT, token));
        assertThat(shell.properties()).extracting(java.util.Map.Entry::getKey).containsExactly(
                "me", "subscription", "saved", "notificationsUnread", "messagesUnread");
    }

    private JsonNode read(String uri, String token) throws Exception {
        String body = mvc.perform(get(uri).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(body);
    }
}
