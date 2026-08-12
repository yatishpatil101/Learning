package com.punenest.api.security;

import com.punenest.api.support.AbstractApiTest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * <strong>Proof that {@code settings.permissions} decides something</strong> (tech debt D67).
 *
 * <p>The map was stored and round-tripped by {@code /admin/settings} for the platform's whole life
 * and read by nothing, so an administrator editing it changed no access control at all. A test that
 * only showed a permitted caller getting through would have passed identically against that
 * inert version — a guard that always says yes is indistinguishable from no guard by a happy path.
 * So every capability here is asserted in <em>both</em> directions against the same route and the
 * same principal, with the stored document as the only difference between the two calls.
 *
 * <p><strong>403 rather than 404.</strong> This codebase hides a stranger's row behind a 404 so that
 * an unauthorised caller cannot use the status code as an existence oracle, but that convention is
 * about row-level ownership: it applies where the answer depends on <em>which</em> row was asked
 * for. These denials are decided by {@code @PreAuthorize} before any row is looked up, on exactly
 * the path {@code RoleGuardSweepTest} already pins to 403 through {@link RestAccessDeniedHandler},
 * and there is no row identity to leak — the route is refused, not the record.
 *
 * <p>Everything runs inside the test's rolled-back transaction, so the writes to {@code settings}
 * below are visible to {@link PermissionMap} (it joins the same transaction) and are gone
 * afterwards. That matters: this suite mutates the platform's access-control document, and leaking
 * one of these states into the shared test database would fail unrelated suites in a way that looked
 * like their own bug.
 */
@DisplayName("D67 — the stored permission map actually governs, and only downwards")
class PermissionMapGuardTest extends AbstractApiTest {

    private static final String ANY_ID = "11111111-1111-1111-1111-111111111111";

    @Autowired
    UserRepository users;

    private String bearer(String mobile, String role, String team) {
        User user = new User(mobile, role);
        user.setName("Capability probe");
        user.setTeam(team);
        user.setMobileVerified(true);
        return "Bearer " + jwtService.issueAccessToken(users.saveAndFlush(user));
    }

    /** Replace the whole permission document. Raw SQL because the point is the stored bytes. */
    private void storePermissions(String json) {
        jdbc.update("UPDATE settings SET value = ?::jsonb WHERE key = 'permissions'", json);
    }

    private int dashboardStatus(String bearer) throws Exception {
        return mvc.perform(get(Routes.Admin.DASHBOARD).header(HttpHeaders.AUTHORIZATION, bearer))
                .andReturn().getResponse().getStatus();
    }

    private int ticketUpdateStatus(String bearer) throws Exception {
        return mvc.perform(patch(Routes.Tickets.BY_ID.replace("{id}", ANY_ID))
                        .header(HttpHeaders.AUTHORIZATION, bearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"open\"}"))
                .andReturn().getResponse().getStatus();
    }

    private int queueStatus(String bearer) throws Exception {
        return mvc.perform(get(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer))
                .andReturn().getResponse().getStatus();
    }

    /**
     * The seeded document is the current policy written down, so a desk that holds a capability
     * behaves exactly as it did before this slice. Without this half, every refusal below would be
     * satisfied by a guard that refused everyone.
     */
    @Test
    @DisplayName("a desk that holds the capability is admitted")
    void heldCapabilityAdmits() throws Exception {
        String rental = bearer("9866010001", Roles.Wire.STAFF, Teams.RENTAL);

        assertThat(dashboardStatus(rental)).isEqualTo(200);
        assertThat(queueStatus(rental)).isEqualTo(200);
        // A fictional id, so the ticket route is expected to fail on the merits. What matters is
        // that it got past the guard to be able to.
        assertThat(ticketUpdateStatus(rental)).isNotEqualTo(403);
    }

    /**
     * The seed is what makes deny-on-omission survivable, so its completeness is asserted rather
     * than assumed.
     *
     * <p>{@code R__seed_permission_map.sql} exists to guarantee that no team the platform recognises
     * is missing from the document — because a team the document does not mention is refused, and
     * the failure mode of an incomplete seed is a desk that cannot work, discovered in production by
     * the desk. A seventh team added to {@link Teams} without a bundle would leave that team locked
     * out of three routes with a green suite, which is exactly the shape of bug this codebase keeps
     * catching with sweeps rather than with per-case tests.
     */
    @Test
    @DisplayName("the seeded document names every team the platform recognises, plus admin")
    void theSeededDocumentIsComplete() {
        String stored = jdbc.queryForObject(
                "SELECT value::text FROM settings WHERE key = 'permissions'", String.class);

        assertThat(stored).as("R__seed_permission_map.sql did not run").isNotNull();
        assertThat(stored).contains(
                Teams.RENTAL, Teams.LEGAL, Teams.LOANS,
                Teams.INTERIOR, Teams.PACKERS, Teams.VALUATION, Roles.Wire.ADMIN);
    }

    /**
     * The direction the register was actually about: an administrator narrows one desk's bundle and
     * the platform obeys.
     */
    @Test
    @DisplayName("removing a capability from a desk's bundle refuses that desk, and only it")
    void revokedCapabilityRefuses() throws Exception {
        String rental = bearer("9866010002", Roles.Wire.STAFF, Teams.RENTAL);
        String legal = bearer("9866010003", Roles.Wire.STAFF, Teams.LEGAL);
        storePermissions("""
                {
                  "rental": ["view_service_requests"],
                  "legal":  ["view_dashboard", "view_service_requests", "update_ticket"],
                  "admin":  ["*"]
                }""");

        assertThat(dashboardStatus(rental)).as("rental lost view_dashboard").isEqualTo(403);
        assertThat(ticketUpdateStatus(rental)).as("rental lost update_ticket").isEqualTo(403);
        assertThat(queueStatus(rental)).as("rental kept view_service_requests").isEqualTo(200);
        assertThat(dashboardStatus(legal)).as("legal was not touched").isEqualTo(200);
    }

    /**
     * <strong>The load-bearing assertion of this whole slice.</strong>
     *
     * <p>A permission map that could hand a capability to somebody the role guard rejects would not
     * be a narrowing of access control, it would be a second, weaker access-control system reachable
     * from a web form — and an administrator whose credentials leaked could use it to promote a
     * buyer without touching the users table. Every capability check is {@code and}-ed onto its role
     * guard precisely so that this cannot happen, and this test is what stops a later "simplification"
     * from replacing the {@code and} with the capability alone.
     */
    @Test
    @DisplayName("the map cannot widen: granting a capability to a buyer changes nothing")
    void theMapCannotWidenTheRoleBaseline() throws Exception {
        String buyer = bearer("9866010004", Roles.Wire.BUYER, null);
        storePermissions("""
                {
                  "buyer":  ["view_dashboard", "update_ticket", "*"],
                  "rental": ["view_dashboard", "view_service_requests", "update_ticket"],
                  "admin":  ["*"]
                }""");

        assertThat(dashboardStatus(buyer)).isEqualTo(403);
        assertThat(ticketUpdateStatus(buyer)).isEqualTo(403);
    }

    /** The wildcard bundle is honoured, which is how administrators stay unrestricted. */
    @Test
    @DisplayName("the admin bundle's wildcard grants every capability")
    void wildcardGrantsEverything() throws Exception {
        String admin = bearer("9866010005", Roles.Wire.ADMIN, null);
        storePermissions("{\"admin\":[\"*\"]}");

        assertThat(dashboardStatus(admin)).isEqualTo(200);
        assertThat(queueStatus(admin)).isEqualTo(200);
        assertThat(ticketUpdateStatus(admin)).isNotEqualTo(403);
    }

    /**
     * Deny-on-omission, which is the property that makes this an allow-list rather than a
     * suggestion. If an absent key meant "allow", an administrator could never remove access by
     * editing the document — which is the bug D67 was raised about, one level down.
     */
    @Test
    @DisplayName("a desk the document does not mention is refused")
    void omittedDeskIsRefused() throws Exception {
        String packers = bearer("9866010006", Roles.Wire.STAFF, Teams.PACKERS);
        storePermissions("{\"rental\":[\"view_dashboard\"],\"admin\":[\"*\"]}");

        assertThat(dashboardStatus(packers)).isEqualTo(403);
        assertThat(queueStatus(packers)).isEqualTo(403);
    }

    /**
     * The first of the three fail-safe cases: no document at all means the platform is in the state
     * it shipped in, and the four-role baseline is the whole policy. Denying here would mean a
     * missing settings row could take the entire back office offline.
     */
    @Test
    @DisplayName("no permission document falls back to the role baseline, not to a lockout")
    void absentDocumentFallsBackToTheRoleBaseline() throws Exception {
        String packers = bearer("9866010007", Roles.Wire.STAFF, Teams.PACKERS);
        jdbc.update("DELETE FROM settings WHERE key = 'permissions'");

        assertThat(dashboardStatus(packers)).isEqualTo(200);
        assertThat(queueStatus(packers)).isEqualTo(200);
    }

    /**
     * The second: {@code permissions} is {@code additionalProperties: true} in the contract, so the
     * settings endpoint will happily store a string there. A document whose shape cannot be an
     * allow-list is a broken one, not a restrictive one.
     */
    @Test
    @DisplayName("a permission document that is not an object falls back to the role baseline")
    void malformedDocumentFallsBackToTheRoleBaseline() throws Exception {
        String packers = bearer("9866010008", Roles.Wire.STAFF, Teams.PACKERS);
        storePermissions("\"not a permission map\"");

        assertThat(dashboardStatus(packers)).isEqualTo(200);
    }

    /**
     * The third: {@code users.team} is nullable (V2), so a team-less staff account is legal — but
     * the two surfaces answer it differently, and deliberately.
     *
     * <p>The dashboard is capability-gated and has no desk in its key space, so an absent team is
     * simply a key the document does not address and the role baseline stands: 200.
     *
     * <p>The ops queue is not, since D44 scoped it by desk. There {@code null} is not "no opinion",
     * it is the query's own word for <em>every</em> desk — so admitting a deskless caller on the
     * baseline would hand them all five desks' work, strictly more than any desked colleague can
     * see. Falling back would therefore make the absence of a team a privilege rather than a gap in
     * the record, so the queue refuses (403) and says which fact is missing. Granting per-account
     * scope remains D13's slice; this only settles what happens meanwhile.
     */
    @Test
    @DisplayName("staff with no team keep the baseline where it is safe, and are refused the desk-scoped queue")
    void teamlessStaffKeepTheRoleBaseline() throws Exception {
        String unassigned = bearer("9866010009", Roles.Wire.STAFF, null);
        storePermissions("{\"rental\":[\"view_dashboard\"],\"admin\":[\"*\"]}");

        assertThat(dashboardStatus(unassigned)).isEqualTo(200);
        assertThat(queueStatus(unassigned))
                .as("a deskless caller must not out-rank a desked one by seeing every desk")
                .isEqualTo(403);
    }

    /**
     * {@code GET /service-requests} is one route serving two audiences, and only the ops branch is
     * capability-guarded. A customer's own list must be reachable whatever the document says —
     * otherwise an administrator narrowing an ops bundle would silently break the customer-facing
     * screen that shares the route.
     */
    @Test
    @DisplayName("a customer's own service-request list is untouched by the permission map")
    void customersAreUnaffectedByTheOpsCapability() throws Exception {
        String buyer = bearer("9866010010", Roles.Wire.BUYER, null);
        storePermissions("{\"admin\":[\"*\"]}");

        assertThat(queueStatus(buyer)).isEqualTo(200);
    }
}
