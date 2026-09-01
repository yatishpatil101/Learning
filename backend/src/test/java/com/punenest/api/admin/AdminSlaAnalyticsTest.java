package com.punenest.api.admin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.catalog.property.PropertyStatus;
import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.Roles;
import com.punenest.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;

/**
 * {@code GET /admin/analytics/sla} — the report that replaced a seeded constant.
 *
 * <p><strong>Why the reviewed set is emptied first in most of these.</strong> This class shares a
 * database with the whole suite, and {@code audit_log} is the one table whose rows survive a
 * neighbouring test: audit writes run {@code REQUIRES_NEW} and commit regardless of the caller's
 * rollback. So the reviewed population at the start of any test here is whatever moderation the rest
 * of the suite happened to perform, which is neither empty nor stable. Every test that asserts an
 * <em>average</em> therefore deletes the {@code property.status} rows first and seeds exactly the
 * decisions it means to measure — inside the class's own transaction, so the delete is rolled back
 * with everything else and no other test ever sees it.
 *
 * <p>That is not a shortcut around a hard assertion; it is the only way to make one. An average over
 * "my two fixtures plus an unknown number of other people's" cannot distinguish a correct
 * implementation from an incorrect one, which is exactly the vacuous green {@code tasks/lessons.md}
 * warns about. The counts that <em>can</em> be asserted as a delta — the pending ones — are, because
 * those read a table this class does not get to clear.
 *
 * <p><strong>The fixture turnarounds are chosen so every plausible mistake gives a different
 * answer.</strong> The re-approval case decides at +5h and again at +200h: an implementation that
 * takes the earliest reports 5, one that takes the latest reports 200, and one that averages both
 * reports 102.5. Picking two nearby timestamps would have let all three pass.
 */
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

    /**
     * Removes every recorded moderation decision for the duration of this transaction.
     *
     * <p>See the class docblock. Rolled back with the test, so it is invisible to everything else.
     */
    private void clearRecordedDecisions() {
        jdbc.update("delete from audit_log where action = 'property.status' and entity = 'property'");
    }

    /**
     * A listing in {@code status}, created {@code ageHours} ago.
     *
     * <p>{@code created_at} is stamped by the database on insert, so it is moved afterwards rather
     * than set on the entity — which is also the honest way to build this fixture, since a listing's
     * age is not something the application is allowed to choose.
     */
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

    /**
     * One recorded moderation decision, {@code hoursAfterCreation} after the listing was posted.
     *
     * <p>Written straight to {@code audit_log} rather than through the moderation endpoint on
     * purpose: the endpoint stamps {@code now()}, so every fixture would have a turnaround of zero
     * and nothing here could tell a working query from one that returns a constant.
     */
    private void recordDecision(UUID propertyId, int hoursAfterCreation) {
        jdbc.update("""
                insert into audit_log (actor, actor_role, action, entity, entity_id, metadata, at)
                values ('sla-fixture', 'admin', 'property.status', 'property', ?, '{}'::jsonb,
                        (select created_at from properties where id = ?)
                        + make_interval(hours => cast(? as int)))
                """, propertyId.toString(), propertyId, hoursAfterCreation);
    }

    /**
     * The same decision, recorded against the listing's <em>slug</em>. {@code audit_log.entity_id} is
     * free text, and the moderation surfaces have not always agreed on which identifier belongs in
     * it — which is why the join carries an {@code or} branch rather than matching on the id alone.
     */
    private void recordDecisionBySlug(UUID propertyId, int hoursAfterCreation) {
        jdbc.update("""
                insert into audit_log (actor, actor_role, action, entity, entity_id, metadata, at)
                values ('sla-fixture', 'admin', 'property.status', 'property',
                        (select slug from properties where id = ?), '{}'::jsonb,
                        (select created_at from properties where id = ?)
                        + make_interval(hours => cast(? as int)))
                """, propertyId, propertyId, hoursAfterCreation);
    }

    /**
     * The same decision, carrying the {@code to} status the moderation route records.
     *
     * <p>{@link #recordDecision} deliberately writes {@code '{}'} — the review track does not read
     * the metadata, and the concierge track does. Keeping the two fixtures apart is what lets the
     * concierge tests assert that a decision which was <em>not</em> an approval does not count as a
     * listing going live.
     */
    private void recordStatusDecision(UUID propertyId, int hoursAfterCreation, String toStatus) {
        jdbc.update("""
                insert into audit_log (actor, actor_role, action, entity, entity_id, metadata, at)
                values ('sla-fixture', 'admin', 'property.status', 'property', ?,
                        jsonb_build_object('to', cast(? as text)),
                        (select created_at from properties where id = ?)
                        + make_interval(hours => cast(? as int)))
                """, propertyId.toString(), toStatus, propertyId, hoursAfterCreation);
    }

    /**
     * A service request raised {@code ageHours} ago.
     *
     * <p>Written with jdbc rather than through the repository for the same reason the listing
     * fixture moves {@code created_at} afterwards: the age of a ticket is the thing under
     * measurement, and a fixture that could not set it would only ever produce turnarounds of zero.
     */
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

    /**
     * One recorded ticket change, {@code hoursAfterCreation} after it was raised.
     *
     * <p>Both metadata keys are written on every row because {@code TicketService.update} writes
     * both on every row — it records the status transition and the assignment together, whether or
     * not the caller touched either. A fixture that omitted one would be describing a shape the
     * application never produces, and the predicates under test are exactly the ones that have to
     * tell "this row assigned somebody" from "this row was a status change that left the assignee
     * alone" inside that single shape.
     */
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

        /**
         * Staff too — the people this measures are the people who clear the queue, and a backlog
         * only an administrator can see is a backlog nobody clears.
         */
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

        /**
         * <strong>The assertion that proves the metric is real.</strong>
         *
         * <p>One listing, decided twice: approved five hours after it was posted, then re-approved
         * after a stays-live re-check two hundred hours later. The turnaround is five, because the
         * platform answered this owner in five hours — the re-check is a second look at a listing
         * that already had its decision, not a second first decision.
         *
         * <p>Each wrong rule gives a different, recognisable number: 200 means the query took the
         * latest row, 102.5 means it averaged every row, and 5 means it took the earliest.
         */
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

        /**
         * The join's second branch. A decision whose {@code entity_id} holds the slug rather than
         * the id must still count, and nothing else in this class records one that way: delete the
         * {@code or} branch and the other tests all stay green, while every decision logged in the
         * older style silently stops counting — which would *improve* the reported average, because
         * the listings that vanish from the numerator stay in the pending backlog.
         */
        @Test
        void aDecisionRecordedAgainstTheSlugStillCounts() throws Exception {
            clearRecordedDecisions();
            UUID id = listing("0031", PropertyStatus.APPROVED, 400);
            // The fixtures never set one, and the column is nullable — so without this the audit row
            // would carry a null and match nothing, which looks exactly like the branch working.
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
            // Posted 100 days ago and decided six hours later — so the listing is old, the decision
            // is old, and a 30-day window must exclude it. A query that filtered on created_at
            // would agree here by accident, which is why the next fixture posts just as long ago
            // and is decided yesterday.
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

        /**
         * The whole reason this endpoint exists.
         *
         * <p>The mock returned {@code avgApprovalTime: 0} and {@code approvalSlaRate: 100} when
         * nothing had been reviewed, so a deployment whose moderation queue had never been touched
         * reported instant reviews and a flawless record. Both figures are null here, and null is
         * the answer being asserted: there is no average of nothing, and a team with no decisions
         * has not met the SLA — it has no SLA record at all.
         *
         * <p>{@code breachedCount} stays 0 rather than going null, and that is not an inconsistency:
         * "how many reviews ran late" genuinely is zero when there were no reviews. It is the
         * <em>derived</em> figures — a mean and a percentage, both of which divide by the count —
         * that have no value.
         */
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

        /**
         * The one figure on this report somebody acts on today.
         *
         * <p>Asserted as a delta: the seeded catalogue carries pending listings of its own and this
         * class has no business clearing the property table, so an absolute count would be a test
         * that fails the day somebody seeds an unrelated listing.
         */
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

    /**
     * The three tracks that used to be {@code rng(314159)} (D252).
     *
     * <p>Every test here is built so that the seeded generator it replaces would fail it. That bar
     * is low for a number — any fixture disagrees with a constant — so the assertions go after the
     * <em>predicates</em> instead, which is where a plausible-looking reimplementation goes wrong:
     * reading pickup off {@code tickets.assignee_id}, treating an unassignment as a pickup, counting
     * only {@code resolved} as delivered, or timing a concierge listing to its first decision rather
     * than to the decision that put it live. Each of those is a one-word change to the query and
     * each has its own test below.
     */
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

        /**
         * <strong>Pickup is when somebody took it, not who holds it now.</strong>
         *
         * <p>The ticket is assigned two hours in, handed back to the pool a day later, and its
         * {@code assignee_id} column is left null — the state a real re-queued ticket is in. An
         * implementation that read the column reports nothing picked up; one that read the
         * <em>latest</em> assignment row reports 26 hours, because {@code none} is a non-null
         * {@code assigneeId} in the metadata. Two hours is the only answer that means "somebody
         * owned this within two hours", which is the question the track asks.
         */
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

        /**
         * A ticket nobody has taken is outstanding, and past four hours it is breaching.
         *
         * <p>The assigned one is the control: without it a query that simply counted every open
         * ticket would pass, and that is precisely the query that would report a desk clearing
         * nothing as a desk with no backlog.
         */
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

        /**
         * <strong>Closed counts as delivered.</strong>
         *
         * <p>A desk that closes a request without resolving it has finished with it. Recognising
         * only {@code resolved} would leave every closed ticket in the outstanding pile for ever —
         * a backlog that grows every time somebody tidies up, which is the shape of metric that
         * gets ignored and then switched off.
         */
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

        /**
         * <strong>Concierge measures the approval, not the first look.</strong>
         *
         * <p>The listing is bounced back to pending after four hours and approved after two hundred.
         * The first row is a decision — the review track counts it, and correctly — but the listing
         * did not go live until the second. An implementation that reused the review track's
         * "earliest {@code property.status} row" reports 4, which would have this desk publishing
         * everything inside half a day.
         */
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

        /**
         * An owner's own listing is not concierge work, however it was decided.
         *
         * <p>The one predicate that keeps this track about the desk it names. Without
         * {@code posted_by_admin} it would report the whole catalogue's approval time under a
         * heading about staff-posted listings — a number that looks reasonable, moves plausibly, and
         * is measuring a different team.
         */
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

        /**
         * A rejected concierge listing is finished with, not still waiting.
         *
         * <p>"Anything that is not approved" is the obvious spelling of the outstanding predicate
         * and it is wrong: it grows the backlog every time the pipeline correctly turns something
         * down, so the one report that could tell an ops lead the desk is working punishes it for
         * working.
         */
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

        /**
         * The empty case, on all three tracks — the failure the whole endpoint exists to fix.
         *
         * <p>The generator returned {@code avgPickupTime: 0} and {@code conciergeSlaRate: 100} for a
         * desk that had never touched a ticket, so a fresh deployment reported instantaneous service
         * and perfect compliance. Both are null here.
         */
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
