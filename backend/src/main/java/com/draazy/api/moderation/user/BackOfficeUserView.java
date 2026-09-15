package com.draazy.api.moderation.user;

import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.common.web.Ids;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserMapper;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.identity.user.UserResponse;
import org.springframework.stereotype.Component;

/**
 * Owns one decision shared by the two back-office services: what a staff caller may see of another
 * person. Rationale: docs/flows/admin/users-kyc.md#back-office-user-view.
 */
@Component
class BackOfficeUserView {

    private final UserRepository users;
    private final UserMapper mapper;

    BackOfficeUserView(UserRepository users, UserMapper mapper) {
        this.users = users;
        this.mapper = mapper;
    }

    /** Resolve an opaque id, or 404. Tolerates a malformed id rather than 500-ing on it. */
    User load(String id) {
        return Ids.parseUuid(id)
                .flatMap(users::findById)
                .orElseThrow(() -> NotFoundException.of("User"));
    }

    /** The directory projection — mobile redacted. */
    UserResponse masked(User user) {
        return project(user, true);
    }

    /** The single-account projection — mobile in full. Audit the reveal at the call site. */
    UserResponse full(User user) {
        return project(user, false);
    }

    /**
     * Everything {@link UserMapper} produces, plus the internal review flag, with the mobile
     * optionally redacted. One method, because a positional copy of this record is unreadable.
     */
    private UserResponse project(User user, boolean maskMobile) {
        UserResponse base = mapper.toResponse(user);
        return new UserResponse(base.id(), base.name(),
                maskMobile ? MobileMask.mask(base.mobile()) : base.mobile(), base.email(),
                base.role(), base.team(), base.status(), base.verified(), base.city(),
                base.mobileVerified(), base.verifiedContactOnly(),
                base.hideNumber(), base.listingsCount(), base.joinedAt(), base.lastActive(),
                base.createdAt(), base.permissions(),
                // Boxed, and only on the back-office routes: see UserResponse#flagged for why a
                // plain false would be the wrong answer on GET /auth/me.
                user.isFlagged(), user.getFlagReason());
    }
}
