package com.draazy.api.identity.user;

import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ErrorCodes;
import com.draazy.api.common.error.UnauthorizedException;
import com.draazy.api.security.Roles;
import java.time.Instant;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

// Every method uses the server-resolved principal id, so callers only touch their own row.
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

    // Server-owned identity/trust fields are not accepted. verifiedContactOnly rationale: UserUpdate.
    @Transactional
    public User updateMe(UUID userId, UserUpdate patch) {
        User user = liveUser(userId);
        if (patch.name() != null) {
            if (user.isVerified() && !patch.name().equals(user.getName())) {
                throw new ConflictException(ErrorCodes.NAME_LOCKED_WHILE_VERIFIED,
                        "Verified profiles cannot change name from self-service. Ask support to review it.");
            }
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
        if (patch.shareActivityStatus() != null) {
            user.setShareActivityStatus(patch.shareActivityStatus());
        }
        if (patch.shareReadReceipts() != null) {
            user.setShareReadReceipts(patch.shareReadReceipts());
        }
        return user;
    }

    private User liveUser(UUID userId) {
        return users.findById(userId)
                .filter(u -> !u.isArchived())
                .orElseThrow(() -> new UnauthorizedException("Session is no longer valid"));
    }

    // REQUIRES_NEW + eager flush isolates a concurrent first sign-in's UNIQUE violation.
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public User provisionBuyer(String mobile) {
        User created = new User(mobile, Roles.Wire.BUYER);
        created.setMobileVerified(true);
        created.setLastActive(Instant.now());
        return users.saveAndFlush(created);
    }

    // Phoned-in listings need an owner row, but an operator's word is not an OTP.
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
