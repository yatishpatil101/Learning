package com.draazy.api.moderation.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.draazy.api.common.access.BackOfficeGrantRepository;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
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
 * {@code users:write} by definition and self-archive is already 403,
 * so the actor always survives their own request. What breaks that reasoning is that
 * <strong>{@code JwtAuthFilter} is stateless</strong>. Archiving somebody does not revoke the token
 * they are already holding (the same asymmetry D201 records for role changes), so an administrator
 * who has just been archived keeps acting for the remainder of their token's life — and the account
 * they act against is the only one left. Two administrators, two requests, no race required, and
 * afterwards nobody can sign into the back office again.
 *
 * <p>That is the sequence the HTTP test below walks, with a positive control so the guard cannot
 * pass by refusing everything.
 */
@DisplayName("D200 — the last-administrator floor")
class AdministratorGuardTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    @Autowired
    BackOfficeGrantRepository grants;

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

    private int narrow(User actor, User target, String functions) throws Exception {
        return mvc.perform(put(Routes.Users.PERMISSIONS.replace("{id}", target.getId().toString()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"functions\":%s}".formatted(functions)))
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

    @Test
    @DisplayName("the administrator cannot be narrowed")
    void theAdministratorIsNeverNarrowed() throws Exception {
        User first = admin("9866050003");
        User second = admin("9866050004");

        assertThat(narrow(second, first, "[\"kyc\"]")).isEqualTo(422);
        assertThat(grants.findById(first.getId())).isEmpty();
    }
    /** Nothing about a buyer or a moderator touches this guard. */
    @Test
    @DisplayName("the floor is silent about accounts that were never administrators")
    void theFloorIgnoresNonAdministrators() {
        User staff = new User("9866050011", Roles.Wire.STAFF);
        staff.setName("Floor probe staff");
        users.saveAndFlush(staff);

        assertThatCode(() -> guard.refuseIfLastAdministrator(staff)).doesNotThrowAnyException();
    }
}
