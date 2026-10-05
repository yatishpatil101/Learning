package com.draazy.api.moderation;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
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
import org.springframework.http.HttpHeaders;

// Staff-posted hand-back data is gated so buyers cannot see platform-made listings.
@DisplayName("D215 — the post-on-behalf hand-back funnel")
class PropertyPipelineTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;

        // AuditService commits in its own transaction, so its rows outlive this test's rollback.
    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Pipeline " + mobile);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property listing(User owner, boolean onBehalf, String staffId, String status) {
        Property p = new Property(owner, "Pipeline flat", "rent", "apartment", 31000L, "Baner", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("880"));
        p.setStatus(status);
        if (onBehalf) {
            p.markPostedOnBehalf(staffId);
        }
        return properties.saveAndFlush(p);
    }

    @Test
    @DisplayName("a concierge listing nobody has moved yet renders on the queue at Created")
    void untouchedConciergeListingsRender() throws Exception {
        User owner = user("9852000021", "owner");
        User staff = user("9852000022", "staff");
        listing(owner, true, staff.getId().toString(), PropertyStatus.PENDING);

        mvc.perform(get("/admin/properties").param("q", "Pipeline flat")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                // Reaching hand-back pins the acquisition funnel at its last stage: leaving it at
                // {@code listed} would show the board a listing still waiting for its paperwork.
                .andExpect(jsonPath("$.content[0].adminPipeline.postedByAdmin").value(true))
                .andExpect(jsonPath("$.content[0].progress.track").value("staff"))
                .andExpect(jsonPath("$.content[0].progress.step").value("created"))
                .andExpect(jsonPath("$.content[0].progress.flags").value(hasItem("no_photos")));
    }

    // Acquisition stage and hand-back milestone are independent axes.
    @Test
        // Both were board-only vocabulary and would have been refused at the CHECK constraint.
    @DisplayName("the owner's authenticated open is a flag for staff, not a step")
    void claimLinkOpenedIsAFlag() throws Exception {
        User owner = user("9852000091", "owner");
        User staff = user("9852000092", "staff");
        Property p = listing(owner, true, staff.getId().toString(), PropertyStatus.PENDING);
        p.recordClaimLinkSent();
        properties.saveAndFlush(p);

        mvc.perform(post("/me/listings/" + p.getId() + "/opened")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isNoContent());
        properties.flush();
        mvc.perform(get("/admin/properties").param("q", "Pipeline flat")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
    // `under_review` and `live` duplicate status and would create conflicting truth.
                .andExpect(jsonPath("$.content[0].progress.step").value("link_sent"))
                .andExpect(jsonPath("$.content[0].progress.flags").value(hasItem("opened")));
        mvc.perform(get("/me/listings").header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(jsonPath("$.content[0].progress.step").value("link_sent"))
                .andExpect(jsonPath("$.content[0].progress.flags").value(not(hasItem("opened"))));
    }

    // Stepping back onto acquisition also clears the milestone, or a row contradicts itself on paperwork.
    @Test
    @DisplayName("the manual stage route is gone")
    void manualStageRouteIsGone() throws Exception {
        User owner = user("9852000005", "owner");
        User staff = user("9852000006", "staff");
    // Untouched concierge rows have null funnel columns; derivation must not 500.
        Property p = listing(owner, true, staff.getId().toString(), PropertyStatus.PENDING);
        int code = mvc.perform(post("/properties/" + p.getId() + "/pipeline")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType("application/json").content("{\"stage\":\"claimed\"}"))
                .andReturn().getResponse().getStatus();
        org.assertj.core.api.Assertions.assertThat(code).isIn(404, 405);
    }

    // `PropertyResponse` is public too, so the funnel must be omitted from projection.
    @Test
    @DisplayName("a buyer reading the listing is not told the platform posted it")
    void consumersNeverSeeTheFunnel() throws Exception {
        User owner = user("9852000009", "owner");
        User staff = user("9852000010", "staff");
        User buyer = user("9852000011", "buyer");
        Property p = listing(owner, true, staff.getId().toString(), PropertyStatus.APPROVED);

        mvc.perform(get("/properties/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.adminPipeline").doesNotExist())
                .andExpect(jsonPath("$.progress").doesNotExist());

        // And the owner cannot see it either: it names a colleague and describes internal chasing.
        mvc.perform(get("/me/listings")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].adminPipeline").doesNotExist());
    // Hand-back approval uses post-on-behalf authority, not generic property write.
    }
}
