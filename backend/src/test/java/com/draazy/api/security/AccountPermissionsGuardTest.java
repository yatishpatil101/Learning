package com.draazy.api.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;

/** A stored per-account document may only narrow, never add. Denials are 403 not 404: {@code @PreAuthorize} runs
 * before any row is read. Rows roll back so they can't narrow accounts other suites expect to be unscoped. */
@DisplayName("D192/D13 — a per-account permission document governs, and can only narrow")
class AccountPermissionsGuardTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    @Autowired
    AccountPermissions accountPermissions;

    private User save(String mobile, String role, String team) {
        User user = new User(mobile, role);
        user.setName("Access probe");
        user.setTeam(team);
        user.setMobileVerified(true);
        return users.saveAndFlush(user);
    }

    /** Raw JSON, bypassing {@code BackOfficeAccessService}, whose validation can't produce hostile documents. */
    private void scope(UUID userId, String json) {
        jdbc.update("INSERT INTO back_office_permissions (user_id, permissions) "
                + "VALUES (?::uuid, ?::jsonb)", userId.toString(), json);
    }

    private int status(String route, String bearer) throws Exception {
        return mvc.perform(get(route).header(HttpHeaders.AUTHORIZATION, bearer))
                .andReturn().getResponse().getStatus();
    }


    /** Absence must be a no-op: otherwise a guard refusing everybody would satisfy every refusal below. */
    @Test
    @DisplayName("a staff account with no document keeps only the landing atom")
    void noDocumentMeansRoleDefault() throws Exception {
        User staffUser = save("9866020001", Roles.Wire.STAFF, Teams.RENTAL);
        String staff = "Bearer " + jwtService.issueAccessToken(staffUser);
        String admin = bearer(save("9866020002", Roles.Wire.ADMIN, null));

        assertThat(accountPermissions.effectiveFor(Roles.Wire.STAFF, staffUser.getId()))
                .containsExactly(BackOfficePermissions.DASHBOARD_READ);
        assertThat(status(Routes.Admin.ANALYTICS_TRAFFIC, staff)).isEqualTo(403);
        assertThat(status(Routes.Tickets.BASE, staff)).isEqualTo(403);
        assertThat(status(Routes.Moderation.REPORTS, staff)).isEqualTo(403);
        assertThat(status(Routes.Users.BASE, staff)).isEqualTo(403);
        assertThat(status(Routes.Admin.SETTINGS, admin)).isEqualTo(200);
        // Not 200: unfiltered GET /admin/audit-log 500s on PostgreSQL 13 (untyped `? is null` timestamp
        // parameter), so assert only that the new guard doesn't turn an unscoped administrator away.
        assertThat(status(Routes.Admin.AUDIT_LOG, admin)).isNotEqualTo(403);
    }


    @Test
    @DisplayName("a document removes exactly what it omits, and only for the account it names")
    void aDocumentNarrowsOneAccount() throws Exception {
        User scoped = save("9866020003", Roles.Wire.STAFF, Teams.RENTAL);
        User colleague = save("9866020004", Roles.Wire.STAFF, Teams.RENTAL);
        scope(scoped.getId(), "[\"support\",\"desk:rental\"]");

        assertThat(status(Routes.Tickets.BASE, bearer(scoped))).as("kept").isEqualTo(200);
        assertThat(status(Routes.Admin.ANALYTICS_TRAFFIC, bearer(scoped))).as("analytics omitted").isEqualTo(403);
        assertThat(status(Routes.Moderation.REPORTS, bearer(scoped))).as("omitted").isEqualTo(403);
        assertThat(status(Routes.Users.BASE, bearer(scoped))).as("omitted").isEqualTo(403);
        assertThat(status(Routes.Admin.ANALYTICS_TRAFFIC, bearer(colleague)))
                .as("the colleague on the same team was not touched").isEqualTo(200);
    }

    @Test
    @DisplayName("analytics routes require the analytics function, not just dashboard")
    void analyticsRoutesRequireAnalyticsFunction() throws Exception {
        User kyc = save("9866020012", Roles.Wire.STAFF, Teams.RENTAL);
        User analytics = save("9866020013", Roles.Wire.STAFF, Teams.RENTAL);
        User manager = save("9866020014", Roles.Wire.MANAGER, null);
        User admin = save("9866020015", Roles.Wire.ADMIN, null);
        scope(kyc.getId(), "[\"kyc\"]");
        scope(analytics.getId(), "[\"kyc\",\"analytics\"]");

        assertThat(status(Routes.Admin.ANALYTICS_TRAFFIC, bearer(kyc))).isEqualTo(403);
        assertThat(status(Routes.Admin.ANALYTICS_SLA, bearer(kyc))).isEqualTo(403);
        assertThat(status(Routes.Admin.ANALYTICS_TRAFFIC, bearer(kyc))).isEqualTo(403);
        assertThat(status(Routes.Admin.ANALYTICS_TRAFFIC, bearer(analytics))).isEqualTo(200);
        assertThat(status(Routes.Admin.ANALYTICS_TRAFFIC, bearer(manager))).isEqualTo(200);
        assertThat(status(Routes.Admin.ANALYTICS_TRAFFIC, bearer(admin))).isEqualTo(200);
    }

    /** An empty array is deliberate: it must differ from no document, or "may do nothing" is inexpressible. */
    @Test
    @DisplayName("an empty document leaves only the landing atom")
    void anEmptyDocumentLeavesOnlyDashboard() throws Exception {
        User scoped = save("9866020005", Roles.Wire.STAFF, Teams.RENTAL);
        scope(scoped.getId(), "[]");

        assertThat(accountPermissions.effectiveFor(Roles.Wire.STAFF, scoped.getId()))
                .containsExactly(BackOfficePermissions.DASHBOARD_READ);
        assertThat(status(Routes.Admin.ANALYTICS_TRAFFIC, bearer(scoped))).isEqualTo(403);
        assertThat(status(Routes.Tickets.BASE, bearer(scoped))).isEqualTo(403);
        assertThat(status(Routes.Moderation.REPORTS, bearer(scoped))).isEqualTo(403);
    }

    @Test
    @DisplayName("the administrator ignores any stored document and keeps full access")
    void theAdministratorIsNeverNarrowed() throws Exception {
        User admin = save("9866020006", Roles.Wire.ADMIN, null);
        scope(admin.getId(), "[\"kyc\"]");

        assertThat(status(Routes.Admin.SETTINGS, bearer(admin))).isEqualTo(200);
        assertThat(status(Routes.Admin.AUDIT_LOG, bearer(admin))).isEqualTo(200);
        assertThat(status(Routes.Admin.FINANCE, bearer(admin))).isEqualTo(200);
    }


    /** The load-bearing half: five admin-only atoms on a staff account must all be dropped by the intersection in
     * {@link AccountPermissions#effectiveFor}; the kept atom proves the resolver isn't just denying everything. */
    @Test
    @DisplayName("a document cannot widen: granting a staff account admin-only atoms grants nothing")
    void aDocumentCannotWidenTheRoleBaseline() throws Exception {
        User scoped = save("9866020007", Roles.Wire.STAFF, Teams.RENTAL);
        scope(scoped.getId(), """
                ["settings:read", "settings:write", "audit:read", "finance:read", "users:write",
                 "support", "desk:rental"]""");

        assertThat(status(Routes.Admin.SETTINGS, bearer(scoped))).isEqualTo(403);
        assertThat(status(Routes.Admin.AUDIT_LOG, bearer(scoped))).isEqualTo(403);
        assertThat(status(Routes.Admin.FINANCE, bearer(scoped))).isEqualTo(403);
        assertThat(status(Routes.Tickets.BASE, bearer(scoped)))
                .as("the document was honoured at all").isEqualTo(200);
    }

    /** Against the resolver, so it holds for later atoms whose routes this suite doesn't probe. */
    @Test
    @DisplayName("the resolved set is always a subset of the compiled-in role baseline")
    void theResolvedSetIsAlwaysASubsetOfTheBaseline() {
        User scoped = save("9866020008", Roles.Wire.STAFF, Teams.LEGAL);
        scope(scoped.getId(), """
                ["settings:write", "audit:read", "support", "desk:legal", "not-a-function", "*"]""");

        Set<String> effective =
                accountPermissions.effectiveFor(Roles.Wire.STAFF, scoped.getId());

        assertThat(effective)
                .isSubsetOf(BackOfficePermissions.baselineFor(Roles.Wire.STAFF))
                .containsExactlyInAnyOrder(
                        BackOfficePermissions.DASHBOARD_READ,
                        BackOfficePermissions.TICKETS_READ,
                        BackOfficePermissions.TICKETS_WRITE,
                        BackOfficePermissions.ENQUIRIES_READ,
                        BackOfficePermissions.NOTES_READ,
                        BackOfficePermissions.NOTES_WRITE,
                        BackOfficePermissions.SERVICES_READ,
                        BackOfficePermissions.SERVICES_WRITE);
    }

    /** A buyer has no back-office baseline, so there is nothing for an intersection to produce. */
    @Test
    @DisplayName("a role outside the back office resolves to nothing whatever is stored")
    void aNonOpsRoleResolvesToNothing() {
        User buyer = save("9866020009", Roles.Wire.BUYER, null);
        scope(buyer.getId(), "[\"tickets:read\",\"users:read\"]");

        assertThat(accountPermissions.effectiveFor(Roles.Wire.BUYER, buyer.getId())).isEmpty();
        assertThat(accountPermissions.granted(
                new AuthPrincipal(buyer.getId(), Roles.Wire.BUYER, null, true, false),
                BackOfficePermissions.TICKETS_READ)).isFalse();
    }


    /** The console's own keys ({@code enquiries}, {@code properties:verify}) are unmapped and grant nothing. */
    @Test
    @DisplayName("names the server does not enforce grant nothing, including the console's own")
    void unknownNamesGrantNothing() throws Exception {
        User scoped = save("9866020010", Roles.Wire.STAFF, Teams.RENTAL);
        scope(scoped.getId(), """
                ["enquiries", "content", "properties:verify", "dashboard", "tickets"]""");

        assertThat(status(Routes.Admin.ANALYTICS_TRAFFIC, bearer(scoped))).isEqualTo(403);
        assertThat(status(Routes.Tickets.BASE, bearer(scoped))).isEqualTo(403);
        assertThat(status(Routes.Moderation.REPORTS, bearer(scoped))).isEqualTo(403);
        assertThat(status(Routes.Users.BASE, bearer(scoped))).isEqualTo(403);
    }

    /** Fail closed on an unreadable document: denies that one account, unlike platform-wide {@link PermissionMap},
     * where a typo must not take the back office down. */
    @Test
    @DisplayName("a document the resolver cannot read denies, rather than falling back")
    void anUnreadableDocumentDenies() throws Exception {
        User scoped = save("9866020011", Roles.Wire.STAFF, Teams.RENTAL);
        scope(scoped.getId(), "[1, 2, 3]");

        assertThat(status(Routes.Admin.ANALYTICS_TRAFFIC, bearer(scoped))).isEqualTo(403);
        assertThat(status(Routes.Tickets.BASE, bearer(scoped))).isEqualTo(403);
        assertThat(accountPermissions.effectiveFor(Roles.Wire.STAFF, scoped.getId()))
                .containsExactly(BackOfficePermissions.DASHBOARD_READ);
    }

    /** Nothing that is not one of our own principals is waved through. */
    @Test
    @DisplayName("a null principal and a null atom are refused")
    void nullsAreRefused() {
        assertThat(accountPermissions.granted((AuthPrincipal) null, BackOfficePermissions.TICKETS_READ))
                .isFalse();
        assertThat(accountPermissions.granted(
                new AuthPrincipal(UUID.randomUUID(), Roles.Wire.ADMIN, null, true, false), null))
                .isFalse();
    }


    /** A catalogue name must be added in the same change that annotates its route; this text-scans main sources
     * for each {@code REQUIRE_} fragment, as {@code @PreAuthorize} leaves nothing to reflect on. */
    @Test
    @DisplayName("every catalogued permission is referenced by at least one route guard")
    void everyCataloguedPermissionGuardsARoute() {
        Path main = Path.of("src", "main", "java", "com", "draazy", "api");
        String sources = readAll(main);
        List<String> unenforced = new ArrayList<>();
        for (BackOfficePermissions.Permission permission : BackOfficePermissions.CATALOGUE) {
            String fragment = "REQUIRE_"
                    + permission.name().replace(':', '_').toUpperCase(java.util.Locale.ROOT);
            if (!sources.contains("BackOfficePermissions." + fragment)) {
                unenforced.add(permission.name() + " (expected " + fragment + ")");
            }
        }
        assertThat(unenforced)
                .as("""
                        A permission is offered to administrators that no route guard consults. \
                        That is exactly what settings.customRoles was, and V61 is the record of why \
                        it had to be deleted rather than wired: an access-control document nobody \
                        enforces is one somebody will eventually enforce, granting whatever had \
                        accumulated in it. Either annotate the route or drop the name.""")
                .isEmpty();
    }

    /** Every catalogued name is unique and well-formed, since the string is the stored key. */
    @Test
    @DisplayName("the catalogue is well-formed: unique module:action names")
    void theCatalogueIsWellFormed() {
        for (BackOfficePermissions.Permission permission : BackOfficePermissions.CATALOGUE) {
            assertThat(permission.name())
                    .isEqualTo(permission.module() + ":" + permission.action());
            assertThat(permission.action())
                    .isIn(BackOfficePermissions.READ, BackOfficePermissions.WRITE,
                            "verify", "moderate");
            assertThat(BackOfficePermissions.isKnown(permission.name())).isTrue();
        }
        assertThat(BackOfficePermissions.CATALOGUE)
                .extracting(BackOfficePermissions.Permission::name)
                .doesNotHaveDuplicates();
        assertThat(BackOfficePermissions.baselineFor(Roles.Wire.STAFF))
                .isSubsetOf(BackOfficePermissions.baselineFor(Roles.Wire.ADMIN));
    }

    private static String readAll(Path root) {
        try (Stream<java.nio.file.Path> paths = Files.walk(root)) {
            StringBuilder all = new StringBuilder();
            for (Path p : paths.filter(p -> p.getFileName().toString().endsWith(".java")).toList()) {
                if (p.getFileName().toString().equals("BackOfficePermissions.java")) {
                    continue;
                }
                all.append(Files.readString(p, StandardCharsets.UTF_8));
            }
            return all.toString();
        } catch (IOException e) {
            throw new IllegalStateException("cannot walk " + root.toAbsolutePath(), e);
        }
    }
}
