package com.draazy.api.moderation;

import static org.hamcrest.Matchers.containsInAnyOrder;
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
import java.util.function.Consumer;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;

@DisplayName("Moderation queue — filtering pending listings by progress")
class ModerationProgressFilterTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Progress " + mobile);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private void listing(User owner, String title, boolean onBehalf, Consumer<Property> facts) {
        Property p = new Property(owner, title, "rent", "apartment", 30000L, "Baner", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("850"));
        p.setStatus(PropertyStatus.PENDING);
        if (onBehalf) {
            p.markPostedOnBehalf(owner.getId().toString());
        }
        facts.accept(p);
        properties.saveAndFlush(p);
    }

    @Test
    @DisplayName("each pending listing lands in exactly the bucket its tracker shows")
    void progressBucketsMatchTheTracker() throws Exception {
        User owner = user("9853000001", "owner");
        User staff = user("9853000002", "staff");
        listing(owner, "Zzprog ready owner", false, p -> { });
        listing(owner, "Zzprog ready staff", true, Property::confirmByOwner);
        listing(owner, "Zzprog reviewing", false, Property::startReview);
        listing(owner, "Zzprog asked", false, p -> { p.startReview(); p.requestInfo(); });
        listing(owner, "Zzprog unconfirmed", true, Property::recordClaimLinkSent);
        listing(owner, "Zzprog live", false, p -> p.setStatus(PropertyStatus.APPROVED));

        expect(staff, "ready", new String[] {"submitted", "owner_confirmed"}, "Zzprog ready owner", "Zzprog ready staff");
        expect(staff, "in_review", new String[] {"in_review"}, "Zzprog reviewing");
        expect(staff, "needs_info", new String[] {"in_review"}, "Zzprog asked");
        expect(staff, "awaiting_confirmation", new String[] {"link_sent"}, "Zzprog unconfirmed");
    }

    @Test
    @DisplayName("an unknown progress value is a 400, not an unfiltered page")
    void unknownProgressIsRejected() throws Exception {
        User staff = user("9853000003", "staff");
        mvc.perform(get("/admin/properties").param("progress", "verified")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isBadRequest());
    }

    private void expect(User staff, String progress, String[] steps, String... titles) throws Exception {
        mvc.perform(get("/admin/properties").param("q", "Zzprog").param("progress", progress)
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[*].title").value(containsInAnyOrder(titles)))
                .andExpect(jsonPath("$.content[*].progress.step").value(containsInAnyOrder(steps)));
    }
}
