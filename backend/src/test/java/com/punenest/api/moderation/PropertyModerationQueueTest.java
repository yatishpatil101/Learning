package com.punenest.api.moderation;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.catalog.property.PropertyStatus;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.support.AbstractApiTest;
import java.math.BigDecimal;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;

/**
 * {@code GET /admin/properties} — the queue the five listing-moderation writes shipped without.
 *
 * <p>Every one of {@code setPropertyStatus}, {@code toggleFeatured}, {@code flagProperty},
 * {@code clearFlag} and {@code adminUpdateProperty} addresses a listing by {@code {id}}. Nothing on
 * the platform could produce such an id for an unapproved listing: {@code GET /properties} pins
 * {@code status='approved' AND archived=false} in the specification and takes no principal, so it
 * cannot relax for staff, and {@code GET /me/listings} is scoped to the caller's own
 * {@code owner_id}. A moderator could approve a listing only if somebody handed them the id.
 *
 * <p>The tests are written as a contrast throughout — each asserts both that the queue returns a row
 * <em>and</em> that the public search does not. Asserting only the first would still pass if someone
 * later "simplified" the two specifications into one, which is the change this endpoint most needs
 * protecting from.
 */
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
        return users.saveAndFlush(u);
    }

    private Property listing(User owner, String title, String status) {
        Property p = new Property(owner, title, "rent", "apartment", 28000L, "Baner", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("950"));
        p.setStatus(status);
        return properties.saveAndFlush(p);
    }

    /**
     * The whole point: the backlog is visible. Four statuses go in, four come out — and the same
     * four are invisible to the public search that was previously the only paged property read.
     */
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

        // The contrast that makes the endpoint necessary rather than merely convenient.
        mvc.perform(get("/properties"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1));
    }

    /**
     * On the public search a {@code status} param can only narrow within approved, so
     * {@code ?status=pending} yields an empty page. Here it must widen. Both halves are asserted
     * because the two endpoints share every other facet and it would be easy to give them the same
     * status semantics by accident.
     */
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

    /**
     * {@code archived} is tri-state, and the omitted case is the one that matters: an ops screen
     * showing "all listings" means all of them. A two-valued flag could not ask for both.
     */
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

    /**
     * The stays-live re-check queue (Q14). A price/furnishing/possession edit keeps the listing
     * {@code approved}, so neither {@code status} nor {@code archived} can surface it — the whole
     * outcome would be invisible to ops, which is how "live but flagged" becomes a flag nobody
     * reads. Tri-state for the same reason {@code archived} is.
     */
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
                // The age, not just the fact. A queue nobody drains is the failure mode this
                // outcome creates — the listing keeps earning while it waits — and it is
                // indistinguishable from an empty queue unless the wire says *how long*.
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

    /**
     * {@code archived} had to be added to the {@code Property} response for this endpoint to be
     * usable at all. Without it a client reading the unfiltered queue cannot tell a live pending
     * listing from an archived one — and the only assumption available, "not archived", is wrong for
     * precisely the rows an ops screen separates out. Asserting the field's <em>value</em>, not just
     * its presence, because a hard-coded {@code false} is exactly what this replaces.
     */
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

        // The `false` half is the one that can rot silently: the response record is @JsonInclude
        // (NON_NULL), and if `archived` ever became a boxed Boolean a false would still serialize —
        // but a null would vanish and every client would read the field as undefined.
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

    /**
     * The queue is every listing on the platform at every status, including other people's
     * unpublished drafts. An ordinary account reaching it would be a disclosure, not a UI bug.
     */
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

    /**
     * Owners' numbers are masked, as on every ops surface. A list is the sharper case than the
     * single-listing {@code adminUpdate} that set the precedent: it would leak the whole catalogue's
     * contacts in one response rather than one at a time.
     */
    @Test
    @DisplayName("owner contact is masked in the queue")
    void ownerContactIsMasked() throws Exception {
        User owner = user("9850000012", "owner");
        User staff = user("9850000013", "staff");
        listing(owner, "Pending flat", PropertyStatus.PENDING);

        mvc.perform(get("/admin/properties").header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].owner.mobile").value(org.hamcrest.Matchers.not("9850000012")));
    }

    /**
     * The loop both halves now close, asserted end to end: find a pending listing, approve it, and
     * watch it appear on the public site. Each half existed before; only together are they a
     * moderation system.
     */
    @Test
    @DisplayName("a listing found in the queue can be approved and then appears publicly")
    void queueAndDecisionCloseTheLoop() throws Exception {
        User owner = user("9850000014", "owner");
        User staff = user("9850000015", "staff");
        Property p = listing(owner, "Awaiting review", PropertyStatus.PENDING);

        mvc.perform(get("/properties")).andExpect(jsonPath("$.totalElements").value(0));

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

    /**
     * Flagging takes a listing off the public site and the queue is where it must resurface —
     * otherwise a flag is a write with no read, which is the defect this whole endpoint fixes.
     */
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
