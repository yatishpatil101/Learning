package com.punenest.api.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.support.AbstractApiTest;
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

/**
 * <strong>Proof that a per-account permission document decides something, and only downwards</strong>
 * (tech debt D192/D13).
 *
 * <p>{@code V61} deleted the previous attempt at this feature rather than wiring it, for three
 * reasons, and this suite is organised around them: there was no key on the verified principal to
 * resolve a document against, there was no server-side vocabulary a stored name could mean anything
 * in, and the model composed by <em>union</em> where the platform's rule is that a stored document
 * may only narrow. Each of those is asserted here in both directions against a real route, because
 * a guard that always says yes and a guard that is absent are indistinguishable from a happy path.
 *
 * <p><strong>403 rather than 404</strong>, for the same reason {@code PermissionMapGuardTest} gives:
 * these denials happen in {@code @PreAuthorize} before any row is read, so there is no row identity
 * to leak and nothing to hide behind a not-found.
 *
 * <p>Everything runs inside the test's rolled-back transaction, so the {@code back_office_permissions}
 * rows written below are visible to {@link AccountPermissions} — it joins the same transaction — and
 * are gone afterwards. That matters more here than usual: a leaked row would silently narrow an
 * account that unrelated suites expect to be unscoped.
 */
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

    /**
     * Write the document as raw JSON, deliberately bypassing {@code BackOfficeAccessService}.
     *
     * <p>The endpoint validates every name against the catalogue, so going through it could only
     * ever produce documents the resolver already agrees with — and the interesting cases are the
     * ones an endpoint would refuse. A row written straight into the table is also the realistic
     * shape of the threat: somebody with database access, or a future writer that forgets to
     * validate.
     */
    private void scope(UUID userId, String json) {
        jdbc.update("INSERT INTO back_office_permissions (user_id, permissions) "
                + "VALUES (?::uuid, ?::jsonb)", userId.toString(), json);
    }

    private int status(String route, String bearer) throws Exception {
        return mvc.perform(get(route).header(HttpHeaders.AUTHORIZATION, bearer))
                .andReturn().getResponse().getStatus();
    }

    // ---------------------------------------------------------------------------------------
    // 1. Absence
    // ---------------------------------------------------------------------------------------

    /**
     * The state every account is in on the morning after this migration deploys, and the one that
     * must be a no-op. Without this half, every refusal below would be satisfied by a guard that
     * refused everybody — and a slice that quietly locked the back office would have shipped.
     */
    @Test
    @DisplayName("an account with no document keeps its whole role baseline")
    void noDocumentMeansTheRoleBaseline() throws Exception {
        String staff = bearer(save("9866020001", Roles.Wire.STAFF, Teams.RENTAL));
        String admin = bearer(save("9866020002", Roles.Wire.ADMIN, null));

        assertThat(status(Routes.Admin.DASHBOARD, staff)).isEqualTo(200);
        assertThat(status(Routes.Tickets.BASE, staff)).isEqualTo(200);
        assertThat(status(Routes.Moderation.REPORTS, staff)).isEqualTo(200);
        assertThat(status(Routes.Users.BASE, staff)).isEqualTo(200);
        assertThat(status(Routes.Admin.SETTINGS, admin)).isEqualTo(200);
        // Not 200, and the difference is not this slice: GET /admin/audit-log with no filters
        // answers 500 on PostgreSQL 13 — AuditLogRepository.search binds every filter as an
        // untyped parameter used only in `? is null`, and the driver cannot infer a type for the
        // timestamp ("could not determine data type of parameter $5"). No test in the codebase
        // called the route unfiltered before this one, which is why it was never seen. Out of this
        // lane to fix, so what is asserted here is the property this slice actually claims: an
        // unscoped administrator is not turned away by the new guard.
        assertThat(status(Routes.Admin.AUDIT_LOG, admin)).isNotEqualTo(403);
    }

    // ---------------------------------------------------------------------------------------
    // 2. Narrowing — the thing the feature is for
    // ---------------------------------------------------------------------------------------

    @Test
    @DisplayName("a document removes exactly what it omits, and only for the account it names")
    void aDocumentNarrowsOneAccount() throws Exception {
        User scoped = save("9866020003", Roles.Wire.STAFF, Teams.RENTAL);
        User colleague = save("9866020004", Roles.Wire.STAFF, Teams.RENTAL);
        scope(scoped.getId(), "[\"tickets:read\"]");

        assertThat(status(Routes.Tickets.BASE, bearer(scoped))).as("kept").isEqualTo(200);
        assertThat(status(Routes.Admin.DASHBOARD, bearer(scoped))).as("omitted").isEqualTo(403);
        assertThat(status(Routes.Moderation.REPORTS, bearer(scoped))).as("omitted").isEqualTo(403);
        assertThat(status(Routes.Users.BASE, bearer(scoped))).as("omitted").isEqualTo(403);
        assertThat(status(Routes.Admin.DASHBOARD, bearer(colleague)))
                .as("the colleague on the same team was not touched").isEqualTo(200);
    }

    /**
     * An empty array is a legal, deliberate state and is why a document and no document cannot be
     * the same thing. If they were, "this account may do nothing in the back office" would be
     * inexpressible.
     */
    @Test
    @DisplayName("an empty document denies every guarded back-office route")
    void anEmptyDocumentDeniesEverything() throws Exception {
        User scoped = save("9866020005", Roles.Wire.STAFF, Teams.RENTAL);
        scope(scoped.getId(), "[]");

        assertThat(status(Routes.Admin.DASHBOARD, bearer(scoped))).isEqualTo(403);
        assertThat(status(Routes.Tickets.BASE, bearer(scoped))).isEqualTo(403);
        assertThat(status(Routes.Moderation.REPORTS, bearer(scoped))).isEqualTo(403);
    }

    /** Administrators are narrowable too, or "one flat admin role" would only be half-fixed. */
    @Test
    @DisplayName("an administrator can be narrowed off the admin-only routes")
    void anAdministratorIsNarrowableToo() throws Exception {
        User scoped = save("9866020006", Roles.Wire.ADMIN, null);
        scope(scoped.getId(), "[\"dashboard:read\",\"users:read\"]");

        assertThat(status(Routes.Admin.DASHBOARD, bearer(scoped))).as("kept").isEqualTo(200);
        assertThat(status(Routes.Admin.SETTINGS, bearer(scoped))).as("omitted").isEqualTo(403);
        assertThat(status(Routes.Admin.AUDIT_LOG, bearer(scoped))).as("omitted").isEqualTo(403);
        assertThat(status(Routes.Admin.FINANCE, bearer(scoped))).as("omitted").isEqualTo(403);
    }

    // ---------------------------------------------------------------------------------------
    // 3. Direction — the load-bearing half
    // ---------------------------------------------------------------------------------------

    /**
     * <strong>The assertion this whole slice exists to make.</strong>
     *
     * <p>{@code settings.customRoles} composed {@code BASE ∪ role-bundle ∪ moduleAccess}, and
     * {@code V61} deleted it rather than honour a union: a document that can add is a second, weaker
     * access-control system reachable by whoever can write the table. Here the same document names
     * five admin-only atoms on a <em>staff</em> account, and none of them takes effect — the
     * intersection in {@link AccountPermissions#effectiveFor} drops every one, and the route's own
     * {@code hasRole('ADMIN')} would have refused it regardless.
     *
     * <p>The kept atom is not decoration: without it, this test would pass against a resolver that
     * denied everything, which is not the property being claimed.
     */
    @Test
    @DisplayName("a document cannot widen: granting a staff account admin-only atoms grants nothing")
    void aDocumentCannotWidenTheRoleBaseline() throws Exception {
        User scoped = save("9866020007", Roles.Wire.STAFF, Teams.RENTAL);
        scope(scoped.getId(), """
                ["settings:read", "settings:write", "audit:read", "finance:read", "users:write",
                 "tickets:read"]""");

        assertThat(status(Routes.Admin.SETTINGS, bearer(scoped))).isEqualTo(403);
        assertThat(status(Routes.Admin.AUDIT_LOG, bearer(scoped))).isEqualTo(403);
        assertThat(status(Routes.Admin.FINANCE, bearer(scoped))).isEqualTo(403);
        assertThat(status(Routes.Tickets.BASE, bearer(scoped)))
                .as("the document was honoured at all").isEqualTo(200);
    }

    /**
     * The same property stated against the resolver rather than a route, so that it holds for atoms
     * added later whose routes this suite does not probe.
     */
    @Test
    @DisplayName("the resolved set is always a subset of the compiled-in role baseline")
    void theResolvedSetIsAlwaysASubsetOfTheBaseline() {
        User scoped = save("9866020008", Roles.Wire.STAFF, Teams.LEGAL);
        scope(scoped.getId(), """
                ["settings:write", "audit:read", "tickets:read", "not-a-permission", "*"]""");

        Set<String> effective =
                accountPermissions.effectiveFor(Roles.Wire.STAFF, scoped.getId());

        assertThat(effective)
                .isSubsetOf(BackOfficePermissions.baselineFor(Roles.Wire.STAFF))
                .containsExactly(BackOfficePermissions.TICKETS_READ);
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

    // ---------------------------------------------------------------------------------------
    // 4. Vocabulary and fail-closed
    // ---------------------------------------------------------------------------------------

    /**
     * The direct answer to {@code V61}'s second objection. The console's own keys —
     * {@code enquiries}, {@code content}, {@code properties:verify} from {@code lib/adminModules.js}
     * — are not mapped onto anything here, so a document written in that vocabulary grants nothing
     * rather than granting whatever a later reader decides it must have meant.
     */
    @Test
    @DisplayName("names the server does not enforce grant nothing, including the console's own")
    void unknownNamesGrantNothing() throws Exception {
        User scoped = save("9866020010", Roles.Wire.STAFF, Teams.RENTAL);
        scope(scoped.getId(), """
                ["enquiries", "content", "properties:verify", "dashboard", "tickets"]""");

        assertThat(status(Routes.Admin.DASHBOARD, bearer(scoped))).isEqualTo(403);
        assertThat(status(Routes.Tickets.BASE, bearer(scoped))).isEqualTo(403);
        assertThat(status(Routes.Moderation.REPORTS, bearer(scoped))).isEqualTo(403);
        assertThat(status(Routes.Users.BASE, bearer(scoped))).isEqualTo(403);
    }

    /**
     * Fail closed on a document the resolver cannot read.
     *
     * <p>The column's CHECK constraint already rejects a non-array, so the reachable corruption is
     * an array of the wrong thing — and the answer to it is a denial for that one account rather
     * than a fallback to the baseline. That is the deliberate opposite of {@link PermissionMap},
     * whose document is platform-wide: a typo there must not take the back office down, whereas a
     * hand-edited row here can only have been hand-edited, and can only affect the account it names.
     */
    @Test
    @DisplayName("a document the resolver cannot read denies, rather than falling back")
    void anUnreadableDocumentDenies() throws Exception {
        User scoped = save("9866020011", Roles.Wire.STAFF, Teams.RENTAL);
        scope(scoped.getId(), "[1, 2, 3]");

        assertThat(status(Routes.Admin.DASHBOARD, bearer(scoped))).isEqualTo(403);
        assertThat(status(Routes.Tickets.BASE, bearer(scoped))).isEqualTo(403);
        assertThat(accountPermissions.effectiveFor(Roles.Wire.STAFF, scoped.getId())).isEmpty();
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

    // ---------------------------------------------------------------------------------------
    // 5. The catalogue holds only what is enforced
    // ---------------------------------------------------------------------------------------

    /**
     * The structural guard against this feature decaying into what {@code V61} had to delete.
     *
     * <p>{@code customRoles} became a security problem because it accumulated an access-control
     * vocabulary that nothing enforced — safe right up until somebody wired it, at which point it
     * would have started granting whatever operators had been told was meaningless. The rule that
     * prevents a repeat is "a name is added to the catalogue in the same change that annotates the
     * route it guards", and a rule nobody checks is a comment. So this sweeps the main sources for
     * each atom's {@code REQUIRE_} fragment and fails if one is declared but used nowhere.
     *
     * <p>Deliberately a text scan rather than a reflective one: the fragments are consumed inside
     * {@code @PreAuthorize} string concatenations, which leave no runtime trace to reflect over.
     */
    @Test
    @DisplayName("every catalogued permission is referenced by at least one route guard")
    void everyCataloguedPermissionGuardsARoute() {
        Path main = Path.of("src", "main", "java", "com", "punenest", "api");
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
    @DisplayName("the catalogue is well-formed: unique module:action names, read or write")
    void theCatalogueIsWellFormed() {
        for (BackOfficePermissions.Permission permission : BackOfficePermissions.CATALOGUE) {
            assertThat(permission.name())
                    .isEqualTo(permission.module() + ":" + permission.action());
            assertThat(permission.action())
                    .isIn(BackOfficePermissions.READ, BackOfficePermissions.WRITE);
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
