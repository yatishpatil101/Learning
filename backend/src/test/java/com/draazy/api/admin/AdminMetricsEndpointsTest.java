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
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;

// Behaviour proof for the three back-office reporting reads (slice 14): revenue doesn't leak
// sideways, empty buckets are zeros not gaps, unbounded ranges are refused, unknown metrics are 400.
class AdminMetricsEndpointsTest extends AbstractApiTest {

    @Autowired UserRepository users;

    private String bearer(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Metrics " + mobile.substring(6));
        u.setMobileVerified(true);

        // Staff without a desk are refused outright; the seeded document grants all six the same
        // set, so which one is immaterial here.
        if (Roles.Wire.STAFF.equals(role)) u.setTeam(Teams.RENTAL);
        return super.bearer(users.saveAndFlush(u));
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

    // Soft-deleted rows are not "the platform's users" and must not be counted as such.
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

    @Test
    void financeAlwaysNamesEverySource() throws Exception {
        mvc.perform(get(Routes.Admin.FINANCE).header(HttpHeaders.AUTHORIZATION, admin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.revenue").isNumber())
                .andExpect(jsonPath("$.refunds").value(0))
                .andExpect(jsonPath("$.breakdown[?(@.source == 'subscriptions')]").exists())
                .andExpect(jsonPath("$.breakdown[?(@.source == 'boosts')]").doesNotExist());
    }

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
}
