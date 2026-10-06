package com.draazy.api.bootstrap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.engagement.history.MeRecentSearchesController;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

class MeDashboardEndpointsTest extends AbstractApiTest {

    // Each section against the exact read the client's own provider makes for it.
    private static final Map<String, String> SECTION_READS = new LinkedHashMap<>();

    static {
        SECTION_READS.put("listings", "/me/listings?size=100");
        SECTION_READS.put("flatmatePosts", "/me/flatmate-posts?page=0&size=100");
        SECTION_READS.put("flatmateRooms", "/me/flatmate-rooms?page=0&size=100");
        SECTION_READS.put("flatmateGroups", "/me/flatmate-groups?page=0&size=100");
        SECTION_READS.put("contactRequests", "/me/contact-requests?page=0&size=100");
        SECTION_READS.put("photoRequests", "/me/photo-requests?page=0&size=100");
        SECTION_READS.put("documentRequests", "/me/documents/requests?size=100");
        SECTION_READS.put("flatmateRequests", "/me/flatmate-requests?size=100");
        SECTION_READS.put("groupApplications", "/me/group-applications?page=0&size=100");
        SECTION_READS.put("visits", "/visits?size=100");
        SECTION_READS.put("visitRequests", "/me/visit-requests?size=100");
        SECTION_READS.put("tenancies", "/me/tenancies");
        SECTION_READS.put("propertyReviews", "/me/property-reviews?page=0&size=100");
        SECTION_READS.put("recentSearches", "/me/recent-searches");
        SECTION_READS.put("serviceRequestInvites", "/me/service-request-invites");
        SECTION_READS.put("managedProperties", "/me/managed-properties");
        SECTION_READS.put("entitlements", "/me/entitlements");
        SECTION_READS.put("deals", "/me/deals?size=100");
    }

    @Autowired UserRepository users;

    @Autowired ObjectMapper objectMapper;

    @MockitoSpyBean MeRecentSearchesController recentSearches;

    private User owner(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Dash Owner");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private void seed(User owner, String token) throws Exception {
        mvc.perform(post(Routes.MeListings.BASE)
                        .header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Dashboard flat\",\"deal\":\"rent\","
                                + "\"propertyType\":\"apartment\",\"price\":25000,"
                                + "\"locality\":\"Baner\",\"city\":\"Pune\","
                                + listingImages(owner) + "}"))
                .andExpect(status().isCreated());
        mvc.perform(post(Routes.MeManagedProperties.BASE)
                        .header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"deal\":\"rent\",\"propertyType\":\"Flat\",\"bhk\":2,"
                                + "\"price\":25000,\"locality\":\"Baner\"}"))
                .andExpect(status().isCreated());
    }

    @Test
    void theDashboardReadNeedsASession() throws Exception {
        mvc.perform(get(Routes.Bootstrap.ME_DASHBOARD)).andExpect(status().isUnauthorized());
    }

    // Per-user data: a shared cache (PublicReadCacheFilter, a CDN) must never keep it.
    @Test
    void theDashboardIsNeverStoredByASharedCache() throws Exception {
        String token = bearer(owner("9877730105"));
        String cacheControl = mvc.perform(get(Routes.Bootstrap.ME_DASHBOARD)
                        .header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getHeader(HttpHeaders.CACHE_CONTROL);
        assertThat(cacheControl).contains("no-store");
    }

    // The client primes each section into the cache slot of the endpoint it replaces, so a section
    // that differs from that endpoint's own answer would be served as if the endpoint had said it.
    @Test
    void everySectionIsExactlyWhatItsOwnEndpointAnswers() throws Exception {
        User u = owner("9877730101");
        String token = bearer(u);
        seed(u, token);

        JsonNode dashboard = read(Routes.Bootstrap.ME_DASHBOARD, token);

        assertThat(dashboard.get("listings").get("content")).hasSize(1);
        assertThat(dashboard.get("managedProperties")).hasSize(1);
        assertThat(dashboard.size()).isEqualTo(SECTION_READS.size());
        SECTION_READS.forEach((section, uri) -> {
            try {
                assertThat(dashboard.get(section)).as(section).isEqualTo(read(uri, token));
            } catch (Exception e) {
                throw new IllegalStateException(section, e);
            }
        });
    }

    @Test
    void oneCallersDashboardNeverCarriesAnotherCallersData() throws Exception {
        User a = owner("9877730102");
        String tokenA = bearer(a);
        seed(a, tokenA);
        String tokenB = bearer(owner("9877730103"));

        JsonNode dashboard = read(Routes.Bootstrap.ME_DASHBOARD, tokenB);

        assertThat(dashboard.get("listings").get("content")).isEmpty();
        assertThat(dashboard.get("managedProperties")).isEmpty();
        assertThat(dashboard.get("deals").get("content")).isEmpty();
    }

    @Test
    void aSectionThatFailsIsNullAndTheRestStillAnswer() throws Exception {
        User u = owner("9877730104");
        String token = bearer(u);
        seed(u, token);
        doThrow(new IllegalStateException("boom")).when(recentSearches).mine(any());

        JsonNode dashboard = read(Routes.Bootstrap.ME_DASHBOARD, token);

        assertThat(dashboard.get("recentSearches").isNull()).isTrue();
        assertThat(dashboard.get("listings").get("content")).hasSize(1);
    }

    private JsonNode read(String uri, String token) throws Exception {
        String body = mvc.perform(get(uri).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(body);
    }
}
