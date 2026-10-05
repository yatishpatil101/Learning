package com.draazy.api.foundation;

import com.draazy.api.support.AbstractApiTest;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import java.math.BigDecimal;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;

// Strict UUID routes should fail before auth conversion; lenient routes document slug support.
// If a strict route becomes lenient, this guard should fail until the contract is updated.
class PropIdAcceptanceTest extends AbstractApiTest {

    private static final String SLUG = "2bhk-kothrud-propid-guard";

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;

    private User owner() {
        User u = new User("9820007701", "owner");
        u.setName("Nikhil Bhosale");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property listing(User owner) {
        Property p = new Property(owner, "PropId guard flat", "rent", "apartment", 22000L,
                "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setStatus("approved");
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("900"));
        p.setSlug(SLUG);
        return properties.saveAndFlush(p);
    }

    /**
     * Strict routes reject a slug (400 from conversion, or 404 from a helper — the status differs
     * only in how the constraint is expressed); the vault is lenient. The positive rows matter as
     * much as the negative ones: without them a route that started answering 400 to everything
     * would still pass. The public reviews route sends no bearer, since the identifier must be
     * rejected before authorisation would matter.
     */
    @ParameterizedTest(name = "{0}")
    @MethodSource("routes")
    void propIdAcceptance(String label, HttpMethod method, String route, boolean uuid,
            boolean authenticated, int expectedStatus) throws Exception {
        User u = owner();
        Property p = listing(u);

        var request = request(method, route, uuid ? p.getId().toString() : SLUG);
        if (authenticated) {
            request.header(HttpHeaders.AUTHORIZATION, bearer(u));
        }
        mvc.perform(request).andExpect(status().is(expectedStatus));
    }

    static Stream<Arguments> routes() {
        return Stream.of(
                Arguments.of("savedByProperty rejects a slug with 400", HttpMethod.PUT,
                        Routes.Engagement.SAVED_BY_PROPERTY, false, true, 400),
                Arguments.of("savedByProperty accepts the uuid", HttpMethod.PUT,
                        Routes.Engagement.SAVED_BY_PROPERTY, true, true, 204),
                Arguments.of("propertyReviews rejects a slug with 400", HttpMethod.GET,
                        Routes.Reviews.FOR_PROPERTY, false, false, 400),
                Arguments.of("deals rejects a slug with 404", HttpMethod.GET,
                        Routes.Deals.BY_PROP, false, true, 404),
                Arguments.of("finances rejects a slug with 404", HttpMethod.GET,
                        Routes.Finances.TRANSACTIONS, false, true, 404),
                Arguments.of("documentVault accepts a slug", HttpMethod.GET,
                        Routes.MeDocuments.FOR_PROPERTY, false, true, 200),
                Arguments.of("documentVault also accepts the uuid", HttpMethod.GET,
                        Routes.MeDocuments.FOR_PROPERTY, true, true, 200));
    }
}
