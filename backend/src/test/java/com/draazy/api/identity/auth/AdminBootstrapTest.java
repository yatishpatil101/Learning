package com.draazy.api.identity.auth;

import static org.assertj.core.api.Assertions.assertThat;

import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

@ExtendWith(OutputCaptureExtension.class)
@DisplayName("Single administrator bootstrap")
class AdminBootstrapTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    StaffInviteService invites;
    @Autowired
    StaffSignInService staffSignIn;
    @Autowired
    RefreshTokenService refreshTokens;
    @PersistenceContext
    EntityManager em;

    private AdminBootstrap bootstrap(String email, String mobile, String name, String recover) {
        return new AdminBootstrap(users, invites, staffSignIn, refreshTokens, jdbc, em,
                email, mobile, name, recover, "http://localhost:5173");
    }

    private void run(AdminBootstrap bootstrap) {
        bootstrap.run(new DefaultApplicationArguments());
        em.flush();
        em.clear();
    }

    private User admin(String mobile, String email) {
        User user = new User(mobile, Roles.Wire.ADMIN);
        user.setName("Bootstrap probe");
        user.setEmail(email);
        user.setMobileVerified(true);
        return users.saveAndFlush(user);
    }

    @Test
    @DisplayName("creates the first admin and a one-hour invite")
    void createsAdminWhenNoneExists(CapturedOutput output) {
        run(bootstrap("Founder@Example.com", "9866043001", "Founder", ""));

        User admin = users.findByEmailIgnoreCaseAndArchivedFalse("founder@example.com").orElseThrow();
        assertThat(admin.getRole()).isEqualTo(Roles.Wire.ADMIN);
        assertThat(admin.getMobile()).isEqualTo("9866043001");
        assertThat(admin.getName()).isEqualTo("Founder");
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM staff_invites WHERE user_id = ? AND redeemed_at IS NULL",
                Integer.class, admin.getId())).isOne();
        Instant expiresAt = jdbc.queryForObject(
                "SELECT expires_at FROM staff_invites WHERE user_id = ?", Instant.class, admin.getId());
        assertThat(expiresAt).isBetween(Instant.now().plusSeconds(55 * 60),
                Instant.now().plusSeconds(65 * 60));
        assertThat(output.getAll()).contains("[ADMIN BOOTSTRAP] Open http://localhost:5173/staff-invite#");
    }

    @Test
    @DisplayName("does nothing when an admin exists and recover is blank")
    void existingAdminWithoutRecoverDoesNothing() {
        User admin = admin("9866043002", "admin@example.com");

        run(bootstrap("admin@example.com", "9866043002", "Ignored", ""));

        assertThat(jdbc.queryForObject("SELECT count(*) FROM staff_invites WHERE user_id = ?",
                Integer.class, admin.getId())).isZero();
    }

    @Test
    @DisplayName("fresh recovery nonce resets 2FA, revokes sessions, issues invite and records nonce")
    void recoverWithFreshNonce() {
        User admin = admin("9866043003", "recover@example.com");
        jdbc.update("""
                INSERT INTO staff_credentials
                    (user_id, totp_secret, totp_confirmed_at, totp_last_step, recovery_code_hashes)
                VALUES (?, 'ciphertext', now(), 10, '["hash"]'::jsonb)
                """, admin.getId());
        refreshTokens.issue(admin.getId());

        run(bootstrap("recover@example.com", "9866043003", "Ignored", "nonce-1"));

        assertThat(jdbc.queryForObject("""
                SELECT count(*) FROM staff_credentials
                WHERE user_id = ? AND totp_secret IS NULL AND totp_confirmed_at IS NULL
                  AND recovery_code_hashes = '[]'::jsonb
                """, Integer.class, admin.getId())).isOne();
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM refresh_tokens WHERE user_id = ? AND revoked = true",
                Integer.class, admin.getId())).isOne();
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM staff_invites WHERE user_id = ? AND redeemed_at IS NULL",
                Integer.class, admin.getId())).isOne();
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM admin_bootstrap_runs WHERE nonce = 'nonce-1'",
                Integer.class)).isOne();
    }

    @Test
    @DisplayName("the same recovery nonce does nothing a second time")
    void sameNonceDoesNothing() {
        User admin = admin("9866043004", "recover-once@example.com");
        run(bootstrap("recover-once@example.com", "9866043004", "Ignored", "nonce-2"));
        UUID firstInvite = jdbc.queryForObject(
                "SELECT id FROM staff_invites WHERE user_id = ?", UUID.class, admin.getId());

        run(bootstrap("recover-once@example.com", "9866043004", "Ignored", "nonce-2"));

        UUID secondInvite = jdbc.queryForObject(
                "SELECT id FROM staff_invites WHERE user_id = ?", UUID.class, admin.getId());
        assertThat(secondInvite).isEqualTo(firstInvite);
    }

    @Test
    @DisplayName("recovery with a non-matching email does nothing")
    void recoverWithNonMatchingEmailDoesNothing() {
        User admin = admin("9866043005", "real-admin@example.com");

        run(bootstrap("other-admin@example.com", "9866043005", "Ignored", "nonce-3"));

        assertThat(jdbc.queryForObject("SELECT count(*) FROM staff_invites WHERE user_id = ?",
                Integer.class, admin.getId())).isZero();
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM admin_bootstrap_runs WHERE nonce = 'nonce-3'",
                Integer.class)).isZero();
    }

    @Test
    @DisplayName("recovery adopts an email-less admin whose mobile matches, so a seeded admin can sign in")
    void recoverAdoptsEmaillessAdminByMobile() {
        User admin = admin("9866043007", null);

        run(bootstrap("Adopted@Example.com", "9866043007", "Ignored", "nonce-4"));

        assertThat(users.findById(admin.getId()).orElseThrow().getEmail()).isEqualTo("adopted@example.com");
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM staff_invites WHERE user_id = ? AND redeemed_at IS NULL",
                Integer.class, admin.getId())).isOne();
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM admin_bootstrap_runs WHERE nonce = 'nonce-4'",
                Integer.class)).isOne();
    }

    @Test
    @DisplayName("recovery never adopts an admin whose mobile differs from the configured one")
    void recoverDoesNotAdoptOtherEmaillessAdmin() {
        User admin = admin("9866043008", null);

        run(bootstrap("adopt-other@example.com", "9866043009", "Ignored", "nonce-5"));

        assertThat(users.findById(admin.getId()).orElseThrow().getEmail()).isNull();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM staff_invites WHERE user_id = ?",
                Integer.class, admin.getId())).isZero();
    }

    @Test
    @DisplayName("recovery never adopts a non-admin that holds the configured mobile")
    void recoverDoesNotAdoptNonAdmin() {
        User buyer = users.saveAndFlush(new User("9866043010", Roles.Wire.BUYER));
        admin("9866043011", "existing-admin@example.com");

        run(bootstrap("adopt-buyer@example.com", "9866043010", "Ignored", "nonce-6"));

        assertThat(users.findById(buyer.getId()).orElseThrow().getEmail()).isNull();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM staff_invites WHERE user_id = ?",
                Integer.class, buyer.getId())).isZero();
    }

    @Test
    @DisplayName("mobile collision with a buyer logs an error and creates nothing")
    void mobileCollisionWithBuyerCreatesNothing(CapturedOutput output) {
        users.saveAndFlush(new User("9866043006", Roles.Wire.BUYER));

        run(bootstrap("new-admin@example.com", "9866043006", "Ignored", ""));

        assertThat(users.findLiveByRole(Roles.Wire.ADMIN)).isEmpty();
        assertThat(output.getAll()).contains("mobile already belongs to a buyer account");
    }
}
