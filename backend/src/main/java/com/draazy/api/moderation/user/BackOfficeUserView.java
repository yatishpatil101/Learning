package com.draazy.api.moderation.user;

import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.common.web.Ids;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserMapper;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.identity.user.UserResponse;
import com.draazy.api.identity.verification.IdentityVerificationService;
import org.springframework.stereotype.Component;

// Centralises what staff may see of another person.
@Component
class BackOfficeUserView {

    static final String BADGE_FROM_IDENTITY = "identity";
    static final String BADGE_BY_HAND = "manual";

    private final UserRepository users;
    private final UserMapper mapper;
    private final IdentityVerificationService identity;

    BackOfficeUserView(UserRepository users, UserMapper mapper, IdentityVerificationService identity) {
        this.users = users;
        this.mapper = mapper;
        this.identity = identity;
    }

    /** Resolve an opaque id, or 404. Tolerates a malformed id rather than 500-ing on it. */
    User load(String id) {
        return Ids.parseUuid(id)
                .flatMap(users::findById)
                .orElseThrow(() -> NotFoundException.of("User"));
    }

    UserResponse masked(User user) {
        return project(user, true);
    }

    /** The single-account projection — mobile in full. Audit the reveal at the call site. */
    UserResponse full(User user) {
        return project(user, false);
    }

    // One method because a positional copy of this record is unreadable.
    private UserResponse project(User user, boolean maskMobile) {
        UserResponse base = mapper.toResponse(user);
        return new UserResponse(base.id(), base.name(),
                maskMobile ? MobileMask.mask(base.mobile()) : base.mobile(), base.email(),
                base.role(), base.team(), base.status(), base.verified(), base.city(),
                base.mobileVerified(), base.verifiedContactOnly(),
                base.hideNumber(), base.shareActivityStatus(), base.shareReadReceipts(),
                base.listingsCount(), base.joinedAt(), base.lastActive(),
                base.createdAt(), base.permissions(), base.desks(),

                // Boxed, and only on the back-office routes: see UserResponse#flagged for why a
                // plain false would be the wrong answer on GET /auth/me.
                user.isFlagged(), user.getFlagReason(), badgeSource(user));
    }

    private String badgeSource(User user) {
        if (!user.isVerified()) {
            return null;
        }
        return identity.isVerified(user.getId()) ? BADGE_FROM_IDENTITY : BADGE_BY_HAND;
    }
}
