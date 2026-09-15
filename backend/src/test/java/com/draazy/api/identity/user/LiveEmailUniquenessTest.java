package com.draazy.api.identity.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
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

/** At most one live account per email, enforced in the service and by the partial unique index on
 *  {@code lower(email)}. Two live rows on one address is a permanent 500 on staff sign-in. */
@DisplayName("users.email — at most one live account per address")
class LiveEmailUniquenessTest extends AbstractApiTest {

    private static final String ADDRESS = "collision.probe@draazy.test";

    @Autowired
    UserRepository users;

    @PersistenceContext
    EntityManager em;

    /** {@code users.mobile} is UNIQUE in a persistent database, so a fixed literal would collide
     *  with anything a previous class left behind. */
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
        User admin = live("collision.admin@draazy.test", Roles.Wire.ADMIN);
        User suspended = archived(ADDRESS);
        // Legitimate today, and the reason the exists-check in addStaff cannot catch this: while the
        // first account is archived the address genuinely has no live claimant.
        live(ADDRESS, Roles.Wire.STAFF);

        restore(admin, suspended)
                .andExpect(status().isConflict())
                // The envelope field is `error`, not `code`.
                .andExpect(jsonPath("$.error").value("conflict"))
                // Naming the address is the actionable half: otherwise the operator is told a
                // restore failed and not which field caused it.
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
        User admin = live("collision.admin2@draazy.test", Roles.Wire.ADMIN);
        User suspended = archived("lonely.probe@draazy.test");

        restore(admin, suspended).andExpect(status().isOk());

        assertThat(archivedInDatabase(suspended))
                .as("an uncontested restore must bring the account back")
                .isFalse();
    }

    @Test
    @DisplayName("an account with no email address is always restorable")
    void anAccountWithoutAnEmailIsAlwaysRestorable() throws Exception {
        User admin = live("collision.admin3@draazy.test", Roles.Wire.ADMIN);
        User suspended = archived(null);

        restore(admin, suspended).andExpect(status().isOk());

        assertThat(archivedInDatabase(suspended)).isFalse();
    }

    @Test
    @DisplayName("the collision is detected across a difference of case alone")
    void aCaseVariantOfTheAddressIsStillACollision() throws Exception {
        User admin = live("collision.admin4@draazy.test", Roles.Wire.ADMIN);
        User suspended = archived("Mixed.Case@Draazy.test");
        live("mixed.case@draazy.test", Roles.Wire.STAFF);

        // A case-sensitive guard would restore happily and then hit the lower(email) index, which
        // yields the generic conflict rather than a message naming the address.
        restore(admin, suspended)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value(containsString("Mixed.Case@Draazy.test")));

        assertThat(archivedInDatabase(suspended)).isTrue();
    }

    /** Asserting the exact message is the point: a bare 409 would still pass with the guard removed,
     *  because the {@code lower(email)} index produces one too. */
    @Test
    @DisplayName("creating staff on a case-variant of a live address gets the named conflict")
    void creatingStaffOnACaseVariantIsNamed() throws Exception {
        User admin = live("collision.admin5@draazy.test", Roles.Wire.ADMIN);
        live("Staff.Dup@Draazy.test", Roles.Wire.STAFF);

        mvc.perform(post(Routes.Users.STAFF)
                        .header(HttpHeaders.AUTHORIZATION, bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"Case clash","mobile":"%s","email":"staff.dup@draazy.test",
                                 "role":"staff","team":"rental"}"""
                                .formatted(freshMobile())))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value("conflict"))
                .andExpect(jsonPath("$.message").value("A user with that email already exists"));
    }

    /** Excluding the row being edited matters as much as the case-insensitive comparison: re-saving
     *  an account with its own address, in any case, must stay a no-op. */
    @Test
    @DisplayName("patching a user onto a case-variant of a live address gets the named conflict")
    void patchingOntoACaseVariantIsNamed() throws Exception {
        User admin = live("collision.admin6@draazy.test", Roles.Wire.ADMIN);
        live("Patch.Dup@Draazy.test", Roles.Wire.STAFF);
        User target = live("patch.target@draazy.test", Roles.Wire.STAFF);

        mvc.perform(patch(Routes.Users.BY_ID, target.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"patch.dup@draazy.test\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value("A user with that email already exists"));

        // The guard excludes the row under edit, so re-stating an account's own address — here in a
        // different case — is still accepted rather than refused against itself.
        mvc.perform(patch(Routes.Users.BY_ID, target.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"Patch.Target@Draazy.test\"}"))
                .andExpect(status().isOk());
    }

    /** Goes round the service on purpose: the index is the floor under every write path, including
     *  a future one that forgets to ask. Nothing may follow the violation — PostgreSQL aborts. */
    @Test
    @DisplayName("the database refuses a second live row on the same address in a different case")
    void theIndexRefusesACaseVariantOfALiveAddress() {
        live("case.probe@draazy.test", Roles.Wire.STAFF);

        assertThatThrownBy(() -> live("Case.Probe@Draazy.test", Roles.Wire.STAFF))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    /** Why the index is partial: a total constraint would make every archived address permanently
     *  burnt. Separate from the test above because nothing may follow a constraint violation. */
    @Test
    @DisplayName("two archived accounts may share an address")
    void archivedRowsMayRepeatAnAddress() {
        archived("shared.history@draazy.test");
        archived("shared.history@draazy.test");

        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM users WHERE lower(email) = ? AND archived = true",
                Integer.class, "shared.history@draazy.test"))
                .isEqualTo(2);
    }
}
