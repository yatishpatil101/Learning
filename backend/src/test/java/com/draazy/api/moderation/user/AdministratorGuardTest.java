package com.draazy.api.moderation.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.draazy.api.common.access.BackOfficeGrant;
import com.draazy.api.common.access.BackOfficeGrantRepository;
import com.draazy.api.common.access.StaffAccountApproval;
import com.draazy.api.common.access.StaffAccountApprovalRepository;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * D200, half 1 — no operation may leave the platform with nobody able to hand back-office access
 * back.
 *
 * <h2>How the lockout is reachable at all</h2>
 *
 * <p>It looks at first as though it cannot be: the caller of every guarded route holds
 * {@code users:write} by definition, self-archive is already 403, and self-narrowing is already 403,
 * so the actor always survives their own request. What breaks that reasoning is that
 * <strong>{@code JwtAuthFilter} is stateless</strong>. Archiving somebody does not revoke the token
 * they are already holding (the same asymmetry D201 records for role changes), so an administrator
 * who has just been archived keeps acting for the remainder of their token's life — and the account
 * they act against is the only one left. Two administrators, two requests, no race required, and
 * afterwards nobody can sign into the back office again.
 *
 * <p>That is the sequence both HTTP tests below walk, once for archive and once for narrowing, each
 * with a positive control so the guard cannot pass by refusing everything.
 */
@DisplayName("D200 — the last-administrator floor")
class AdministratorGuardTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    @Autowired
    BackOfficeGrantRepository grants;

    @Autowired
    StaffAccountApprovalRepository approvals;

    @Autowired
    AdministratorGuard guard;

    /**
     * Every test here is a claim about how many administrators the platform has, so none of them may
     * depend on what happens to be in the database. Demoting rather than deleting keeps every
     * foreign key intact, and the class-level rollback undoes it.
     */
    @BeforeEach
    void leaveNoOtherAdministrators() {
        jdbc.update("UPDATE users SET role = 'buyer' WHERE role = 'admin'");
    }

    private User admin(String mobile) {
        User user = new User(mobile, Roles.Wire.ADMIN);
        user.setName("Floor probe " + mobile);
        user.setMobileVerified(true);
        return users.saveAndFlush(user);
    }

    private int archive(User actor, User target) throws Exception {
        return mvc.perform(patch(Routes.Users.ARCHIVE.replace("{id}", target.getId().toString()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"floor probe\"}"))
                .andReturn().getResponse().getStatus();
    }

    private int narrow(User actor, User target, String permissions) throws Exception {
        return mvc.perform(put(Routes.Users.PERMISSIONS.replace("{id}", target.getId().toString()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"permissions\":%s}".formatted(permissions)))
                .andReturn().getResponse().getStatus();
    }

    @AfterEach
    void clearCommittedAuditRows() {
        jdbc.update("DELETE FROM audit_log WHERE action IN "
                + "('user.archive', 'user.permissions.replace')");
    }

    /**
     * The archive half. The first archive is allowed — one administrator remains, which is the
     * property the floor protects, not a count of two. The second is refused.
     */
    @Test
    @DisplayName("an archived admin cannot use their surviving token to archive the last one")
    void archivingTheLastAdministratorIsRefused() throws Exception {
        User first = admin("9866050001");
        User second = admin("9866050002");

        assertThat(archive(first, second))
                .as("archiving a peer is fine while somebody is left")
                .isEqualTo(200);
        assertThat(archive(second, first))
                .as("the archived account's token still works; the floor is what stops it")
                .isEqualTo(409);

        assertThat(users.findById(first.getId()).orElseThrow().isArchived())
                .as("the refusal changed nothing")
                .isFalse();
    }

    /**
     * The narrowing half — the quieter lockout. Unlike an archive it leaves an account that still
     * reads {@code admin} on every screen and can no longer hand access back to anybody, including
     * itself: {@code BackOfficeAccessService} refuses a self-edit.
     */
    @Test
    @DisplayName("the last administrator cannot be narrowed out of users:write")
    void narrowingAwayTheLastUsersWriteIsRefused() throws Exception {
        User first = admin("9866050003");
        User second = admin("9866050004");
        assertThat(archive(first, second)).isEqualTo(200);

        assertThat(narrow(second, first, "[\"users:read\"]"))
                .as("this would leave nobody who can restore anybody")
                .isEqualTo(409);
        assertThat(grants.findById(first.getId()))
                .as("a refusal must leave the stored document untouched, so the caller can resend")
                .isEmpty();
    }

    /**
     * The positive control for both. The same last administrator may still be narrowed as far as the
     * floor allows — the guard is about one atom, not about refusing to edit administrators.
     */
    @Test
    @DisplayName("narrowing that keeps users:write is allowed on the last administrator")
    void narrowingThatKeepsUsersWriteIsAllowed() throws Exception {
        User first = admin("9866050005");
        User second = admin("9866050006");
        assertThat(archive(first, second)).isEqualTo(200);

        assertThat(narrow(second, first, "[\"users:read\",\"users:write\"]")).isEqualTo(200);
    }

    /**
     * The definition, taken directly rather than through a route.
     *
     * <p>An account awaiting maker-checker approval cannot obtain a token, so it cannot repair
     * anything, so it must not be counted as an administrator — otherwise the floor would report
     * "there is still one" about a platform that is already locked out. This is the interlock
     * between the two halves of D200 and it is not reachable through HTTP, because half 2 stops the
     * pending account signing in to demonstrate it.
     */
    @Test
    @DisplayName("an administrator awaiting approval does not hold the floor up")
    void anAdministratorAwaitingApprovalDoesNotCount() {
        User standing = admin("9866050007");
        User pending = admin("9866050008");
        // The maker is a departed administrator rather than `standing`, because the second half of
        // this test needs `standing` to be the *checker* and the rule forbids one account being
        // both. Archived rather than invented: V67 puts a foreign key on created_by, so the maker
        // has to be a real user — and an archived one is both the realistic shape (the account that
        // minted a pending colleague is the one most likely to have left since) and inert here,
        // because isCapable excludes archived accounts and so the floor arithmetic is unchanged.
        User departed = admin("9866050009");
        departed.archive("left the desk");
        users.saveAndFlush(departed);
        approvals.saveAndFlush(new StaffAccountApproval(pending.getId(), departed.getId()));

        assertThatThrownBy(() -> guard.refuseIfLastAdministrator(standing))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("users:write");

        StaffAccountApproval approval = approvals.findById(pending.getId()).orElseThrow();
        approval.approve(standing.getId());
        approvals.saveAndFlush(approval);
        assertThatCode(() -> guard.refuseIfLastAdministrator(standing))
                .as("once it can sign in, it counts")
                .doesNotThrowAnyException();
    }

    /**
     * The other half of the same definition: capability, not role. An {@code admin} narrowed out of
     * {@code users:write} cannot create a colleague, archive anybody or edit a document, so counting
     * it would let the floor pass exactly when the disaster has already happened.
     */
    @Test
    @DisplayName("an administrator without users:write does not hold the floor up")
    void anAdministratorWithoutUsersWriteDoesNotCount() {
        User standing = admin("9866050009");
        User narrowed = admin("9866050010");
        grants.saveAndFlush(new BackOfficeGrant(narrowed.getId(), "[\"users:read\"]",
                standing.getId()));

        assertThatThrownBy(() -> guard.refuseIfLastAdministrator(standing))
                .isInstanceOf(ConflictException.class);
        assertThatThrownBy(() -> guard.refuseIfNarrowingRemovesLastAdministrator(
                standing, Set.of("dashboard:read")))
                .isInstanceOf(ConflictException.class);
    }

    /** Nothing about a buyer or a moderator touches this guard. */
    @Test
    @DisplayName("the floor is silent about accounts that were never administrators")
    void theFloorIgnoresNonAdministrators() {
        User staff = new User("9866050011", Roles.Wire.STAFF);
        staff.setName("Floor probe staff");
        users.saveAndFlush(staff);

        assertThatCode(() -> guard.refuseIfLastAdministrator(staff)).doesNotThrowAnyException();
        assertThatCode(() -> guard.refuseIfNarrowingRemovesLastAdministrator(staff, Set.of()))
                .doesNotThrowAnyException();
    }
}
