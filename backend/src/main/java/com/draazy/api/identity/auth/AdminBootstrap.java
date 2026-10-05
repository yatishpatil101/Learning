package com.draazy.api.identity.auth;

import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.common.validation.Formats;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import jakarta.persistence.EntityManager;
import jakarta.persistence.FlushModeType;
import jakarta.persistence.Query;
import java.time.Duration;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class AdminBootstrap implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(AdminBootstrap.class);
    private static final long BOOTSTRAP_LOCK = 0xA88L;
    private static final Duration INVITE_TTL = Duration.ofHours(1);
    private static final Pattern EMAIL = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");

    private final UserRepository users;
    private final StaffInviteService invites;
    private final StaffSignInService staffSignIn;
    private final RefreshTokenService refreshTokens;
    private final JdbcTemplate jdbc;
    private final EntityManager em;
    private final String email;
    private final String mobile;
    private final String name;
    private final String recover;
    private final String baseUrl;

    public AdminBootstrap(UserRepository users, StaffInviteService invites,
            StaffSignInService staffSignIn, RefreshTokenService refreshTokens,
            JdbcTemplate jdbc, EntityManager em,
            @Value("${draazy.bootstrap.admin.email:}") String email,
            @Value("${draazy.bootstrap.admin.mobile:}") String mobile,
            @Value("${draazy.bootstrap.admin.name:Administrator}") String name,
            @Value("${draazy.bootstrap.admin.recover:}") String recover,
            @Value("${draazy.app.base-url}") String baseUrl) {
        this.users = users;
        this.invites = invites;
        this.staffSignIn = staffSignIn;
        this.refreshTokens = refreshTokens;
        this.jdbc = jdbc;
        this.em = em;
        this.email = blankToEmpty(email);
        this.mobile = blankToEmpty(mobile);
        this.name = blankToEmpty(name).isBlank() ? "Administrator" : name.trim();
        this.recover = blankToEmpty(recover);
        this.baseUrl = blankToEmpty(baseUrl).replaceAll("/+$", "");
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (email.isBlank()) {
            return;
        }
        holdBootstrapUntilCommit();
        if (users.findLiveByRole(Roles.Wire.ADMIN).isEmpty()) {
            createFirstAdmin();
            return;
        }
        if (!recover.isBlank() && !nonceUsed(recover)) {
            recoverAdmin();
        }
    }

    private void createFirstAdmin() {
        Contact contact = contactOrNull();
        if (contact == null || hasNonAdminCollision(contact)) {
            return;
        }
        User user = new User(contact.mobile(), Roles.Wire.ADMIN);
        user.setName(name);
        user.setEmail(contact.email());
        user.setMobileVerified(true);
        User saved = users.saveAndFlush(user);
        String token = invites.issueToken(saved.getId(), saved.getId(), INVITE_TTL);
        logInvite(token);
    }

    private void recoverAdmin() {
        String normalisedEmail = normaliseEmail(email);
        User admin = adminToRecover(normalisedEmail);
        if (admin == null) {
            log.warn("Admin bootstrap recovery skipped: no live administrator matches {}", normalisedEmail);
            return;
        }
        staffSignIn.resetSecondFactor(admin.getId());
        refreshTokens.revokeAllForUser(admin.getId());
        String token = invites.reissueToken(admin.getId(), admin.getId(), INVITE_TTL);
        jdbc.update("INSERT INTO admin_bootstrap_runs (nonce) VALUES (?)", recover);
        logInvite(token);
    }

    private User adminToRecover(String normalisedEmail) {
        Optional<User> emailOwner = users.findByEmailIgnoreCaseAndArchivedFalse(normalisedEmail);
        if (emailOwner.isPresent()) {
            return emailOwner.filter(user -> Roles.Wire.ADMIN.equals(user.getRole())).orElse(null);
        }
        return adoptEmaillessAdmin(normalisedEmail);
    }

    // A seeded or pre-2FA admin has no email to sign in with; the configured mobile names which one.
    private User adoptEmaillessAdmin(String normalisedEmail) {
        Contact contact = contactOrNull();
        if (contact == null) {
            return null;
        }
        return users.findByMobileAndArchivedFalse(contact.mobile())
                .filter(user -> Roles.Wire.ADMIN.equals(user.getRole()))
                .filter(user -> user.getEmail() == null || user.getEmail().isBlank())
                .map(user -> {
                    user.setEmail(normalisedEmail);
                    return users.saveAndFlush(user);
                })
                .orElse(null);
    }

    private Contact contactOrNull() {
        String normalisedEmail = normaliseEmail(email);
        if (!EMAIL.matcher(normalisedEmail).matches()) {
            log.error("Admin bootstrap skipped: BOOTSTRAP_ADMIN_EMAIL is not a valid email address");
            return null;
        }
        String normalisedMobile = MobileMask.normalise(mobile);
        if (normalisedMobile == null || !Pattern.matches(Formats.MOBILE, normalisedMobile)) {
            log.error("Admin bootstrap skipped: BOOTSTRAP_ADMIN_MOBILE is not a valid Indian mobile");
            return null;
        }
        return new Contact(normalisedEmail, normalisedMobile);
    }

    private boolean hasNonAdminCollision(Contact contact) {
        User mobileOwner = users.findByMobile(contact.mobile()).orElse(null);
        if (mobileOwner != null) {
            log.error("Admin bootstrap skipped: mobile already belongs to a {} account",
                    mobileOwner.getRole());
            return true;
        }
        User emailOwner = users.findByEmailIgnoreCaseAndArchivedFalse(contact.email()).orElse(null);
        if (emailOwner != null) {
            log.error("Admin bootstrap skipped: email already belongs to a {} account",
                    emailOwner.getRole());
            return true;
        }
        return false;
    }

    private boolean nonceUsed(String nonce) {
        Integer count = jdbc.queryForObject(
                "SELECT count(*) FROM admin_bootstrap_runs WHERE nonce = ?", Integer.class, nonce);
        return count != null && count > 0;
    }

    private void logInvite(String token) {
        log.warn("[ADMIN BOOTSTRAP] Open {}/staff-invite#{} within 1 hour to set the administrator password.",
                baseUrl, token);
    }

    private void holdBootstrapUntilCommit() {
        Query query = em.createNativeQuery(
                "select 1 from (select pg_advisory_xact_lock(:lockId)) as acquired");
        query.setFlushMode(FlushModeType.COMMIT);
        query.setParameter("lockId", BOOTSTRAP_LOCK);
        query.getSingleResult();
    }

    private static String normaliseEmail(String value) {
        return blankToEmpty(value).trim().toLowerCase(Locale.ROOT);
    }

    private static String blankToEmpty(String value) {
        return value == null ? "" : value.trim();
    }

    private record Contact(String email, String mobile) {
    }
}
