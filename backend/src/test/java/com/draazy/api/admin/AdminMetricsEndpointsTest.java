package com.draazy.api.admin;

import com.draazy.api.support.AbstractApiTest;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.security.Teams;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;

/**
 * Behaviour proof for the three back-office reporting reads (slice 14): revenue doesn't leak
 * sideways, empty buckets are zeros not gaps, unbounded ranges are refused, unknown metrics are 400.
 */
class AdminMetricsEndpointsTest extends AbstractApiTest {

    @Autowired UserRepository users;

    private String bearer(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Metrics " + mobile.substring(6));
        u.setMobileVerified(true);
        // Staff without a desk are refused outright; the seeded document grants all six the same
        // set, so which one is immaterial here.
        if (Roles.Wire.STAFF.equals(role)) u.setTeam(Teams.RENTAL);
        return "Bearer " + jwtService.issueAccessToken(users.saveAndFlush(u));
    }

    private String admin() {
        return bearer("9877700001", Roles.Wire.ADMIN);
    }

    private String staff() {
        return bearer("9877700002", Roles.Wire.STAFF);
    }

    private String owner() {
        return bearer("9877700003", Roles.Wire.OWNER);
    }

    // ---- dashboard ----

    @Test
    void dashboardReturnsTheContractShape() throws Exception {
        mvc.perform(get(Routes.Admin.DASHBOARD).header(HttpHeaders.AUTHORIZATION, admin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalListings").isNumber())
                .andExpect(jsonPath("$.activeListings").isNumber())
                .andExpect(jsonPath("$.pendingModeration").isNumber())
                .andExpect(jsonPath("$.totalUsers").isNumber())
                .andExpect(jsonPath("$.newUsers7d").isNumber())
                .andExpect(jsonPath("$.dealsClosed30d").isNumber());
    }

    /** Staff may run the ops board; staff may not learn what the platform earns. */
    @Test
    void revenueIsBlankForStaffAndPresentForAdmin() throws Exception {
        mvc.perform(get(Routes.Admin.DASHBOARD).header(HttpHeaders.AUTHORIZATION, staff()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.revenue30d").value(org.hamcrest.Matchers.nullValue()));

        mvc.perform(get(Routes.Admin.DASHBOARD).header(HttpHeaders.AUTHORIZATION, admin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.revenue30d").isNumber());
    }

    @Test
    void newUsersCountsOnlyThisWeek() throws Exception {
        String token = admin();
        long before = kpi(token, "newUsers7d");

        // A user who joined today, and one who joined a year ago. Only the first may move the count.
        bearer("9877700010", Roles.Wire.BUYER);
        jdbc.update("insert into users (mobile, role, name, joined_at, mobile_verified, archived) "
                + "values ('9877700011', 'buyer', 'Old', now() - interval '400 days', true, false)");

        assertKpi(token, "newUsers7d", before + 1);
    }

    /** Soft-deleted rows are not "the platform's users" and must not be counted as such. */
    @Test
    void archivedUsersAreExcluded() throws Exception {
        String token = admin();
        long before = kpi(token, "totalUsers");
        jdbc.update("insert into users (mobile, role, name, joined_at, mobile_verified, archived) "
                + "values ('9877700012', 'buyer', 'Deleted', now(), true, true)");
        assertKpi(token, "totalUsers", before);
    }

    @Test
    void aPlainUserCannotSeeTheDashboard() throws Exception {
        mvc.perform(get(Routes.Admin.DASHBOARD).header(HttpHeaders.AUTHORIZATION, owner()))
                .andExpect(status().isForbidden());
    }

    // ---- finance ----

    @Test
    void financeIsAdminOnly() throws Exception {
        mvc.perform(get(Routes.Admin.FINANCE).header(HttpHeaders.AUTHORIZATION, staff()))
                .andExpect(status().isForbidden());
        mvc.perform(get(Routes.Admin.FINANCE).header(HttpHeaders.AUTHORIZATION, owner()))
                .andExpect(status().isForbidden());
    }

    /**
     * The breakdown always names both sources: a source that vanishes when idle makes "we made no
     * money on boosts" indistinguishable from "boosts are not reported".
     */
    @Test
    void financeAlwaysNamesEverySource() throws Exception {
        mvc.perform(get(Routes.Admin.FINANCE).header(HttpHeaders.AUTHORIZATION, admin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.revenue").isNumber())
                .andExpect(jsonPath("$.refunds").value(0))
                .andExpect(jsonPath("$.breakdown[?(@.source == 'subscriptions')]").exists())
                .andExpect(jsonPath("$.breakdown[?(@.source == 'boosts')]").exists());
    }

    // ---- analytics ----

    @Test
    void analyticsFillsEmptyBucketsWithZero() throws Exception {
        // Seven days inclusive of both ends.
        LocalDate to = LocalDate.now();
        LocalDate from = to.minusDays(6);
        mvc.perform(get(Routes.Admin.ANALYTICS)
                        .param("metric", "users")
                        .param("from", from.toString())
                        .param("to", to.toString())
                        .header(HttpHeaders.AUTHORIZATION, staff()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(7))
                .andExpect(jsonPath("$[0].date").value(from.toString()))
                .andExpect(jsonPath("$[6].date").value(to.toString()))
                .andExpect(jsonPath("$[0].value").isNumber());
    }

    /**
     * On a weekly series the first bucket must span the whole week, not start at {@code from}, or a
     * mid-week request returns a Monday bucket silently reporting only Wednesday onwards.
     */
    @Test
    void theFirstWeeklyBucketCountsTheWholeWeekNotJustFromTheRequestedDay() throws Exception {
        String token = staff();
        // Last week, so the range is entirely in the past whatever day the suite runs on.
        LocalDate monday = LocalDate.now().minusWeeks(1)
                .with(java.time.temporal.TemporalAdjusters.previousOrSame(java.time.DayOfWeek.MONDAY));
        LocalDate thursday = monday.plusDays(3);
        LocalDate sunday = monday.plusDays(6);

        long before = weeklyFirstBucket(token, thursday, sunday);
        jdbc.update("insert into users (mobile, role, name, joined_at, mobile_verified, archived) "
                        + "values ('9877700030', 'buyer', 'Monday joiner', "
                        + "(cast(? as timestamp) at time zone 'Asia/Kolkata') "
                        + "+ interval '10 hours', true, false)",
                java.sql.Date.valueOf(monday));

        org.assertj.core.api.Assertions.assertThat(weeklyFirstBucket(token, thursday, sunday))
                .as("a Monday signup belongs in the Monday bucket even when the range starts later")
                .isEqualTo(before + 1);
    }

    /** The value in the first bucket of a weekly series over {@code [from, to]}. */
    private long weeklyFirstBucket(String token, LocalDate from, LocalDate to) throws Exception {
        String body = mvc.perform(get(Routes.Admin.ANALYTICS)
                        .param("metric", "users")
                        .param("from", from.toString())
                        .param("to", to.toString())
                        .param("interval", "week")
                        .header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].date").value(
                        from.with(java.time.temporal.TemporalAdjusters
                                .previousOrSame(java.time.DayOfWeek.MONDAY)).toString()))
                .andReturn().getResponse().getContentAsString();
        int at = body.indexOf("\"value\":") + 8;
        int end = at;
        while (end < body.length() && Character.isDigit(body.charAt(end))) {
            end++;
        }
        return Long.parseLong(body.substring(at, end));
    }

    @Test
    void monthlyBucketsAlignToTheFirstOfTheMonth() throws Exception {
        LocalDate to = LocalDate.now();
        LocalDate from = to.minusMonths(2);
        mvc.perform(get(Routes.Admin.ANALYTICS)
                        .param("metric", "listings")
                        .param("from", from.toString())
                        .param("to", to.toString())
                        .param("interval", "month")
                        .header(HttpHeaders.AUTHORIZATION, staff()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(3))
                .andExpect(jsonPath("$[0].date").value(from.withDayOfMonth(1).toString()));
    }

    /** A new user must land in today's bucket — the whole point of bucketing in IST. */
    @Test
    void aSignupTodayLandsInTodaysBucket() throws Exception {
        String token = staff();
        LocalDate today = LocalDate.now();
        long before = seriesLast(token, "users", today);
        bearer("9877700020", Roles.Wire.BUYER);
        mvc.perform(get(Routes.Admin.ANALYTICS)
                        .param("metric", "users")
                        .param("from", today.toString())
                        .param("to", today.toString())
                        .header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].value").value((int) before + 1));
    }

    @Test
    void revenueIsAValidMetric() throws Exception {
        mvc.perform(get(Routes.Admin.ANALYTICS)
                        .param("metric", "revenue")
                        .header(HttpHeaders.AUTHORIZATION, staff()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].value").isNumber());
    }

    @Test
    void defaultsToTheLastThirtyOneDailyBuckets() throws Exception {
        mvc.perform(get(Routes.Admin.ANALYTICS)
                        .param("metric", "deals")
                        .header(HttpHeaders.AUTHORIZATION, staff()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(31));
    }

    @Test
    void anUnknownMetricIsRefused() throws Exception {
        mvc.perform(get(Routes.Admin.ANALYTICS)
                        .param("metric", "potato")
                        .header(HttpHeaders.AUTHORIZATION, staff()))
                .andExpect(status().isBadRequest());
    }

    @Test
    void anUnknownIntervalIsRefused() throws Exception {
        mvc.perform(get(Routes.Admin.ANALYTICS)
                        .param("metric", "users")
                        .param("interval", "fortnight")
                        .header(HttpHeaders.AUTHORIZATION, staff()))
                .andExpect(status().isBadRequest());
    }

    @Test
    void anUnboundedRangeIsRefused() throws Exception {
        mvc.perform(get(Routes.Admin.ANALYTICS)
                        .param("metric", "users")
                        .param("from", "1900-01-01")
                        .header(HttpHeaders.AUTHORIZATION, staff()))
                .andExpect(status().isBadRequest());
    }

    @Test
    void aBackwardsRangeIsRefused() throws Exception {
        mvc.perform(get(Routes.Admin.ANALYTICS)
                        .param("metric", "users")
                        .param("from", LocalDate.now().toString())
                        .param("to", LocalDate.now().minusDays(5).toString())
                        .header(HttpHeaders.AUTHORIZATION, staff()))
                .andExpect(status().isBadRequest());
    }

    @Test
    void analyticsIsNotPublic() throws Exception {
        mvc.perform(get(Routes.Admin.ANALYTICS).param("metric", "users"))
                .andExpect(status().isUnauthorized());
    }

    // ---- helpers ----

    private long kpi(String token, String field) throws Exception {
        String body = mvc.perform(get(Routes.Admin.DASHBOARD)
                        .header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        int at = body.indexOf("\"" + field + "\":") + field.length() + 3;
        int end = at;
        while (end < body.length() && Character.isDigit(body.charAt(end))) {
            end++;
        }
        return Long.parseLong(body.substring(at, end));
    }

    private void assertKpi(String token, String field, long expected) throws Exception {
        mvc.perform(get(Routes.Admin.DASHBOARD).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$." + field).value((int) expected));
    }

    private long seriesLast(String token, String metric, LocalDate day) throws Exception {
        String body = mvc.perform(get(Routes.Admin.ANALYTICS)
                        .param("metric", metric)
                        .param("from", day.toString())
                        .param("to", day.toString())
                        .header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        int at = body.indexOf("\"value\":") + 8;
        int end = at;
        while (end < body.length() && Character.isDigit(body.charAt(end))) {
            end++;
        }
        return Long.parseLong(body.substring(at, end));
    }
}
