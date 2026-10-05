package com.draazy.api.identity.auth;

import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ErrorCodes;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.RateLimitedException;
import com.draazy.api.common.error.UnauthorizedException;
import com.draazy.api.common.settings.PlatformSettings;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.LocalProfileGuard;
import com.draazy.api.security.Roles;
import jakarta.annotation.PostConstruct;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Back-office sign-in: email + password, then an authenticator code (or a one-time recovery code).
 * Every refusal before the password is proven is the same 401, so the route sorts no email into
 * staff and not-staff. Flow and threat model: docs/flows/consumer/auth.md § Staff login.
 */
@Service
public class StaffSignInService {

    // BCrypt hash for a dummy secret used only to equalize unknown-email work in staff login.
    private static final String DUMMY_BCRYPT =
            "$2a$10$7EqJtq98hPqEX7fNZaFWoOeR6Y4u5M4YB9Gf4bm/FvGV8eK3oprm.";
    private static final Pattern TOTP_CODE = Pattern.compile("\\d{6}");
    private static final String RECOVERY_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
    private static final int RECOVERY_CODES = 10;
    private static final SecureRandom RANDOM = new SecureRandom();

    private final UserRepository users;
    private final StaffCredentialRepository credentials;
    private final StaffTotpCipher cipher;
    private final StaffSignInChallenges challenges;
    private final PasswordEncoder passwordEncoder;
    private final PlatformSettings platformSettings;
    private final AuthService auth;
    private final Environment environment;

    /** Local/e2e only, like {@code draazy.otp.fixed-code}: a code every account accepts. */
    private final String fixedCode;

    public StaffSignInService(UserRepository users, StaffCredentialRepository credentials,
            StaffTotpCipher cipher, StaffSignInChallenges challenges, PasswordEncoder passwordEncoder,
            PlatformSettings platformSettings, AuthService auth, Environment environment,
            @Value("${draazy.staff-totp.fixed-code:}") String fixedCode) {
        this.users = users;
        this.credentials = credentials;
        this.cipher = cipher;
        this.challenges = challenges;
        this.passwordEncoder = passwordEncoder;
        this.platformSettings = platformSettings;
        this.auth = auth;
        this.environment = environment;
        this.fixedCode = fixedCode == null ? "" : fixedCode.trim();
    }

    @PostConstruct
    void rejectFixedCodeInDeployments() {
        String profile = LocalProfileGuard.activeDeploymentProfile(environment);
        if (!fixedCode.isEmpty() && profile != null) {
            throw new IllegalStateException("draazy.staff-totp.fixed-code is set while the '" + profile
                    + "' profile is active. That lets anyone holding a staff password past the "
                    + "second factor. Unset it (check DRAAZY_STAFF_TOTP_FIXED_CODE in the process "
                    + "environment, not only the properties files).");
        }
    }

    /**
     * Step one. While locked every known staff email answers 429 whatever the password, so the lock
     * cannot be used as an oracle for guessing it.
     */
    @Transactional(noRollbackFor = {UnauthorizedException.class, RateLimitedException.class})
    public AuthResponse checkPassword(StaffLoginRequest request) {
        User user = users.findByEmailIgnoreCaseAndArchivedFalse(request.email()).orElse(null);
        String hash = user != null && user.getPasswordHash() != null ? user.getPasswordHash() : DUMMY_BCRYPT;
        boolean passwordMatches = passwordEncoder.matches(request.password(), hash);
        if (user == null || user.getPasswordHash() == null || !Roles.isBackOffice(user.getRole())) {
            throw invalidCredentials();
        }
        Instant now = Instant.now();
        StaffCredential credential = credentialOf(user.getId());
        refuseIfLocked(credential, now);
        if (!passwordMatches) {
            credential.recordFailure(now);
            throw invalidCredentials();
        }
        if (!Roles.Wire.ADMIN.equals(user.getRole()) && !platformSettings.staffLoginEnabled()) {
            throw new ForbiddenException(
                "Staff sign-in is switched off at the moment. Ask an administrator to turn it "
                    + "back on.");
        }
        auth.refuseIfCannotYetAuthenticate(user);
        return AuthResponse.secondFactor(
                credential.isEnrolled() ? AuthResponse.MFA_TOTP : AuthResponse.MFA_ENROL,
                challenges.issue(user.getId(), now));
    }

    /** Step two for an enrolled account: an authenticator code or one unused recovery code. */
    @Transactional(noRollbackFor = {UnauthorizedException.class, RateLimitedException.class})
    public AuthResponse verify(StaffCodeRequest request) {
        Instant now = Instant.now();
        User user = challengedUser(request.challenge(), now);
        StaffCredential credential = credentialOf(user.getId());
        refuseIfLocked(credential, now);
        if (!credential.isEnrolled()) {
            throw StaffSignInChallenges.expired();
        }
        String code = request.code().trim();
        boolean accepted = TOTP_CODE.matcher(code).matches()
                ? acceptsTotp(credential, code, now)
                : credential.consumeRecoveryCode(Tokens.sha256Hex(normaliseRecovery(code)));
        if (!accepted) {
            credential.recordFailure(now);
            throw new UnauthorizedException("That code did not work. Check your authenticator app "
                    + "and try again.");
        }
        credential.recordSuccess();
        return auth.issueFor(user);
    }

    /** Step two for an account with no authenticator: mint a secret to scan. */
    @Transactional(noRollbackFor = {UnauthorizedException.class, RateLimitedException.class})
    public StaffTotpEnrolment startEnrolment(StaffEnrolRequest request) {
        Instant now = Instant.now();
        User user = challengedUser(request.challenge(), now);
        StaffCredential credential = credentialOf(user.getId());
        refuseIfLocked(credential, now);
        if (credential.isEnrolled()) {
            throw new ConflictException("This account already has an authenticator. Sign in with "
                    + "its code, or ask an administrator to reset it.");
        }
        byte[] secret = Totp.newSecret();
        credential.startEnrolment(cipher.encrypt(secret));
        String base32 = Totp.base32(secret);
        String issuer = issuer();
        String label = URLEncoder.encode(issuer + ":" + user.getEmail(), StandardCharsets.UTF_8)
                .replace("+", "%20");
        return new StaffTotpEnrolment(base32, "otpauth://totp/" + label + "?secret=" + base32
                + "&issuer=" + URLEncoder.encode(issuer, StandardCharsets.UTF_8).replace("+", "%20"));
    }

    // One phone holds an entry per environment, so the app label must say which one.
    private String issuer() {
        String profile = LocalProfileGuard.activeDeploymentProfile(environment);
        if (LocalProfileGuard.PROD_PROFILE.equals(profile)) {
            return "Draazy";
        }
        return LocalProfileGuard.SANDBOX_PROFILE.equals(profile) ? "Draazy Sandbox" : "Draazy Local";
    }

    /** Prove the app holds the new secret, then sign in and hand back the recovery codes once. */
    @Transactional(noRollbackFor = {UnauthorizedException.class, RateLimitedException.class})
    public AuthResponse confirmEnrolment(StaffCodeRequest request) {
        Instant now = Instant.now();
        User user = challengedUser(request.challenge(), now);
        StaffCredential credential = credentialOf(user.getId());
        refuseIfLocked(credential, now);
        if (credential.isEnrolled() || credential.getTotpSecret() == null) {
            throw StaffSignInChallenges.expired();
        }
        String code = request.code().trim();
        long step = TOTP_CODE.matcher(code).matches() ? matchingStep(credential, code, now) : -1;
        if (step < 0) {
            credential.recordFailure(now);
            throw new UnauthorizedException("That code did not match. Scan the QR code again and "
                    + "enter the code your app shows now.");
        }
        List<String> codes = new ArrayList<>();
        List<String> hashes = new ArrayList<>();
        for (int i = 0; i < RECOVERY_CODES; i++) {
            String recovery = newRecoveryCode();
            codes.add(recovery);
            hashes.add(Tokens.sha256Hex(normaliseRecovery(recovery)));
        }
        credential.confirmEnrolment(step, hashes, now);
        credential.recordSuccess();
        return auth.issueFor(user).withRecoveryCodes(codes);
    }

    /** Administrator reset after a lost phone; the holder enrols again at next sign-in. */
    @Transactional
    public void resetSecondFactor(UUID userId) {
        credentialOf(userId).resetSecondFactor();
    }

    private User challengedUser(String challenge, Instant now) {
        UUID userId = challenges.verify(challenge, now);
        User user = users.findByIdAndArchivedFalse(userId).orElseThrow(StaffSignInChallenges::expired);
        auth.refuseIfCannotYetAuthenticate(user);
        return user;
    }

    private StaffCredential credentialOf(UUID userId) {
        credentials.ensureExists(userId);
        return credentials.findForUpdate(userId).orElseThrow();
    }

    private boolean acceptsTotp(StaffCredential credential, String code, Instant now) {
        long step = matchingStep(credential, code, now);
        return step >= 0 && (isFixedCode(code) || credential.acceptStep(step));
    }

    private long matchingStep(StaffCredential credential, String code, Instant now) {
        if (isFixedCode(code)) {
            return Totp.stepAt(now);
        }
        return Totp.matchingStep(cipher.decrypt(credential.getTotpSecret()), code, now);
    }

    private boolean isFixedCode(String code) {
        return !fixedCode.isEmpty() && MessageDigest.isEqual(
                fixedCode.getBytes(StandardCharsets.UTF_8), code.getBytes(StandardCharsets.UTF_8));
    }

    private static void refuseIfLocked(StaffCredential credential, Instant now) {
        if (credential.isLocked(now)) {
            long seconds = Math.max(1, Duration.between(now, credential.getLockedUntil()).toSeconds());
            throw new RateLimitedException(ErrorCodes.STAFF_SIGN_IN_LOCKED,
                    "Too many failed attempts. Sign-in for this account is paused for "
                            + Math.ceilDiv(seconds, 60) + " minute(s).", (int) seconds);
        }
    }

    private static UnauthorizedException invalidCredentials() {
        return new UnauthorizedException("Invalid credentials");
    }

    private static String newRecoveryCode() {
        StringBuilder code = new StringBuilder();
        for (int i = 0; i < 10; i++) {
            if (i == 5) {
                code.append('-');
            }
            code.append(RECOVERY_ALPHABET.charAt(RANDOM.nextInt(RECOVERY_ALPHABET.length())));
        }
        return code.toString();
    }

    private static String normaliseRecovery(String code) {
        return code.toLowerCase().replaceAll("[^a-z0-9]", "");
    }
}
