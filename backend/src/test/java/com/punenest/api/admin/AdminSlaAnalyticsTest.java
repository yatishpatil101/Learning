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
}
