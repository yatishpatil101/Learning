package com.draazy.api.moderation;

import com.draazy.api.support.AbstractApiTest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

// Enumerates the guarded back-office surface and asserts 403 for a buyer — catches missing
// guards that per-endpoint happy-path tests cannot see. Fictional ids by design: auth precedes lookup.
@DisplayName("Moderation — the trust boundary holds against an ordinary user")
class RoleGuardSweepTest extends AbstractApiTest {

    private static final String ANY_ID = "11111111-1111-1111-1111-111111111111";

    @Autowired
    UserRepository users;

    record Guarded(HttpMethod method, String path, String needs) {
        @Override
        public String toString() {
            return method + " " + path + " (needs " + needs + ")";
        }
    }

    private static String id(String template) {
        return template.replace("{id}", ANY_ID);
    }

    private static String notesFor(String entityType) {
        return Routes.Moderation.NOTES_FOR_ENTITY
                .replace("{entityType}", entityType)
                .replace("{entityId}", ANY_ID);
    }

    static List<Guarded> guardedRoutes() {
        return List.of(
                new Guarded(HttpMethod.PATCH, id(Routes.Moderation.PROPERTY_STATUS), "staff"),
                new Guarded(HttpMethod.POST, id(Routes.Moderation.PROPERTY_FEATURED), "staff"),
                new Guarded(HttpMethod.POST, id(Routes.Moderation.PROPERTY_FLAG), "staff"),
                new Guarded(HttpMethod.DELETE, id(Routes.Moderation.PROPERTY_FLAG), "staff"),
                new Guarded(HttpMethod.POST, id(Routes.Moderation.VERIFICATION_DECISION), "staff"),
                new Guarded(HttpMethod.PATCH, id(Routes.Moderation.VERIFICATION_CHECKLIST), "staff"),
                // POST /reports absent by design: anyone signed in may file an abuse report.
                new Guarded(HttpMethod.GET, Routes.Moderation.REPORTS, "staff"),
                new Guarded(HttpMethod.PATCH, id(Routes.Moderation.REPORT_BY_ID), "staff"),
                new Guarded(HttpMethod.PATCH, id(Routes.Moderation.REVIEW_STATUS), "staff"),
                new Guarded(HttpMethod.GET, notesFor("property"), "staff"),
                new Guarded(HttpMethod.POST, notesFor("property"), "staff"),
                new Guarded(HttpMethod.PATCH, id(Routes.Moderation.NOTE_BY_ID), "staff"),
                new Guarded(HttpMethod.GET, Routes.LocalityQueue.BASE, "staff"),
                new Guarded(HttpMethod.PATCH,
                        Routes.LocalityQueue.BY_PROPERTY.replace("{propertyId}", ANY_ID), "staff"),
                new Guarded(HttpMethod.GET, Routes.Users.BASE, "staff"),
                new Guarded(HttpMethod.GET, id(Routes.Users.BY_ID), "staff"),
                new Guarded(HttpMethod.PATCH, id(Routes.Users.BY_ID), "admin"),
                new Guarded(HttpMethod.PATCH, id(Routes.Users.ARCHIVE), "admin"),
                new Guarded(HttpMethod.PATCH, id(Routes.Users.RESTORE), "admin"),
                new Guarded(HttpMethod.POST, Routes.Users.STAFF, "admin"),
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

    // Privilege-escalation guard: staff must not mint admins or read the audit log.
    @ParameterizedTest(name = "staff refused: {0}")
    @MethodSource("adminOnlyRoutes")
    @DisplayName("staff cannot escalate privilege or read the record of admin action")
    void staffIsForbiddenOnAdminOnlyRoutes(Guarded route) throws Exception {
        int status = mvc.perform(request(route, token("staff", "9000000002")))
                .andReturn().getResponse().getStatus();
        assertThat(status).as("%s must refuse staff with 403", route).isEqualTo(403);
    }

    // Non-vacuity check: staff must get past the guard (fails on merits, not 403) or the sweep proves nothing.
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

    // Bodies must satisfy @NotBlank/validation: Spring binds and validates before @PreAuthorize runs,
    // so a required-field route with a stub body 422s instead of 403 and fails the sweep.
    private static String bodyFor(String path) {
        if (path.startsWith(Routes.LocalityQueue.BASE)) {
            return "{\"slug\":\"baner\"}";
        }
        // Match /admin/notes before /reviews/: notes on a review live at /admin/notes/review/{id}.
        if (path.startsWith("/admin/notes")) {
            return "{\"text\":\"Guard probe\"}";
        }
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
                    + "\"email\":\"probe@example.com\",\"role\":\"staff\",\"team\":\"rental\"}";
        }
        if (path.startsWith("/reports/")) {
            return "{\"status\":\"reviewing\"}";
        }
        return "{\"reason\":\"probe\"}";
    }
}
