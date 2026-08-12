package com.punenest.api.identity.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.common.web.Routes;
import com.punenest.api.security.Roles;
import com.punenest.api.support.AbstractApiTest;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

/**
 * At most one <em>live</em> account per email address — enforced in the service and, underneath it,
 * by V70's partial unique index.
 *
 * <h2>What this pins</h2>
 *
 * <p>Archiving is a soft delete, so {@code UserAdminService.addStaff}'s duplicate check — which asks
 * only about non-archived rows — legitimately passes once an address has been archived. Restore
 * validated nothing, so the sequence <em>create, archive, create again, restore the first</em> ended
 * with two live rows on one address. {@code AuthService.staffLogin} resolves the account with
 * {@code findByEmailIgnoreCaseAndArchivedFalse}, an {@code Optional}-returning lookup, so that state is a
 * permanent 500 on sign-in for both people with no route back through the back office.
 *
 * <p>Three facts, and they are not substitutes for one another: the restore is refused with
 * something the operator can act on; a restore with nothing to collide with still works; and the
 * database refuses the same thing on its own, for the write paths the service does not guard.
 *
 * <h2>Harness notes</h2>
 *
 * <p>{@code AbstractApiTest} is {@code @Transactional}, so every row created here rolls back. The
 * repository is used directly for setup rather than the API: the point is the state of the
 * {@code users} table, and driving it through {@code POST /users/staff} would additionally drag in
 * maker-checker (D200), which has nothing to do with this. {@code saveAndFlush} rather than
 * {@code save} throughout — a staged row the database has not seen cannot violate a database
 * constraint, and the constraint is half of what is under test.
 */
@DisplayName("users.email — at most one live account per address")
class LiveEmailUniquenessTest extends AbstractApiTest {

    private static final String ADDRESS = "collision.probe@punenest.test";

    @Autowired
    UserRepository users;

    @PersistenceContext
    EntityManager em;

    /**
     * Ten digits satisfying {@code users_mobile_check} and unique to this run.
     *
     * <p>{@code punenest_test} is persistent — only each test's data rolls back, not the schema —
     * and {@code users.mobile} is {@code UNIQUE}, so a fixed literal would collide with whatever a
     * previous class left behind if any of them ever escaped rollback. Derived from a random UUID
     * with a leading digit the CHECK accepts.
     */
    private static String freshMobile() {
        long n = Math.abs(UUID.randomUUID().getMostSignificantBits() % 1_000_000_000L);
        return "9" + String.format("%09d", n);
    }

    private User live(String email, String role) {
        User u = new User(freshMobile(), role);
        u.setName("Collision probe");
        u.setEmail(email);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private User archived(String email) {
        User u = live(email, Roles.Wire.STAFF);
        u.archive("Archived by the collision probe");
        return users.saveAndFlush(u);
    }

    private ResultActions restore(User actor, User target) throws Exception {
        return mvc.perform(patch(Routes.Users.RESTORE, target.getId())
                .header(HttpHeaders.AUTHORIZATION, bearer(actor)));
    }

    /** Read liveness from the database rather than the entity, which may hold an unflushed edit. */
    private boolean archivedInDatabase(User user) {
        em.flush();
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT archived FROM users WHERE id = ?", Boolean.class, user.getId()));
    }

    @Test
    @DisplayName("restoring an account whose address a live account now holds is refused with 409")
    void restoringOntoAnAddressAlreadyHeldIsRefused() throws Exception {
        User admin = live("collision.admin@punenest.test", Roles.Wire.ADMIN);
        User suspended = archived(ADDRESS);
        // Legitimate today, and the reason the exists-check in addStaff cannot catch this: while the
        // first account is archived the address genuinely has no live claimant.
        live(ADDRESS, Roles.Wire.STAFF);

        restore(admin, suspended)
                .andExpect(status().isConflict())
                // The envelope field is `error`, not `code`.
                .andExpect(jsonPath("$.error").value("conflict"))
                // Naming the address is the actionable half: without it the operator is told a
                // restore failed and not which of an account's fields caused it.
                .andExpect(jsonPath("$.message").value(containsString(ADDRESS)));

        // The refusal has to leave the account where it was. A guard that answers 409 *and* restores
        // is the original defect wearing an error message.
        assertThat(archivedInDatabase(suspended))
                .as("the refused account must still be archived")
                .isTrue();
    }

    @Test
    @DisplayName("restoring an account whose address nobody else holds still works")
    void restoringWithNoCollisionStillWorks() throws Exception {
        User admin = live("collision.admin2@punenest.test", Roles.Wire.ADMIN);
        User suspended = archived("lonely.probe@punenest.test");

        restore(admin, suspended).andExpect(status().isOk());

        assertThat(archivedInDatabase(suspended))
                .as("an uncontested restore must bring the account back")
                .isFalse();
    }

    @Test
    @DisplayName("an account with no email address is always restorable")
    void anAccountWithoutAnEmailIsAlwaysRestorable() throws Exception {
        User admin = live("collision.admin3@punenest.test", Roles.Wire.ADMIN);
        User suspended = archived(null);

        restore(admin, suspended).andExpect(status().isOk());

        assertThat(archivedInDatabase(suspended)).isFalse();
    }

    @Test
    @DisplayName("the collision is detected across a difference of case alone")
    void aCaseVariantOfTheAddressIsStillACollision() throws Exception {
        User admin = live("collision.admin4@punenest.test", Roles.Wire.ADMIN);
        User suspended = archived("Mixed.Case@PuneNest.test");
        live("mixed.case@punenest.test", Roles.Wire.STAFF);

        // If the guard compared case-sensitively it would find nothing and restore happily — and
        // then V70's index, which is on lower(email), would reject the flush and the operator would
        // get the constraint handler's generic conflict instead of a message naming the address.
        // Neither outcome is acceptable, so the guard has to agree with the index.
        restore(admin, suspended)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value(containsString("Mixed.Case@PuneNest.test")));

        assertThat(archivedInDatabase(suspended)).isTrue();
    }

    /**
     * Creating a colleague on an address a live account already holds in another case is refused
     * with the message that names the problem.
     *
     * <p>{@code addStaff} compared case-sensitively, so this sequence walked past its guard and died
     * on V70's {@code lower(email)} index instead — the operator was told the request conflicted
     * with existing data, without being told which field or which account. Asserting the exact
     * message is the point: a 409 alone would still pass with the guard removed, because the index
     * produces one too.
     */
    @Test
    @DisplayName("creating staff on a case-variant of a live address gets the named conflict")
    void creatingStaffOnACaseVariantIsNamed() throws Exception {
        User admin = live("collision.admin5@punenest.test", Roles.Wire.ADMIN);
        live("Staff.Dup@PuneNest.test", Roles.Wire.STAFF);

        mvc.perform(post(Routes.Users.STAFF)
                        .header(HttpHeaders.AUTHORIZATION, bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"Case clash","mobile":"%s","email":"staff.dup@punenest.test",
                                 "role":"staff"}"""
                                .formatted(freshMobile())))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value("conflict"))
                .andExpect(jsonPath("$.message").value("A user with that email already exists"));
    }

    /**
     * Correcting an account's email onto a case-variant of a live address is refused the same way.
     *
     * <p>{@code PATCH /users/{id}} had no uniqueness check at all, so this reached the index and
     * produced the generic conflict. Excluding the row being edited matters as much as the
     * comparison: re-saving an account with its own address, in any case, must stay a no-op.
     */
    @Test
    @DisplayName("patching a user onto a case-variant of a live address gets the named conflict")
    void patchingOntoACaseVariantIsNamed() throws Exception {
        User admin = live("collision.admin6@punenest.test", Roles.Wire.ADMIN);
        live("Patch.Dup@PuneNest.test", Roles.Wire.STAFF);
        User target = live("patch.target@punenest.test", Roles.Wire.STAFF);

        mvc.perform(patch(Routes.Users.BY_ID, target.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"patch.dup@punenest.test\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value("A user with that email already exists"));

        // The guard excludes the row under edit, so re-stating an account's own address — here in a
        // different case — is still accepted rather than refused against itself.
        mvc.perform(patch(Routes.Users.BY_ID, target.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"Patch.Target@PuneNest.test\"}"))
                .andExpect(status().isOk());
    }

    /**
     * The database refuses a second live row on the same address even when the service does not ask.
     *
     * <p>Deliberately goes round {@code UserAdminService} and writes through the repository. The
     * service guards above are not what is being tested here: the index is the floor under every
     * write path, including any future one that forgets to ask.
     *
     * <p>The two addresses differ <em>only</em> in case, so a plain {@code UNIQUE (email)} would let
     * this through: this assertion is what pins the index to {@code lower(email)}.
     *
     * <p><strong>Nothing may follow the violation.</strong> PostgreSQL aborts the whole transaction
     * on a failed statement, so any later query in this method would fail with "current transaction
     * is aborted" and say nothing about email uniqueness. The class-level rollback still runs, which
     * is why no cleanup is needed.
     */
    @Test
    @DisplayName("the database refuses a second live row on the same address in a different case")
    void theIndexRefusesACaseVariantOfALiveAddress() {
        live("case.probe@punenest.test", Roles.Wire.STAFF);

        assertThatThrownBy(() -> live("Case.Probe@PuneNest.test", Roles.Wire.STAFF))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    /**
     * Archived rows may repeat an address — the reason the index is partial.
     *
     * <p>Without this the suite would pass with a total unique constraint, which would make every
     * archived address a permanently burnt resource and would start refusing the archive itself the
     * day two archived accounts shared one. Same "nothing may follow a violation" rule as above,
     * which is why this cannot be folded into the previous test.
     */
    @Test
    @DisplayName("two archived accounts may share an address")
    void archivedRowsMayRepeatAnAddress() {
        archived("shared.history@punenest.test");
        archived("shared.history@punenest.test");

        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM users WHERE lower(email) = ? AND archived = true",
                Integer.class, "shared.history@punenest.test"))
                .isEqualTo(2);
    }
}
