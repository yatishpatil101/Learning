package com.draazy.api.moderation;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import java.math.BigDecimal;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;

// Public and owner listing routes cannot expose an unapproved stranger's id,
// so the moderation queue needs its own reachable read.
@DisplayName("Moderation — the listing queue is reachable")
class PropertyModerationQueueTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;

    /** Audit rows commit through REQUIRES_NEW, so a rollback does not take them with it. */
    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        jdbc.update("delete from audit_log where entity = 'property'");
    }

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Moderation " + mobile);
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        if ("staff".equals(role)) {
            jdbc.update("""
                    INSERT INTO back_office_permissions (user_id, permissions)
                    VALUES (?::uuid, ?::jsonb)
                    ON CONFLICT (user_id) DO UPDATE SET permissions = EXCLUDED.permissions
                    """, saved.getId().toString(),
                    "[\"kyc\",\"propertyVerification\",\"listingModeration\",\"support\",\"content\",\"reports\",\"desk:rental\"]");
        }
        return saved;
    }

    private Property listing(User owner, String title, String status) {
        Property p = new Property(owner, title, "rent", "apartment", 28000L, "Baner", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("950"));
        p.setStatus(status);

        // Repository saves skip LocalityResolver; file the fixture so queue tests
        // do not fail on locality approval.
        p.setLocalitySlug("baner");
        return properties.saveAndFlush(p);
    }

    // The whole point: the backlog is visible.
    private void tickChecklist(Property p, User staff) throws Exception {
        mvc.perform(post("/properties/" + p.getId() + "/verification/start")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk());
        for (String item : java.util.List.of(
                "Photos are real and match the listing",
                "Not a duplicate of another listing",
                "Details and location look right")) {
            mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                            .patch("/properties/" + p.getId() + "/verification/checklist")
                            .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                            .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                            .content("{\"item\":\"" + item + "\",\"pass\":true}"))
                    .andExpect(status().isOk());
        }
    }

    @Test
    @DisplayName("staff see every status, where public search sees only approved")
    void staffSeeEveryStatus() throws Exception {
        User owner = user("9850000001", "owner");
        User staff = user("9850000002", "staff");
        listing(owner, "Pending flat", PropertyStatus.PENDING);
        listing(owner, "Rejected flat", PropertyStatus.REJECTED);
        listing(owner, "Flagged flat", PropertyStatus.FLAGGED);
        listing(owner, "Approved flat", PropertyStatus.APPROVED);

        mvc.perform(get("/admin/properties").header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isArray())
                .andExpect(jsonPath("$.totalElements").value(4));

        mvc.perform(get("/properties"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1));
    }

    // On the public search a `status` param can only narrow within approved, so `status=pending` yields an empty page.
    // Here it must widen.
    @Test
    @DisplayName("the status filter widens here and narrows on the public search")
    void statusFilterWidens() throws Exception {
        User owner = user("9850000003", "owner");
        User staff = user("9850000004", "staff");
        Property pending = listing(owner, "Awaiting review", PropertyStatus.PENDING);
        listing(owner, "Live flat", PropertyStatus.APPROVED);

        mvc.perform(get("/admin/properties").param("status", PropertyStatus.PENDING)
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].id").value(pending.getId().toString()))
                .andExpect(jsonPath("$.content[0].status").value(PropertyStatus.PENDING));

        mvc.perform(get("/properties").param("status", PropertyStatus.PENDING))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0));
    }

    // `archived` is tri-state; omitted means the ops screen shows all listings.
    @Test
    @DisplayName("archived is tri-state — both, only-archived, only-live")
    void archivedIsTriState() throws Exception {
        User owner = user("9850000005", "owner");
        User staff = user("9850000006", "staff");
        Property live = listing(owner, "Live flat", PropertyStatus.APPROVED);
        Property gone = listing(owner, "Withdrawn flat", PropertyStatus.APPROVED);
        gone.archive("owner withdrew");
        properties.saveAndFlush(gone);

        mvc.perform(get("/admin/properties").header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(jsonPath("$.totalElements").value(2));

        mvc.perform(get("/admin/properties").param("archived", "true")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].id").value(gone.getId().toString()));

        mvc.perform(get("/admin/properties").param("archived", "false")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].id").value(live.getId().toString()));
    }

    // Stays-live rechecks remain approved and unarchived,
    // so only this tri-state filter can surface them to ops.
    @Test
    @DisplayName("recheck is tri-state — the stays-live queue, its complement, and both")
    void recheckIsTriState() throws Exception {
        User owner = user("9850000011", "owner");
        User staff = user("9850000012", "staff");
        Property quiet = listing(owner, "Untouched flat", PropertyStatus.APPROVED);
        Property edited = listing(owner, "Repriced flat", PropertyStatus.APPROVED);
        edited.requestRecheck(java.util.List.of("price"));
        properties.saveAndFlush(edited);

        mvc.perform(get("/admin/properties").header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(jsonPath("$.totalElements").value(2));

        mvc.perform(get("/admin/properties").param("recheck", "true")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].id").value(edited.getId().toString()))
                .andExpect(jsonPath("$.content[0].status").value(PropertyStatus.APPROVED))
                .andExpect(jsonPath("$.content[0].recheckReason").value("price"))

                .andExpect(jsonPath("$.content[0].recheckRequestedAt").exists());

        mvc.perform(get("/admin/properties").param("recheck", "false")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].id").value(quiet.getId().toString()))

                // NON_NULL: nothing queued, so the two re-check fields are absent rather than
                // present-and-empty. A client cannot mistake "clean" for "queued at the epoch".
                .andExpect(jsonPath("$.content[0].recheckRequestedAt").doesNotExist())
                .andExpect(jsonPath("$.content[0].recheckPending").value(false));
    }

    // Unfiltered queue clients need the archived value,
    // not a hard-coded `false`, to distinguish rows.
    @Test
    @DisplayName("a badge-only request sits in the badge queue, not the re-check queue, and sorts by age")
    void badgeRequestsHaveTheirOwnQueue() throws Exception {
        User owner = user("9850000091", "owner");
        User staff = user("9850000092", "staff");
        Property badgeOnly = listing(owner, "Badge flat", PropertyStatus.APPROVED);
        badgeOnly.requestOwnershipReview(java.time.Instant.now().minusSeconds(7200));
        properties.saveAndFlush(badgeOnly);
        Property both = listing(owner, "Badge and price flat", PropertyStatus.APPROVED);
        both.requestRecheck(java.util.List.of("price"));
        both.requestOwnershipReview(java.time.Instant.now());
        properties.saveAndFlush(both);

        mvc.perform(get("/admin/properties").param("recheck", "true")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].id").value(both.getId().toString()));

        mvc.perform(get("/admin/properties").param("badge", "true")
                        .param("sort", "ownershipRequestedAt,asc")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.content[0].id").value(badgeOnly.getId().toString()));
    }

    @Test
    @DisplayName("the follow-up queue puts a never-confirmed listing ahead of one confirmed long ago")
    void followUpSortsNeverConfirmedFirst() throws Exception {
        User owner = user("9850000093", "owner");
        User staff = user("9850000094", "staff");
        Property confirmedLongAgo = listing(owner, "Confirmed once", PropertyStatus.APPROVED);
        confirmedLongAgo.confirmAvailable(java.time.Instant.now().minus(java.time.Duration.ofDays(60)));
        properties.saveAndFlush(confirmedLongAgo);
        Property neverConfirmed = listing(owner, "Never confirmed", PropertyStatus.APPROVED);
        jdbc.update("update properties set created_at = now() - interval '40 days' where id = ?", neverConfirmed.getId());

        mvc.perform(get("/admin/properties").param("unconfirmed", "true")
                        .param("sort", "lastConfirmedAt,asc")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.content[0].id").value(neverConfirmed.getId().toString()))
                .andExpect(jsonPath("$.content[1].id").value(confirmedLongAgo.getId().toString()));
    }

    @Test
    @DisplayName("the archived flag is on the wire, and is true for an archived listing")
    void archivedFlagIsEmitted() throws Exception {
        User owner = user("9850000007", "owner");
        User staff = user("9850000008", "staff");
        listing(owner, "Live flat", PropertyStatus.APPROVED);
        Property gone = listing(owner, "Withdrawn flat", PropertyStatus.APPROVED);
        gone.archive("owner withdrew");
        properties.saveAndFlush(gone);

        mvc.perform(get("/admin/properties").param("archived", "true")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(jsonPath("$.content[0].archived").value(true));

        mvc.perform(get("/admin/properties").param("archived", "false")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(jsonPath("$.content[0].archived").value(false));
    }

    /** Free text is the facet ops actually uses; it must reach unapproved rows like the rest. */
    @Test
    @DisplayName("free-text search reaches unapproved listings")
    void freeTextReachesUnapprovedRows() throws Exception {
        User owner = user("9850000009", "owner");
        User staff = user("9850000010", "staff");
        Property wanted = listing(owner, "Penthouse with terrace", PropertyStatus.PENDING);
        listing(owner, "Ordinary flat", PropertyStatus.PENDING);

        mvc.perform(get("/admin/properties").param("q", "penthouse")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].id").value(wanted.getId().toString()));
    }

    // An ordinary account reaching it would be a disclosure, not a UI bug.
    @Test
    @DisplayName("an ordinary user cannot read the queue")
    void seekersAreForbidden() throws Exception {
        User seeker = user("9850000011", "buyer");

        mvc.perform(get("/admin/properties").header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                .andExpect(status().isForbidden());
    }

    /** And an anonymous caller must not even get as far as the role check. */
    @Test
    @DisplayName("an anonymous caller is unauthorized")
    void anonymousIsUnauthorized() throws Exception {
        mvc.perform(get("/admin/properties")).andExpect(status().isUnauthorized());
    }

    // The assertion is deliberately equality against the seeded number rather than "does not contain X".
    @Test
    @DisplayName("owner contact is revealed in the queue, because the desk phones owners")
    void ownerContactIsRevealed() throws Exception {
        User owner = user("9850000012", "owner");
        User staff = user("9850000013", "staff");
        listing(owner, "Pending flat", PropertyStatus.PENDING);

        mvc.perform(get("/admin/properties").header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].owner.mobile").value("9850000012"));
    }

    // Each half existed before; only together are they a moderation system.
    @Test
    @DisplayName("a listing found in the queue can be approved and then appears publicly")
    void queueAndDecisionCloseTheLoop() throws Exception {
        User owner = user("9850000014", "owner");
        User staff = user("9850000015", "staff");
        Property p = listing(owner, "Awaiting review", PropertyStatus.PENDING);

        mvc.perform(get("/properties")).andExpect(jsonPath("$.totalElements").value(0));

        tickChecklist(p, staff);
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .patch("/properties/" + p.getId() + "/status")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"approved\",\"reason\":\"docs verified\"}"))
                .andExpect(status().isOk());

        mvc.perform(get("/properties")).andExpect(jsonPath("$.totalElements").value(1));
        mvc.perform(get("/admin/properties").param("status", PropertyStatus.APPROVED)
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(jsonPath("$.totalElements").value(1));
    }

    // Flagging removes a listing from public search; the queue is where it resurfaces.
    @Test
    @DisplayName("a flagged listing leaves public search and is findable in the queue")
    void flaggedListingsAreFindable() throws Exception {
        User owner = user("9850000016", "owner");
        User staff = user("9850000017", "staff");
        Property p = listing(owner, "Suspicious flat", PropertyStatus.APPROVED);

        mvc.perform(post("/properties/" + p.getId() + "/flag")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"duplicate photos\"}"))
                .andExpect(status().isOk());

        mvc.perform(get("/properties")).andExpect(jsonPath("$.totalElements").value(0));
        mvc.perform(get("/admin/properties").param("status", PropertyStatus.FLAGGED)
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].flagReason").value("duplicate photos"));
    }
}
