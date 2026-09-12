package com.draazy.api.identity.user;

import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.UnauthorizedException;
import com.draazy.api.security.Roles;
import java.time.Instant;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Owner-scoped profile reads/writes behind {@code /auth/me}. Every method is keyed by the
 * server-resolved principal id, so a caller can only ever see or mutate their own row.
 */
@Service
public class UserService {

    private final UserRepository users;

    public UserService(UserRepository users) {
        this.users = users;
    }

    /** The current user's live profile, or {@code 401} if the account is gone/archived. */
    @Transactional(readOnly = true)
    public User getMe(UUID userId) {
        return liveUser(userId);
    }

    /**
     * Apply a partial profile update; null fields are left untouched and server-owned identity/trust
     * fields are not accepted. Why {@code verifiedContactOnly} is self-service: see {@link UserUpdate}.
     */
    @Transactional
    public User updateMe(UUID userId, UserUpdate patch) {
        User user = liveUser(userId);
        if (patch.name() != null) {
            user.setName(patch.name());
        }
        if (patch.email() != null) {
            if (!patch.email().isBlank()
                    && users.existsOtherLiveWithEmailIgnoreCase(patch.email(), userId)) {
                throw new ConflictException("That email address is already in use");
            }
            user.setEmail(patch.email());
        }
        if (patch.avatar() != null) {
            user.setAvatar(patch.avatar());
        }
        if (patch.city() != null) {
            user.setCity(patch.city());
        }
        if (patch.hideNumber() != null) {
            user.setHideNumber(patch.hideNumber());
        }
        if (patch.verifiedContactOnly() != null) {
            user.setVerifiedContactOnly(patch.verifiedContactOnly());
        }
        return user;
    }

    private User liveUser(UUID userId) {
        return users.findById(userId)
                .filter(u -> !u.isArchived())
                .orElseThrow(() -> new UnauthorizedException("Session is no longer valid"));
    }

    /**
     * Auto-provision a passwordless {@code buyer} on first OTP-verified sign-in (ADR-019, L1 floor).
     * {@code REQUIRES_NEW} + eager flush so a concurrent first sign-in's UNIQUE violation isolates.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public User provisionBuyer(String mobile) {
        User created = new User(mobile, Roles.Wire.BUYER);
        created.setMobileVerified(true);
        created.setLastActive(Instant.now());
        return users.saveAndFlush(created);
    }

    /**
     * Provision an account for an owner who called the office, so a phoned-in listing is owned by the
     * person who owns the flat. {@code mobileVerified} stays false — an operator's word is not an OTP.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public User provisionForStaff(String mobile, String name) {
        User created = new User(mobile, Roles.Wire.BUYER);
        if (name != null && !name.isBlank()) {
            created.setName(name.trim());
        }
        created.setLastActive(Instant.now());
        return users.saveAndFlush(created);
    }
}
