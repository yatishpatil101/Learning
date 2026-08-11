package com.punenest.api.moderation;

import com.punenest.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.catalog.property.PropertyStatus;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.Roles;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * The owner&lt;-&gt;ops verification thread.
 *
 * <p>The interesting property of this surface is that <strong>its guard is not a role</strong>. Four
 * of the five routes carry no {@code @PreAuthorize}, because the listing owner is a participant in
 * the review of their own listing; the rule is participant-or-staff and lives in the service. That
 * makes it exactly the kind of authorization a role sweep cannot verify, so it is tested here
 * instead: a stranger must be shut out, and shut out with a <em>404</em>, because a 403 confirms
 * that a listing with that id exists and is under review.
 *
 * <p>The other three tests cover the invariants that would fail silently rather than loudly: that
 * {@code from} is derived server-side (an owner cannot post as ops), that {@code markRead} touches
 * only the other side's messages (marking your own read would clear the badge the other participant
 * is waiting on), and that a decision writes <em>both</em> the case file and the listing status.
 */
@DisplayName("Verification thread — participant-or-staff, and both halves of a decision")
class VerificationThreadTest extends AbstractApiTest {

        private static final String ADMIN_PROPERTY_REVIEWS = "/admin/property-reviews";

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;

    /** Audit rows are written {@code REQUIRES_NEW} and therefore survive this test's rollback. */
    private final List<String> createdActors = new ArrayList<>();

    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        createdActors.forEach(actor -> jdbc.update("delete from audit_log where actor = ?", actor));
        createdActors.clear();
    }

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("User " + mobile);
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        createdActors.add(saved.getId().toString());
        return saved;
    }

    private Property listing(User owner, String deal) {
        Property p = new Property(owner, "2BHK in Kothrud", deal, "apartment", 32000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("rent".equals(deal) ? "per-month" : "total");
        p.setArea(new BigDecimal("900"));
        p.setStatus(PropertyStatus.PENDING);
        return properties.saveAndFlush(p);
    }

    private String path(Property p, String suffix) {
        return "/properties/" + p.getId() + "/verification" + suffix;
    }

    @Test
    @DisplayName("a stranger gets 404, not 403 — a 403 would confirm the listing exists")
    void aStrangerCannotSeeThatTheCaseExists() throws Exception {
        Property listing = listing(user("9820000501", Roles.Wire.OWNER), "rent");
        String owner = bearer(users.findById(listing.getOwner().getId()).orElseThrow());
        String stranger = bearer(user("9820000502", Roles.Wire.BUYER));

        mvc.perform(post(path(listing, "")).header(HttpHeaders.AUTHORIZATION, owner))
                .andExpect(status().isCreated());

        mvc.perform(get(path(listing, "")).header(HttpHeaders.AUTHORIZATION, stranger))
                .andExpect(status().isNotFound());
        mvc.perform(post(path(listing, "/messages")).header(HttpHeaders.AUTHORIZATION, stranger)
                .contentType(MediaType.APPLICATION_JSON).content("{\"body\":\"let me in\"}"))
                .andExpect(status().isNotFound());

        // The owner, by contrast, reads their own case file.
        mvc.perform(get(path(listing, "")).header(HttpHeaders.AUTHORIZATION, owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.checklist.length()").value(3));
    }

    @Test
    @DisplayName("the checklist is the rent one for a rental and the longer buy one for a sale")
    void theChecklistMatchesTheDeal() throws Exception {
        User owner = user("9820000503", Roles.Wire.OWNER);
        Property rental = listing(owner, "rent");
        Property sale = listing(owner, "buy");
        String token = bearer(owner);

        mvc.perform(post(path(rental, "")).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.checklist.length()").value(3));
        mvc.perform(post(path(sale, "")).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.checklist.length()").value(6));

        // Re-submitting is idempotent: property_reviews.property_id is UNIQUE, so a double-click
        // must return the existing case rather than violate the constraint.
        mvc.perform(post(path(rental, "")).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.checklist.length()").value(3));
    }

    @Test
    @DisplayName("'from' is derived server-side, and markRead clears only the other side")
    void theThreadAttributesAndReadsCorrectly() throws Exception {
        User owner = user("9820000504", Roles.Wire.OWNER);
        User ops = user("9820000505", Roles.Wire.STAFF);
        Property listing = listing(owner, "rent");
        String ownerToken = bearer(owner);
        String opsToken = bearer(ops);

        mvc.perform(post(path(listing, "")).header(HttpHeaders.AUTHORIZATION, ownerToken))
                .andExpect(status().isCreated());
        mvc.perform(post(path(listing, "/messages")).header(HttpHeaders.AUTHORIZATION, ownerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"body\":\"Index II attached\",\"from\":\"ops\"}"))
                .andExpect(status().isCreated())
                // A client-supplied "from" is ignored: it is derived from the authenticated sender,
                // or an owner could post as ops in their own case file.
                .andExpect(jsonPath("$.messages[0].from").value("owner"));

        mvc.perform(post(path(listing, "/messages")).header(HttpHeaders.AUTHORIZATION, opsToken)
                .contentType(MediaType.APPLICATION_JSON).content("{\"body\":\"Received, reviewing\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.messages[1].from").value("ops"));

        // The owner reads: only ops' message is marked, never their own.
        mvc.perform(post(path(listing, "/read")).header(HttpHeaders.AUTHORIZATION, ownerToken))
                .andExpect(status().isNoContent());
        mvc.perform(get(path(listing, "")).header(HttpHeaders.AUTHORIZATION, ownerToken))
                .andExpect(jsonPath("$.messages[0].read").value(false))
                .andExpect(jsonPath("$.messages[1].read").value(true));
    }

    @Test
    @DisplayName("staff can list verification case files; owner cannot")
    void verificationQueueIsStaffScopedAndPaged() throws Exception {
        User owner = user("9820000510", Roles.Wire.OWNER);
        User staff = user("9820000511", Roles.Wire.STAFF);
        Property listing = listing(owner, "rent");

        mvc.perform(post(path(listing, "")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated());

        mvc.perform(get(ADMIN_PROPERTY_REVIEWS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].propertyId").value(listing.getId().toString()))
                .andExpect(jsonPath("$.content[0].status").value("pending"));

        mvc.perform(get(ADMIN_PROPERTY_REVIEWS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("a decision writes both the case file and properties.status")
    void aDecisionMovesBothHalves() throws Exception {
        User owner = user("9820000506", Roles.Wire.OWNER);
        User ops = user("9820000507", Roles.Wire.STAFF);
        Property listing = listing(owner, "rent");
        UUID listingId = listing.getId();

        mvc.perform(post(path(listing, "")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated());
        mvc.perform(post(path(listing, "/decision")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"approve\",\"note\":\"docs check out\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(PropertyStatus.APPROVED));

        properties.flush();
        assertThat(jdbc.queryForObject("select status from properties where id = ?",
                String.class, listingId)).isEqualTo(PropertyStatus.APPROVED);
        assertThat(jdbc.queryForObject("select status from property_reviews where property_id = ?",
                String.class, listingId)).isEqualTo(PropertyStatus.APPROVED);
    }

    @Test
    @DisplayName("staff cannot decide the verification of a listing they own")
    void staffCannotDecideTheirOwnListing() throws Exception {
        User staff = user("9820000508", Roles.Wire.STAFF);
        Property own = listing(staff, "rent");
        String token = bearer(staff);

        mvc.perform(post(path(own, "")).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isCreated());
        mvc.perform(post(path(own, "/decision")).header(HttpHeaders.AUTHORIZATION, token)
                .contentType(MediaType.APPLICATION_JSON).content("{\"decision\":\"approve\"}"))
                .andExpect(status().isForbidden());

        properties.flush();
        assertThat(jdbc.queryForObject("select status from properties where id = ?",
                String.class, own.getId())).isEqualTo(PropertyStatus.PENDING);
    }
}
