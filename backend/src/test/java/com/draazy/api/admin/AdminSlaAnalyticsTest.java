package com.draazy.api.admin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.security.Teams;
import com.draazy.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;

/** {@code GET /admin/analytics/sla}. Semantics and the reasoning behind each predicate live in
 *  {@code docs/flows/admin/analytics.md} §5.7a; the fixtures below pin them one at a time. */
@DisplayName("/admin/analytics/sla — moderation turnaround, measured not modelled")
class AdminSlaAnalyticsTest extends AbstractApiTest {

    /** Must match {@code AdminSlaService.TARGET_HOURS}; asserted, not assumed. */
    private static final int TARGET_HOURS = 24;

    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;

    private String bearerFor(String mobile, String role, String name) {
        User u = new User(mobile, role);
        u.setName(name);
        u.setMobileVerified(true);
        // A staff account is keyed in the permission map by its desk, and one with no desk is refused
        // outright. Which desk is immaterial here — the seeded document grants all six the same set.
        if (Roles.Wire.STAFF.equals(role)) u.setTeam(Teams.RENTAL);
        return bearer(users.saveAndFlush(u));
    }

    private String admin() {
        return bearerFor("9877750001", Roles.Wire.ADMIN, "SLA admin");
    }

    /** A plain authenticated consumer — signed in, and entitled to none of this. */
    private String consumer() {
        return bearerFor("9877750002", Roles.Wire.BUYER, "SLA buyer");
    }

    private String body(String url, String token) throws Exception {
        return mvc.perform(get(url).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    private static long num(String json, String path) {
        return ((Number) JsonPath.read(json, path)).longValue();
    }

    /** Audit writes run {@code REQUIRES_NEW} and survive a neighbour's rollback, so an average over
     *  the suite's leftovers could not tell a correct implementation from a broken one. */
    private void clearRecordedDecisions() {
        jdbc.update("delete from audit_log where action = 'property.status' and entity = 'property'");
    }

    /** {@code created_at} is stamped by the database on insert, so a listing's age is moved
     *  afterwards rather than set on the entity — the application does not get to choose it. */
    private UUID listing(String suffix, String status, int ageHours) {
        User owner = new User("987775" + suffix, Roles.Wire.OWNER);
        owner.setName("SLA Landlord " + suffix);
        owner.setMobileVerified(true);
        owner = users.saveAndFlush(owner);

        Property p = new Property(owner, "SLA flat " + suffix, "rent", "apartment",
                25_000L, "Baner", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setArea(new BigDecimal("900"));
        p.setPriceUnit("per-month");
        p.setStatus(status);
        properties.saveAndFlush(p);

        jdbc.update("update properties set created_at = now() - make_interval(hours => cast(? as int)) "
                + "where id = ?", ageHours, p.getId());
        return p.getId();
    }

    /** Written straight to {@code audit_log}: the moderation endpoint stamps {@code now()}, so every
     *  fixture would have a turnaround of zero and could not tell a query from a constant. */
    private void recordDecision(UUID propertyId, int hoursAfterCreation) {
        jdbc.update("""
                insert into audit_log (actor, actor_role, action, entity, entity_id, metadata, at)
                values ('sla-fixture', 'admin', 'property.status', 'property', ?, '{}'::jsonb,
                        (select created_at from properties where id = ?)
                        + make_interval(hours => cast(? as int)))
                """, propertyId.toString(), propertyId, hoursAfterCreation);
    }

    /** The same decision against the listing's <em>slug</em>: {@code audit_log.entity_id} is free
     *  text, which is why the join carries an {@code or} branch. */
    private void recordDecisionBySlug(UUID propertyId, int hoursAfterCreation) {
        jdbc.update("""
                insert into audit_log (actor, actor_role, action, entity, entity_id, metadata, at)
                values ('sla-fixture', 'admin', 'property.status', 'property',
                        (select slug from properties where id = ?), '{}'::jsonb,
                        (select created_at from properties where id = ?)
                        + make_interval(hours => cast(? as int)))
                """, propertyId, propertyId, hoursAfterCreation);
    }

    /** Carries the {@code to} status, which only the concierge track reads. Kept apart from
     *  {@link #recordDecision} so a non-approval can be shown not to count as going live. */
    private void recordStatusDecision(UUID propertyId, int hoursAfterCreation, String toStatus) {
        jdbc.update("""
                insert into audit_log (actor, actor_role, action, entity, entity_id, metadata, at)
                values ('sla-fixture', 'admin', 'property.status', 'property', ?,
                        jsonb_build_object('to', cast(? as text)),
                        (select created_at from properties where id = ?)
                        + make_interval(hours => cast(? as int)))
                """, propertyId.toString(), toStatus, propertyId, hoursAfterCreation);
    }

    /** Written with jdbc because the ticket's age is the thing under measurement, and a fixture that
     *  could not set it would only ever produce turnarounds of zero. */
    private UUID ticket(String subject, String status, int ageHours) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                insert into tickets (id, subject, team, priority, status, created_at, updated_at)
                values (?, ?, 'rental', 'medium', ?,
                        now() - make_interval(hours => cast(? as int)), now())
                """, id, subject, status, ageHours);
        return id;
    }

    /** Hands a ticket to somebody, so it stops counting as unowned work. */
    private void assignTicket(UUID ticketId, UUID assigneeId) {
        jdbc.update("update tickets set assignee_id = ? where id = ?", assigneeId, ticketId);
    }

    /** Both metadata keys are written on every row because {@code TicketService.update} does; a
     *  fixture omitting one would describe a shape the application never produces. */
    private void recordTicketUpdate(UUID ticketId, int hoursAfterCreation,
            String toStatus, String assigneeId) {
        jdbc.update("""
                insert into audit_log (actor, actor_role, action, entity, entity_id, metadata, at)
                values ('sla-fixture', 'admin', 'ticket.update', 'ticket', ?,
                        jsonb_build_object('toStatus', cast(? as text),
                                           'assigneeId', cast(? as text)),
                        (select created_at from tickets where id = ?)
                        + make_interval(hours => cast(? as int)))
                """, ticketId.toString(), toStatus, assigneeId, ticketId, hoursAfterCreation);
    }

    /** See {@link #clearRecordedDecisions}; the ticket track needs the same clean slate. */
    private void clearRecordedTicketUpdates() {
        jdbc.update("delete from audit_log where action = 'ticket.update' and entity = 'ticket'");
        jdbc.update("delete from tickets");
    }

    @Nested
    @DisplayName("the guard")
    class Guard {

        /** The report names how slow the platform is to look at what it publishes. Not public. */
        @Test
        void aPlainConsumerCannotReadIt() throws Exception {
            mvc.perform(get(Routes.Admin.ANALYTICS_SLA).header(HttpHeaders.AUTHORIZATION, consumer()))
                    .andExpect(status().isForbidden());
        }

        /** The acceptance half, so the test above cannot pass because the route is simply broken. */
        @Test
        void anAdministratorReachesIt() throws Exception {
            mvc.perform(get(Routes.Admin.ANALYTICS_SLA).header(HttpHeaders.AUTHORIZATION, admin()))
                    .andExpect(status().isOk());
        }

        /** Staff too: a backlog only an administrator can see is a backlog nobody clears. */
        @Test
        void opsStaffReachesIt() throws Exception {
            String staff = bearerFor("9877750003", Roles.Wire.STAFF, "SLA staff");
            mvc.perform(get(Routes.Admin.ANALYTICS_SLA).header(HttpHeaders.AUTHORIZATION, staff))
                    .andExpect(status().isOk());
        }
    }

    @Nested
    @DisplayName("the shape")
    class Shape {

        /** The target is served, so the browser stops carrying its own copy of the number. */
        @Test
        void theResponseCarriesTheTargetAndEveryCount() throws Exception {
            String json = body(Routes.Admin.ANALYTICS_SLA, admin());

            assertThat((int) num(json, "$.targetHours")).isEqualTo(TARGET_HOURS);
            assertThat(num(json, "$.reviewedCount")).isNotNegative();
            assertThat(num(json, "$.breachedCount")).isNotNegative();
            assertThat(num(json, "$.pendingCount")).isNotNegative();
            assertThat(num(json, "$.pendingBreachingCount")).isNotNegative();
            assertThat((List<?>) JsonPath.read(json, "$.worstPending"))
                    .as("the offender list is always present, even when empty")
                    .isNotNull();
        }

        /** {@code ?days=} is validated rather than silently clamped or ignored. */
        @Test
        void anImpossibleWindowIsRejected() throws Exception {
            // One caller, reused: admin() inserts a user, and the mobile is unique, so asking for a
            // second token in the same test would fail on the fixture rather than on the endpoint.
            String admin = admin();

            mvc.perform(get(Routes.Admin.ANALYTICS_SLA + "?days=0")
                            .header(HttpHeaders.AUTHORIZATION, admin))
                    .andExpect(status().isBadRequest());
            mvc.perform(get(Routes.Admin.ANALYTICS_SLA + "?days=4000")
                            .header(HttpHeaders.AUTHORIZATION, admin))
                    .andExpect(status().isBadRequest());
        }
    }

    @Nested
    @DisplayName("turnaround")
    class Turnaround {

        /** Turnarounds chosen so every plausible mistake gives a different number: 5 = earliest
         *  (correct), 200 = latest, 102.5 = the mean of both. */
        @Test
        void turnaroundIsTheFirstDecision_notTheLatestAndNotTheirAverage() throws Exception {
            clearRecordedDecisions();
            UUID id = listing("0010", PropertyStatus.APPROVED, 400);
            recordDecision(id, 5);
            recordDecision(id, 200);

            String json = body(Routes.Admin.ANALYTICS_SLA, admin());

            assertThat(num(json, "$.reviewedCount"))
                    .as("two audit rows describe one reviewed listing, not two")
                    .isEqualTo(1);
            assertThat(((Number) JsonPath.read(json, "$.avgHoursToReview")).doubleValue())
                    .as("5 = earliest (correct); 200 = latest; 102.5 = mean of both")
                    .isEqualTo(5.0);
            assertThat(((Number) JsonPath.read(json, "$.medianHoursToReview")).doubleValue())
                    .isEqualTo(5.0);
        }

        /** The only test that records a decision against the slug: drop the join's {@code or} branch
         *  and every other test here stays green while older decisions stop counting. */
        @Test
        void aDecisionRecordedAgainstTheSlugStillCounts() throws Exception {
            clearRecordedDecisions();
            UUID id = listing("0031", PropertyStatus.APPROVED, 400);
            // The column is nullable and no fixture sets it, so without this the audit row would
            // carry a null and match nothing — which looks exactly like the branch working.
            jdbc.update("update properties set slug = ? where id = ?", "sla-slug-fixture", id);
            recordDecisionBySlug(id, 6);

            String json = body(Routes.Admin.ANALYTICS_SLA, admin());

            assertThat(num(json, "$.reviewedCount"))
                    .as("the slug identifies the same listing the id would have")
                    .isEqualTo(1);
            assertThat(((Number) JsonPath.read(json, "$.avgHoursToReview")).doubleValue())
                    .isEqualTo(6.0);
        }

        /** Breach counting, and the rate that follows from it. */
        @Test
        void aTurnaroundPastTheTargetIsABreachAndMovesTheRate() throws Exception {
            clearRecordedDecisions();
            recordDecision(listing("0011", PropertyStatus.APPROVED, 400), 4);
            recordDecision(listing("0012", PropertyStatus.APPROVED, 400), 8);
            recordDecision(listing("0013", PropertyStatus.REJECTED, 400), 48);

            String json = body(Routes.Admin.ANALYTICS_SLA, admin());

            assertThat(num(json, "$.reviewedCount"))
                    .as("a rejection is a decision — it is the queue being worked, not skipped")
                    .isEqualTo(3);
            assertThat(num(json, "$.breachedCount")).isEqualTo(1);
            assertThat(num(json, "$.slaRatePct")).as("two of three inside 24h").isEqualTo(67);
            assertThat(((Number) JsonPath.read(json, "$.avgHoursToReview")).doubleValue())
                    .as("(4 + 8 + 48) / 3")
                    .isEqualTo(20.0);
            assertThat(((Number) JsonPath.read(json, "$.medianHoursToReview")).doubleValue())
                    .as("the median is 8 — the figure the mean of 20 was hiding")
                    .isEqualTo(8.0);
        }

        /** A listing nobody has decided on is not a fast review; it is not a review. */
        @Test
        void aPendingListingIsNotCountedAsReviewed() throws Exception {
            clearRecordedDecisions();
            listing("0014", PropertyStatus.PENDING, 400);

            String json = body(Routes.Admin.ANALYTICS_SLA, admin());
            assertThat(num(json, "$.reviewedCount")).isZero();
        }

        /** {@code ?days=} filters on when the decision was taken, not when the listing was posted. */
        @Test
        void theWindowFiltersOnTheDecisionInstant() throws Exception {
            clearRecordedDecisions();
            // Both posted 100 days ago; one decided six hours later, one decided yesterday. A query
            // filtering on created_at would keep both or drop both, and never just the one.
            recordDecision(listing("0015", PropertyStatus.APPROVED, 2400), 6);
            recordDecision(listing("0016", PropertyStatus.APPROVED, 2400), 2376);

            String token = admin();
            assertThat(num(body(Routes.Admin.ANALYTICS_SLA, token), "$.reviewedCount"))
                    .as("all time sees both")
                    .isEqualTo(2);
            assertThat(num(body(Routes.Admin.ANALYTICS_SLA + "?days=30", token), "$.reviewedCount"))
                    .as("only the listing decided inside the window, however old the listing is")
                    .isEqualTo(1);
        }
    }

    @Nested
    @DisplayName("an empty record")
    class EmptyRecord {

        /** Null is the answer: there is no average of nothing, and a team with no decisions has not
         *  met the SLA. {@code breachedCount} stays 0 because it is a count, not a derived figure. */
        @Test
        void withNothingReviewedTheAverageAndTheRateAreNull_notZeroAndNotAHundred()
                throws Exception {
            clearRecordedDecisions();

            String json = body(Routes.Admin.ANALYTICS_SLA, admin());

            assertThat(num(json, "$.reviewedCount")).isZero();
            assertThat((Object) JsonPath.read(json, "$.avgHoursToReview"))
                    .as("0 would claim every review was instant")
                    .isNull();
            assertThat((Object) JsonPath.read(json, "$.medianHoursToReview")).isNull();
            assertThat((Object) JsonPath.read(json, "$.slaRatePct"))
                    .as("100 would claim a perfect record; 0 would claim a total failure")
                    .isNull();
            assertThat(num(json, "$.breachedCount"))
                    .as("no reviews ran late, which is true and is not a fabrication")
                    .isZero();
        }
    }

    @Nested
    @DisplayName("the backlog")
    class Backlog {

        /** Asserted as a delta: the seeded catalogue carries pending listings of its own, so an
         *  absolute count would fail the day somebody seeds an unrelated one. */
        @Test
        void aPendingListingOlderThanTheTargetIsBreachingNow() throws Exception {
            String token = admin();
            String before = body(Routes.Admin.ANALYTICS_SLA, token);
            long pendingBefore = num(before, "$.pendingCount");
            long breachingBefore = num(before, "$.pendingBreachingCount");

            listing("0020", PropertyStatus.PENDING, 48);
            listing("0021", PropertyStatus.PENDING, 1);

            String after = body(Routes.Admin.ANALYTICS_SLA, token);
            assertThat(num(after, "$.pendingCount") - pendingBefore)
                    .as("both are waiting")
                    .isEqualTo(2);
            assertThat(num(after, "$.pendingBreachingCount") - breachingBefore)
                    .as("only the 48-hour-old one is past a 24-hour target")
                    .isEqualTo(1);
        }

        /** The backlog is a present-tense fact, so narrowing the window must not shrink it. */
        @Test
        void theWindowDoesNotHideOldBacklog() throws Exception {
            String token = admin();
            long before = num(body(Routes.Admin.ANALYTICS_SLA + "?days=1", token),
                    "$.pendingBreachingCount");

            listing("0022", PropertyStatus.PENDING, 2400);

            assertThat(num(body(Routes.Admin.ANALYTICS_SLA + "?days=1", token),
                    "$.pendingBreachingCount") - before)
                    .as("a listing posted 100 days ago is exactly what a backlog report is for")
                    .isEqualTo(1);
        }

        /** Longest-waiting first — a queue ordered any other way is not a queue. */
        @Test
        void theOffenderListIsLongestWaitingFirstAndCapped() throws Exception {
            listing("0023", PropertyStatus.PENDING, 5000);

            String json = body(Routes.Admin.ANALYTICS_SLA, admin());
            List<Number> waits = JsonPath.read(json, "$.worstPending[*].hoursWaiting");

            assertThat(waits).as("the fixture guarantees at least one").isNotEmpty();
            assertThat(waits).hasSizeLessThanOrEqualTo(10);
            assertThat(waits.stream().map(Number::doubleValue).toList())
                    .isSortedAccordingTo(java.util.Comparator.reverseOrder());
            assertThat(waits.get(0).doubleValue())
                    .as("a listing waiting 5000 hours is the worst offender there is")
                    .isGreaterThanOrEqualTo(5000.0);
        }
    }

    /** Each test below goes after one predicate a plausible reimplementation gets wrong; each is a
     *  one-word change to the query. See {@code docs/flows/admin/analytics.md} §5.7a. */
    @Nested
    @DisplayName("ticket and concierge turnaround")
    class Tracks {

        /** Must match the three constants in {@code AdminSlaService}; asserted, not assumed. */
        @Test
        void everyTrackServesItsOwnTarget() throws Exception {
            String json = body(Routes.Admin.ANALYTICS_SLA, admin());

            assertThat((int) num(json, "$.ticketPickup.targetHours")).isEqualTo(4);
            assertThat((int) num(json, "$.ticketDelivery.targetHours")).isEqualTo(72);
            assertThat((int) num(json, "$.conciergeToLive.targetHours")).isEqualTo(168);
        }

        /** Assigned at +2h, re-queued at +26h with {@code assignee_id} left null: reading the column
         *  reports nothing picked up, reading the latest row reports 26. */
        @Test
        void pickupIsTheFirstRealAssignment_notTheColumnAndNotTheUnassignment() throws Exception {
            clearRecordedTicketUpdates();
            UUID t = ticket("Rent agreement draft", "open", 400);
            recordTicketUpdate(t, 2, "in-progress", UUID.randomUUID().toString());
            recordTicketUpdate(t, 26, "open", "none");

            String json = body(Routes.Admin.ANALYTICS_SLA, admin());

            assertThat(num(json, "$.ticketPickup.completedCount"))
                    .as("two rows describe one ticket that was picked up once")
                    .isEqualTo(1);
            assertThat(((Number) JsonPath.read(json, "$.ticketPickup.avgHours")).doubleValue())
                    .as("2 = first real assignment; 26 = the unassignment counted as a pickup")
                    .isEqualTo(2.0);
        }

        /** The assigned ticket is the control: without it a query counting every open ticket would
         *  pass, and that is the query reporting a desk clearing nothing as a desk with no backlog. */
        @Test
        void anUnownedTicketIsOutstandingAndPastTheTargetIsBreaching() throws Exception {
            clearRecordedTicketUpdates();
            ticket("Unowned and old", "open", 9);
            ticket("Unowned and fresh", "open", 1);
            UUID owned = ticket("Owned and old", "in-progress", 9);
            assignTicket(owned, users.saveAndFlush(ownedBy("9877750011")).getId());

            String json = body(Routes.Admin.ANALYTICS_SLA, admin());

            assertThat(num(json, "$.ticketPickup.outstandingCount"))
                    .as("only the two nobody has taken")
                    .isEqualTo(2);
            assertThat(num(json, "$.ticketPickup.outstandingBreachingCount"))
                    .as("only the nine-hour-old one is past a four-hour target")
                    .isEqualTo(1);
        }

        /** Recognising only {@code resolved} would leave every closed ticket outstanding for ever —
         *  a backlog that grows every time somebody tidies up. */
        @Test
        void deliveryCountsAClosedTicketAsFinished() throws Exception {
            clearRecordedTicketUpdates();
            UUID resolved = ticket("Resolved", "resolved", 400);
            UUID closed = ticket("Closed unresolved", "closed", 400);
            recordTicketUpdate(resolved, 10, "resolved", null);
            recordTicketUpdate(closed, 90, "closed", null);

            String json = body(Routes.Admin.ANALYTICS_SLA, admin());

            assertThat(num(json, "$.ticketDelivery.completedCount")).isEqualTo(2);
            assertThat(num(json, "$.ticketDelivery.breachedCount"))
                    .as("90 hours is past the 72-hour target; 10 is not")
                    .isEqualTo(1);
            assertThat(num(json, "$.ticketDelivery.slaRatePct")).isEqualTo(50);
            assertThat(((Number) JsonPath.read(json, "$.ticketDelivery.avgHours")).doubleValue())
                    .as("(10 + 90) / 2")
                    .isEqualTo(50.0);
        }

        /** Bounced back at +4h, approved at +200h: reusing the review track's "earliest decision"
         *  reports 4, which would have this desk publishing everything inside half a day. */
        @Test
        void conciergeMeasuresTheApproval_notTheFirstDecision() throws Exception {
            clearRecordedDecisions();
            UUID id = listing("0040", PropertyStatus.APPROVED, 400);
            jdbc.update("update properties set posted_by_admin = true where id = ?", id);
            recordStatusDecision(id, 4, "pending");
            recordStatusDecision(id, 200, "approved");

            String json = body(Routes.Admin.ANALYTICS_SLA, admin());

            assertThat(num(json, "$.conciergeToLive.completedCount")).isEqualTo(1);
            assertThat(((Number) JsonPath.read(json, "$.conciergeToLive.avgHours")).doubleValue())
                    .as("200 = went live; 4 = somebody merely looked at it")
                    .isEqualTo(200.0);
            assertThat(num(json, "$.conciergeToLive.breachedCount"))
                    .as("200 hours is past a 168-hour target")
                    .isEqualTo(1);
        }

        /** Without the {@code posted_by_admin} filter this reports the whole catalogue's approval
         *  time under a heading about staff-posted listings — plausible, and a different team. */
        @Test
        void anOwnerPostedListingIsNotConciergeWork() throws Exception {
            clearRecordedDecisions();
            recordStatusDecision(listing("0041", PropertyStatus.APPROVED, 400), 12, "approved");

            String json = body(Routes.Admin.ANALYTICS_SLA, admin());

            assertThat(num(json, "$.conciergeToLive.completedCount")).isZero();
            assertThat(num(json, "$.reviewedCount"))
                    .as("the same listing does count as a review, which is what makes this a filter"
                            + " rather than a fixture that failed to arrive")
                    .isEqualTo(1);
        }

        /** "Anything not approved" is the obvious spelling of the outstanding predicate and it is
         *  wrong: it grows the backlog every time the pipeline correctly turns something down. */
        @Test
        void aRejectedConciergeListingIsNotStillPending() throws Exception {
            String token = admin();
            long before = num(body(Routes.Admin.ANALYTICS_SLA, token),
                    "$.conciergeToLive.outstandingCount");

            UUID rejected = listing("0042", PropertyStatus.REJECTED, 400);
            UUID pending = listing("0043", PropertyStatus.PENDING, 400);
            jdbc.update("update properties set posted_by_admin = true where id in (?, ?)",
                    rejected, pending);

            assertThat(num(body(Routes.Admin.ANALYTICS_SLA, token),
                    "$.conciergeToLive.outstandingCount") - before)
                    .as("only the pending one is still on its way to live")
                    .isEqualTo(1);
        }

        /** Null on all three tracks: zero hours and 100% would have a fresh deployment reporting
         *  instantaneous service and perfect compliance. */
        @Test
        void withNothingCompletedEveryTrackSaysSoRatherThanClaimingAPerfectRecord()
                throws Exception {
            clearRecordedTicketUpdates();
            clearRecordedDecisions();

            String json = body(Routes.Admin.ANALYTICS_SLA, admin());

            for (String track : List.of("ticketPickup", "ticketDelivery", "conciergeToLive")) {
                assertThat(num(json, "$." + track + ".completedCount")).as(track).isZero();
                assertThat((Object) JsonPath.read(json, "$." + track + ".avgHours"))
                        .as(track + ": 0h would claim instantaneous service")
                        .isNull();
                assertThat((Object) JsonPath.read(json, "$." + track + ".medianHours"))
                        .as(track).isNull();
                assertThat((Object) JsonPath.read(json, "$." + track + ".slaRatePct"))
                        .as(track + ": 100% would claim a flawless record")
                        .isNull();
            }
        }

        /** The window filters on completion, like the review track's does on the decision. */
        @Test
        void theWindowFiltersOnWhenTheWorkWasFinished() throws Exception {
            clearRecordedTicketUpdates();
            // Both raised 100 days ago; one delivered the next day, one delivered yesterday. A query
            // that filtered on created_at would keep both or drop both, and never just the one.
            recordTicketUpdate(ticket("Old and long done", "resolved", 2400), 24, "resolved", null);
            recordTicketUpdate(ticket("Old and just done", "resolved", 2400), 2376, "resolved", null);

            String token = admin();
            assertThat(num(body(Routes.Admin.ANALYTICS_SLA, token),
                    "$.ticketDelivery.completedCount"))
                    .as("all time sees both")
                    .isEqualTo(2);
            assertThat(num(body(Routes.Admin.ANALYTICS_SLA + "?days=30", token),
                    "$.ticketDelivery.completedCount"))
                    .as("only the one finished inside the window, however old the ticket is")
                    .isEqualTo(1);
        }

        private User ownedBy(String mobile) {
            User u = new User(mobile, Roles.Wire.STAFF);
            u.setName("SLA assignee");
            u.setMobileVerified(true);
            return u;
        }
    }
}
