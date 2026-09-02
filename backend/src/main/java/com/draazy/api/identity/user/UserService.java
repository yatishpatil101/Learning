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
     *
     * <p>An email change is refused when another live account already holds the address. Compared
     * without regard to case, matching V70's {@code lower(email)} partial unique index: the write
     * was going to fail either way, and the only question was whether the caller was told what
     * happened or handed the constraint handler's generic conflict.
     *
     * <p>{@code verifiedContactOnly} is accepted here despite sitting next to the trust flags,
     * which is not the contradiction it looks like. {@code verified} and {@code mobileVerified}
     * are claims <em>about</em> the account, and letting the account assert them is self-escalation;
     * this one is a claim about who the account is willing to hear from, which nobody but its holder
     * can answer. Raising the bar on your own inbox costs no other user anything they were entitled
     * to, so it needs no staff involvement.
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

    /**
     * Provision an account for an owner who called the office, so that a listing taken over the
     * phone can be owned by the person who owns the flat rather than by the operator typing it.
     *
     * <p><strong>{@code mobileVerified} stays false, unlike {@link #provisionBuyer}</strong>, and
     * that is the whole difference between the two methods. There, the flag is earned — the caller
     * has just proved control of the number by reading back an OTP. Here nobody has proved anything:
     * an operator typed a number they were told over a phone call. Copying the flag across would
     * make "verified" mean "an employee asserted it", which is exactly the claim the badge exists to
     * distinguish from. The owner earns it on their own first sign-in, at which point
     * {@code AuthService} adopts this row rather than creating a second one.
     *
     * <p>Role {@code buyer}, like every provisioned account: on this platform an owner is somebody
     * who has a listing, not somebody with a different role, and {@code ListingService#create}
     * attributes ownership without consulting the role at all.
     *
     * <p>Its own transaction for the same reason as {@link #provisionBuyer} — a concurrent first
     * sign-in by the owner themselves must surface the {@code UNIQUE(mobile)} violation here, in a
     * transaction that can roll back without taking the listing insert with it.
     *
     * @param mobile the number the operator was given
     * @param name   the owner's name as given, or {@code null} — a nameless account is better than
     *               one named after the operator
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
