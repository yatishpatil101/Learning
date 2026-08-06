package com.punenest.api.identity.user;

import com.punenest.api.common.error.UnauthorizedException;
import com.punenest.api.security.Roles;
import java.time.Instant;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Owner-scoped profile reads/writes behind {@code /auth/me}. Every method is keyed by the
 * server-resolved principal id (never a client-supplied id), so a caller can only ever see or mutate
 * their own row. A token whose user has since been archived is treated as an invalid session
 * ({@code 401}) rather than resurrecting or exposing the account.
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
     * Apply a partial profile update (contract {@code UserUpdate}). Null fields are left untouched.
     * Server-owned identity/trust fields are not accepted, so this can't escalate.
     */
    @Transactional
    public User updateMe(UUID userId, UserUpdate patch) {
        User user = liveUser(userId);
        if (patch.name() != null) {
            user.setName(patch.name());
        }
        if (patch.email() != null) {
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
        return user;
    }

    private User liveUser(UUID userId) {
        return users.findById(userId)
                .filter(u -> !u.isArchived())
                .orElseThrow(() -> new UnauthorizedException("Session is no longer valid"));
    }

    /**
     * Auto-provision a passwordless {@code buyer} on first OTP-verified sign-in (ADR-019, L1 floor).
     * Runs in its <em>own</em> transaction ({@code REQUIRES_NEW}) and flushes eagerly so a concurrent
     * first sign-in surfaces the {@code UNIQUE(mobile)} violation <em>here</em>, in an isolated tx that
     * rolls back alone — Postgres poisons a whole transaction on a constraint error, so keeping this
     * insert separate lets the caller catch the race and adopt the winner's row without a 500.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public User provisionBuyer(String mobile) {
        User created = new User(mobile, Roles.Wire.BUYER);
        created.setMobileVerified(true);
        created.setLastActive(Instant.now());
        return users.saveAndFlush(created);
    }
}
