package com.punenest.api.moderation;

import com.punenest.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
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
 * <p>The other tests cover the invariants that would fail silently rather than loudly: that
 * {@code from} is derived server-side (an owner cannot post as ops), that {@code markRead} touches
 * only the other side's messages (marking your own read would clear the badge the other participant
 * is waiting on), that a decision writes <em>both</em> the case file and the listing status, and
 * that it drains any stays-live re-check the listing was queued for.
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
        // must return the existing case rather than violate the constraint. The checklist length is
        // not evidence of that on its own -- two cases would each carry three lines -- so count the
        // rows. properties.flush() first, because JdbcTemplate does not trigger a Hibernate flush.
        mvc.perform(post(path(rental, "")).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.checklist.length()").value(3));
        properties.flush();
        assertThat(jdbc.queryForObject("select count(*) from property_reviews where property_id = ?",
                Integer.class, rental.getId())).isEqualTo(1);
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
    @DisplayName("a decision writes its own explanation into the thread, attributed to ops")
    void aDecisionExplainsItselfInTheThread() throws Exception {
        User owner = user("9820000512", Roles.Wire.OWNER);
        User ops = user("9820000513", Roles.Wire.STAFF);
        Property approved = listing(owner, "rent");
        Property rejected = listing(owner, "rent");

        mvc.perform(post(path(approved, "")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated());
        mvc.perform(post(path(approved, "/decision")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"approve\",\"note\":\"Index II matched.\"}"))
                .andExpect(status().isOk())
                // "ops" is derived from the sender like every other message, not hard-coded on the
                // decision path — so a staff member deciding cannot be rendered as the owner.
                .andExpect(jsonPath("$.messages[0].from").value("ops"))
                // Non-null only because decide() flushes: id and createdAt are assigned at insert.
                .andExpect(jsonPath("$.messages[0].id").isNotEmpty())
                .andExpect(jsonPath("$.messages[0].body")
                        .value("\u2705 Your property has been verified and approved. Index II matched."));

        // The rejection is read back by the *owner*, which is the whole point: the sentence is a
        // persisted row, not something the deciding console painted on its own screen. A blank note
        // still owes them a reason and an instruction.
        mvc.perform(post(path(rejected, "")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated());
        mvc.perform(post(path(rejected, "/decision")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON).content("{\"decision\":\"reject\"}"))
                .andExpect(status().isOk());
        mvc.perform(get(path(rejected, "")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages[0].body").value(
                        "\u26D4 Your property could not be approved.\nReason: It did not meet our"
                                + " verification requirements.\nPlease address this and reply here"
                                + " to resubmit."));
    }

    /**
     * A decision is a moderator looking at the listing, which is the whole of what a queued
     * stays-live re-check (Q14) was asking for — so deciding must drain it, exactly as
     * {@code PATCH /properties/{id}/status} does. The rule lived only on that other route, and this
     * one wrote {@code properties.status} through the raw setter, so a re-check failed from the
     * console left {@code recheck_requested_at} standing on a rejected listing.
     *
     * <p>The queue filters on that column alone, so the row was undrainable, the tab's backlog count
     * was permanently wrong, and — the reason this is a test and not a tidy-up — the stale row still
     * offered "Looks fine", which PATCHes the listing back to {@code approved}. One click to undo a
     * rejection, on a screen that gives no sign that is what it does.
     *
     * <p>Both verdicts, because the harm is not symmetrical and neither is the code: {@code approve}
     * also clears {@code flagReason} and would be the natural place to put a clear-on-approve fix
     * that leaves the dangerous half untouched.
     */
    @Test
    @DisplayName("either verdict clears a pending stays-live re-check")
    void aDecisionClearsThePendingRecheck() throws Exception {
        User owner = user("9820000514", Roles.Wire.OWNER);
        User ops = user("9820000515", Roles.Wire.STAFF);

        for (String decision : List.of("approve", "reject")) {
            Property listing = listing(owner, "rent");
            listing.setStatus(PropertyStatus.APPROVED);
            listing.requestRecheck(List.of("price"));
            properties.saveAndFlush(listing);
            // The premise, asserted rather than assumed: requestRecheck is a no-op on a listing that
            // is not publicly visible, so a setup that silently queued nothing would satisfy the
            // assertion below with the fix removed.
            assertThat(listing.isRecheckPending())
                    .as("the fixture did not queue a re-check to begin with")
                    .isTrue();

            mvc.perform(post(path(listing, "")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                    .andExpect(status().isCreated());
            mvc.perform(post(path(listing, "/decision")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"decision\":\"" + decision + "\",\"note\":\"re-checked\"}"))
                    .andExpect(status().isOk());

            properties.flush();
            assertThat(jdbc.queryForObject(
                    "select recheck_requested_at from properties where id = ?",
                    java.sql.Timestamp.class, listing.getId()))
                    .as("a listing a checker has just %sd is still sitting in the re-check queue",
                            decision)
                    .isNull();
        }
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

    /**
     * D218. The checklist was write-only in the wrong direction: seeded at {@code initiate} and then
     * never touched, so every tick the console recorded lived in the reviewer's own browser. The
     * case that matters is therefore not "a tick round-trips" but "a <em>second</em> reviewer sees
     * it" — which is the one browser storage could never satisfy.
     */
    @Test
    @DisplayName("a tick persists, is addressed by item text, and the next reviewer sees it")
    void tickingAChecklistLineOutlivesTheReviewersSession() throws Exception {
        User owner = user("9820000514", Roles.Wire.OWNER);
        User ops = user("9820000515", Roles.Wire.STAFF);
        User colleague = user("9820000516", Roles.Wire.STAFF);
        Property listing = listing(owner, "rent");

        mvc.perform(post(path(listing, "")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated())
                // The baseline the rest of this test measures against, stated positively. A filter
                // for ticked lines returning nothing is also what an absent checklist returns, so
                // the negative form would have established nothing.
                .andExpect(jsonPath("$.checklist.length()").value(3))
                .andExpect(jsonPath("$.checklist[?(@.item == 'Electricity bill')].pass").value(false));

        mvc.perform(patch(path(listing, "/checklist")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"item\":\"Electricity bill\",\"pass\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.checklist[?(@.item == 'Electricity bill')].pass").value(true))
                .andExpect(jsonPath("$.checklist[?(@.item == 'Index II')].pass").value(false));

        // A different staff member, a different session, a different request.
        mvc.perform(get(path(listing, "")).header(HttpHeaders.AUTHORIZATION, bearer(colleague)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.checklist[?(@.item == 'Electricity bill')].pass").value(true));

        // Read the column itself, not the response. Both reads above are served from the same
        // persistence context, so they would pass identically if the tick never left memory — which
        // is the one failure mode this endpoint exists to rule out. JdbcTemplate does not trigger a
        // Hibernate auto-flush, so this sees the row only if the write really was flushed.
        properties.flush();
        assertThat(jdbc.queryForObject(
                "select pass from property_review_checklist c join property_reviews r on r.id = c.review_id"
                        + " where r.property_id = ? and c.item = ?",
                Boolean.class, listing.getId(), "Electricity bill")).isTrue();

        // Unticking is the same call — a reviewer who ticked the wrong line must be able to undo it
        // without reopening the case.
        mvc.perform(patch(path(listing, "/checklist")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"item\":\"Electricity bill\",\"pass\":false}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.checklist[?(@.item == 'Electricity bill')].pass").value(false));

        // An item that is not on this deal's list is a 404, not a silent no-op: a console ticking a
        // line the server has never heard of is out of step with the case file and should be told.
        mvc.perform(patch(path(listing, "/checklist")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"item\":\"Encumbrance certificate\",\"pass\":true}"))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("staff cannot tick the checklist of a listing they own")
    void staffCannotMarkTheirOwnHomework() throws Exception {
        User staff = user("9820000517", Roles.Wire.STAFF);
        Property own = listing(staff, "rent");
        String token = bearer(staff);

        mvc.perform(post(path(own, "")).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isCreated());
        mvc.perform(patch(path(own, "/checklist")).header(HttpHeaders.AUTHORIZATION, token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"item\":\"Index II\",\"pass\":true}"))
                .andExpect(status().isForbidden());
    }

    /**
     * D218. The owner dashboard needs a status and an unread badge per listing, and until this
     * route existed the only way to get them was one participant-scoped GET per card — nineteen of
     * which 404 on a twenty-listing dashboard. What has to hold is the scoping: this is the one
     * queue route with no role guard at all, so if the owner filter were wrong it would hand every
     * owner every other owner's case files.
     */
    @Test
    @DisplayName("the owner queue returns only my listings, with ops' unread messages counted")
    void ownerQueueIsScopedToTheCallerAndCountsTheOtherSide() throws Exception {
        User owner = user("9820000518", Roles.Wire.OWNER);
        User stranger = user("9820000519", Roles.Wire.OWNER);
        User ops = user("9820000520", Roles.Wire.STAFF);
        Property mine = listing(owner, "rent");
        Property theirs = listing(stranger, "rent");

        mvc.perform(post(path(mine, "")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated());
        mvc.perform(post(path(theirs, "")).header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isCreated());

        // One message each way. Only the ops one should count towards the owner's badge — a badge
        // that counted your own sent messages would never clear.
        mvc.perform(post(path(mine, "/messages")).header(HttpHeaders.AUTHORIZATION, bearer(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"body\":\"Uploaded the bill.\"}"))
                .andExpect(status().isCreated());
        mvc.perform(post(path(mine, "/messages")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"body\":\"Thanks, checking now.\"}"))
                .andExpect(status().isCreated());

        mvc.perform(get("/me/property-reviews").header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].propertyId").value(mine.getId().toString()))
                .andExpect(jsonPath("$.content[0].unread").value(1));

        // The same page, from the desk's end: the owner's message is the one waiting on ops.
        mvc.perform(get("/admin/property-reviews").header(HttpHeaders.AUTHORIZATION, bearer(ops)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[?(@.propertyId == '" + mine.getId() + "')].unread")
                        .value(1));

        // Reading clears one side only. This is the assertion that would catch `markRead` being
        // widened to every message, which would silently clear the badge the other side is waiting
        // on — a bug neither participant could see from their own screen.
        mvc.perform(post(path(mine, "/read")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isNoContent());
        mvc.perform(get("/me/property-reviews").header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].unread").value(0));
        mvc.perform(get("/admin/property-reviews").header(HttpHeaders.AUTHORIZATION, bearer(ops)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[?(@.propertyId == '" + mine.getId() + "')].unread")
                        .value(1));

        // A user with no listings gets an empty page, not a 403: nothing here is privileged.
        mvc.perform(get("/me/property-reviews").header(HttpHeaders.AUTHORIZATION, bearer(ops)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(0));
    }
}
