package com.draazy.api.admin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.PlatformTime;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import com.jayway.jsonpath.JsonPath;
import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;

/** {@code GET /admin/analytics/funnel}. Other suites leave rows behind, so every count is a delta. */
@DisplayName("/admin/analytics/funnel — weekly marketplace stages")
class AdminFunnelAnalyticsTest extends AbstractApiTest {

    private static final List<String> STAGES = List.of("posted", "approved", "contacts", "visits", "deals");

    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Funnel " + mobile);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private String adminToken;

    private String admin() {
        if (adminToken == null) adminToken = bearer(user("9877760001", Roles.Wire.ADMIN));
        return adminToken;
    }

    private String report(int days) throws Exception {
        return mvc.perform(get(Routes.Admin.ANALYTICS_FUNNEL + "?days=" + days)
                        .header(HttpHeaders.AUTHORIZATION, admin()))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    private static long count(String json, LocalDate week, String stage) {
        List<Number> hits = JsonPath.read(json, "$.weeks[?(@.week == '" + week + "')]." + stage);
        assertThat(hits).as("week %s present", week).hasSize(1);
        return hits.getFirst().longValue();
    }

    private static LocalDate weekOf(int daysAgo) {
        return LocalDate.now(PlatformTime.IST).minusDays(daysAgo).with(DayOfWeek.MONDAY);
    }

    private UUID listing(String suffix, int daysAgo, boolean archived) {
        Property p = new Property(user("98777601" + suffix, Roles.Wire.OWNER), "Funnel flat " + suffix,
                "rent", "apartment", 25_000L, "Baner", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setArea(new BigDecimal("900"));
        p.setPriceUnit("per-month");
        properties.saveAndFlush(p);
        jdbc.update("update properties set created_at = now() - make_interval(days => ?), archived = ? where id = ?",
                daysAgo, archived, p.getId());
        return p.getId();
    }

    private void decide(UUID id, String to, int daysAgo) {
        jdbc.update("""
                insert into audit_log (actor, actor_role, action, entity, entity_id, metadata, at)
                values ('funnel-fixture', 'admin', 'property.status', 'property', ?,
                        jsonb_build_object('to', ?), now() - make_interval(days => ?))
                """, id.toString(), to, daysAgo);
    }

    private void verify(UUID id, String decision, int daysAgo) {
        jdbc.update("""
                insert into audit_log (actor, actor_role, action, entity, entity_id, metadata, at)
                values ('funnel-fixture', 'admin', 'property.verification.decision', 'property', ?,
                        jsonb_build_object('decision', ?), now() - make_interval(days => ?))
                """, id.toString(), decision, daysAgo);
    }

    @Test
    void eachStageCountsItsEventInTheWeekItHappened() throws Exception {
        int postedAgo = 20, decidedAgo = 18, contactAgo = 16, visitAgo = 15, dealAgo = 14;
        String before = report(90);

        UUID live = listing("01", postedAgo, false);
        decide(live, "approved", decidedAgo);
        // A re-approval and a rejection are not new approvals.
        decide(live, "approved", decidedAgo - 1);
        UUID rejected = listing("02", postedAgo, false);
        decide(rejected, "rejected", decidedAgo);
        // Archived listings are junk, not supply.
        listing("03", postedAgo, true);
        // The console's case-file approval audits a verification decision, not a status change.
        verify(listing("04", postedAgo, false), "approve", decidedAgo);
        verify(rejected, "reject", decidedAgo);
        verify(live, "approve", decidedAgo - 2);

        UUID seeker = user("9877760010", Roles.Wire.BUYER).getId();
        jdbc.update("insert into contact_requests (property_id, requester_id, created_at) "
                + "values (?, ?, now() - make_interval(days => ?))", live, seeker, contactAgo);
        jdbc.update("insert into visits (property_id, visitor_id, slot, created_at) "
                + "values (?, ?, now(), now() - make_interval(days => ?))", live, seeker, visitAgo);
        jdbc.update("insert into deals (property_id, deal, status, closed_at) "
                + "values (?, 'rent', 'closed', now() - make_interval(days => ?))", live, dealAgo);
        // An open deal has not converted.
        jdbc.update("insert into deals (property_id, deal, status) values (?, 'rent', 'active')", rejected);

        String after = report(90);
        Map<String, LocalDate> weekFor = Map.of(
                "posted", weekOf(postedAgo), "approved", weekOf(decidedAgo),
                "contacts", weekOf(contactAgo), "visits", weekOf(visitAgo), "deals", weekOf(dealAgo));
        Map<String, Long> expected = Map.of("posted", 3L, "approved", 2L, "contacts", 1L, "visits", 1L, "deals", 1L);
        for (String stage : STAGES) {
            LocalDate week = weekFor.get(stage);
            assertThat(count(after, week, stage) - count(before, week, stage)).as(stage).isEqualTo(expected.get(stage));
        }
    }

    @Test
    void weeksAreContiguousMondaysCoveringTheWindow() throws Exception {
        String json = report(30);
        List<String> weeks = JsonPath.read(json, "$.weeks[*].week");
        assertThat((Integer) JsonPath.read(json, "$.days")).isEqualTo(30);
        assertThat(weeks).isNotEmpty();
        assertThat(LocalDate.parse(weeks.getFirst())).isEqualTo(LocalDate.parse(JsonPath.read(json, "$.from")).with(DayOfWeek.MONDAY));
        for (int i = 0; i < weeks.size(); i++) {
            LocalDate w = LocalDate.parse(weeks.get(i));
            assertThat(w.getDayOfWeek()).isEqualTo(DayOfWeek.MONDAY);
            if (i > 0) assertThat(w).isEqualTo(LocalDate.parse(weeks.get(i - 1)).plusWeeks(1));
        }
    }

    @Test
    void theWindowIsValidatedAndTheReportIsBackOfficeOnly() throws Exception {
        for (int days : new int[] {0, 366}) {
            mvc.perform(get(Routes.Admin.ANALYTICS_FUNNEL + "?days=" + days).header(HttpHeaders.AUTHORIZATION, admin()))
                    .andExpect(status().isBadRequest());
        }
        mvc.perform(get(Routes.Admin.ANALYTICS_FUNNEL)
                        .header(HttpHeaders.AUTHORIZATION, bearer(user("9877760002", Roles.Wire.BUYER))))
                .andExpect(status().isForbidden());
    }
}
