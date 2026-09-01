package com.punenest.api.moderation;

import com.punenest.api.support.AbstractApiTest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * <strong>The load-bearing test of slice 9.</strong>
 *
 * <p>Every back-office route in the contract had been reachable by any signed-in user, because no
 * operation carried {@code x-roles} and no controller carried a guard. That is not a bug in one
 * endpoint — it is a bug in the <em>absence</em> of guards, and absence is exactly what a
 * per-endpoint happy-path test cannot see. A test that checks "an admin can archive a user" passes
 * identically whether or not a buyer can archive a user too.
 *
 * <p>So this test is written the other way round: it enumerates the guarded surface as data and
 * asserts an ordinary user is refused on <em>all</em> of it. Every case is expressed through a
 * {@link Routes} constant, so the constant the controller maps is the one under test, and a typo
 * cannot make a case silently pass against a route that does not exist — a 404 would fail the
 * assertion rather than satisfy it.
 *
 * <p>A 403 is asserted rather than "not 2xx": 401 would mean the token was rejected and 404 would
 * mean the row was hidden, and both would pass a laxer assertion while proving nothing about the
 * role guard. The ids used below are fictional, which is the point — authorization is decided before
 * the row is looked up, so a guarded route must answer 403 even for a nonexistent id. One that
 * answered 404 would be leaking existence to unauthorized callers.
 */
@DisplayName("Moderation — the trust boundary holds against an ordinary user")
class RoleGuardSweepTest extends AbstractApiTest {

    private static final String ANY_ID = "11111111-1111-1111-1111-111111111111";

    @Autowired
    UserRepository users;

    /** A guarded route and the role it actually requires. */
    record Guarded(HttpMethod method, String path, String needs) {
        @Override
        public String toString() {
            return method + " " + path + " (needs " + needs + ")";
        }
    }

    private static String id(String template) {
        return template.replace("{id}", ANY_ID);
    }

    /**
     * The complete set of role-guarded routes this slice ships, mirroring the {@code x-roles} added
     * to the contract by spec fix S28.
     */
    static List<Guarded> guardedRoutes() {
        return List.of(
                // Property moderation — staff/admin.
                new Guarded(HttpMethod.PATCH, id(Routes.Moderation.PROPERTY_STATUS), "staff"),
                new Guarded(HttpMethod.POST, id(Routes.Moderation.PROPERTY_FEATURED), "staff"),
                new Guarded(HttpMethod.POST, id(Routes.Moderation.PROPERTY_FLAG), "staff"),
                new Guarded(HttpMethod.DELETE, id(Routes.Moderation.PROPERTY_FLAG), "staff"),
                new Guarded(HttpMethod.POST, id(Routes.Moderation.VERIFICATION_DECISION), "staff"),
                new Guarded(HttpMethod.PATCH, id(Routes.Moderation.VERIFICATION_CHECKLIST), "staff"),
                // Abuse queue. POST /reports is deliberately absent: anyone signed in may file.
                new Guarded(HttpMethod.GET, Routes.Moderation.REPORTS, "staff"),
                new Guarded(HttpMethod.PATCH, id(Routes.Moderation.REPORT_BY_ID), "staff"),
                // Review takedown.
                new Guarded(HttpMethod.PATCH, id(Routes.Moderation.REVIEW_STATUS), "staff"),
                // Reading people.
                new Guarded(HttpMethod.GET, Routes.Users.BASE, "staff"),
                new Guarded(HttpMethod.GET, id(Routes.Users.BY_ID), "staff"),
                // Changing people, and changing who holds power — admin only.
                new Guarded(HttpMethod.PATCH, id(Routes.Users.BY_ID), "admin"),
                new Guarded(HttpMethod.PATCH, id(Routes.Users.ARCHIVE), "admin"),
                new Guarded(HttpMethod.PATCH, id(Routes.Users.RESTORE), "admin"),
                new Guarded(HttpMethod.POST, Routes.Users.STAFF, "admin"),
                // Maker-checker on that same surface (D200). Both admin-only: seeing who is waiting
                // for a second key, and turning it, are the same audience as minting the account.
                new Guarded(HttpMethod.GET, Routes.Users.PENDING_APPROVALS, "admin"),
                new Guarded(HttpMethod.POST, id(Routes.Users.APPROVE), "admin"),
                new Guarded(HttpMethod.GET, Routes.Admin.AUDIT_LOG, "admin"));
    }

    static List<Guarded> adminOnlyRoutes() {
        return guardedRoutes().stream().filter(route -> "admin".equals(route.needs())).toList();
    }

    static List<Guarded> staffAllowedRoutes() {
        return guardedRoutes().stream().filter(route -> "staff".equals(route.needs())).toList();
    }

    @ParameterizedTest(name = "buyer refused: {0}")
    @MethodSource("guardedRoutes")
    @DisplayName("an ordinary signed-in user is refused on every guarded back-office route")
    void buyerIsForbidden(Guarded route) throws Exception {
        int status = mvc.perform(request(route, token("buyer", "9000000001")))
                .andReturn().getResponse().getStatus();
        assertThat(status).as("%s must refuse a buyer with 403", route).isEqualTo(403);
    }

    /**
     * The privilege-escalation guard.
     *
     * <p>If staff could reach {@code POST /users/staff}, any staff account would be one request away
     * from minting itself an admin colleague — which would make the staff/admin distinction, and so
     * every admin-only guard in the codebase, decorative. The audit log is included for the
     * mirror-image reason: a staff member who can read the record of their own actions can check
     * whether anyone noticed.
     */
    @ParameterizedTest(name = "staff refused: {0}")
    @MethodSource("adminOnlyRoutes")
    @DisplayName("staff cannot escalate privilege or read the record of admin action")
    void staffIsForbiddenOnAdminOnlyRoutes(Guarded route) throws Exception {
        int status = mvc.perform(request(route, token("staff", "9000000002")))
                .andReturn().getResponse().getStatus();
        assertThat(status).as("%s must refuse staff with 403", route).isEqualTo(403);
    }

    /**
     * The other half of the proof. Without it, every assertion above would still pass if the routes
     * simply did not exist — the sweep would be measuring nothing. A staff token must get
     * <em>past</em> the guard on a staff route and then fail on the merits (404, the id is fictional).
     */
    @ParameterizedTest(name = "staff admitted: {0}")
    @MethodSource("staffAllowedRoutes")
    @DisplayName("the guard admits the right role — the sweep is not passing vacuously")
    void staffPassesTheGuard(Guarded route) throws Exception {
        int status = mvc.perform(request(route, token("staff", "9000000003")))
                .andReturn().getResponse().getStatus();
        assertThat(status).as("%s must let staff past the role guard", route).isNotEqualTo(403);
    }

    private String token(String role, String mobile) {
        User user = new User(mobile, role);
        user.setName("Guard probe " + role);
        user.setMobileVerified(true);
        return "Bearer " + jwtService.issueAccessToken(users.saveAndFlush(user));
    }

    private MockHttpServletRequestBuilder request(Guarded route, String bearer) {
        MockHttpServletRequestBuilder builder = switch (route.method().name()) {
            case "GET" -> get(route.path());
            case "POST" -> post(route.path());
            case "PATCH" -> patch(route.path());
            case "DELETE" -> delete(route.path());
            default -> throw new IllegalArgumentException("unsupported: " + route.method());
        };
        builder.header(HttpHeaders.AUTHORIZATION, bearer);
        if (route.method() != HttpMethod.GET && route.method() != HttpMethod.DELETE) {
            builder.contentType(MediaType.APPLICATION_JSON).content(bodyFor(route.path()));
        }
        return builder;
    }

    /**
     * Valid bodies for the write routes, and they have to be genuinely valid.
     *
     * <p>This comment used to claim {@code @PreAuthorize} runs before argument resolution, so the
     * body did not matter for the refusal case. It does not: {@code @PreAuthorize} is a method
     * interceptor on the controller bean, and Spring MVC binds and validates the body <em>before</em>
     * it invokes that method. D218's checklist route proved it by answering <strong>422</strong> to
     * a buyer — the fallback body below failed {@code @NotBlank} and the request never reached the
     * guard. Every other case here passes only because its fallback body happens to satisfy the
     * handler's constraints, so a new guarded route with a required field needs an entry here or it
     * will fail this sweep while being perfectly well guarded.
     */
    private static String bodyFor(String path) {
        if (path.contains("/reviews/")) {
            return "{\"status\":\"rejected\"}";
        }
        if (path.endsWith("/status")) {
            return "{\"status\":\"approved\"}";
        }
        if (path.endsWith("/decision")) {
            return "{\"decision\":\"approve\"}";
        }
        if (path.endsWith("/checklist")) {
            return "{\"item\":\"Index II\",\"pass\":true}";
        }
        if (path.equals(Routes.Users.STAFF)) {
            return "{\"name\":\"Probe\",\"mobile\":\"9123456780\","
                    + "\"email\":\"probe@example.com\",\"role\":\"staff\"}";
        }
        if (path.startsWith("/reports/")) {
            return "{\"status\":\"reviewing\"}";
        }
        return "{\"reason\":\"probe\"}";
    }
}
