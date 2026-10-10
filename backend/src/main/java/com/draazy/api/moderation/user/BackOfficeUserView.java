package com.draazy.api.moderation.user;

import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.common.web.Ids;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserMapper;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.identity.user.UserResponse;
import com.draazy.api.identity.verification.IdentityVerificationService;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;

// Centralises what staff may see of another person.
@Component
class BackOfficeUserView {

    static final String BADGE_FROM_IDENTITY = "identity";
    static final String BADGE_BY_HAND = "manual";

    private final UserRepository users;
    private final UserMapper mapper;
    private final IdentityVerificationService identity;
    private final BadgeGrantRequestRepository badgeRequests;

    BackOfficeUserView(UserRepository users, UserMapper mapper, IdentityVerificationService identity,
            BadgeGrantRequestRepository badgeRequests) {
        this.users = users;
        this.mapper = mapper;
        this.identity = identity;
        this.badgeRequests = badgeRequests;
    }

    /** Resolve an opaque id, or 404. Tolerates a malformed id rather than 500-ing on it. */
    User load(String id) {
        return Ids.parseUuid(id)
                .flatMap(users::findById)
                .orElseThrow(() -> NotFoundException.of("User"));
    }

    UserResponse full(User user) {
        UserResponse base = mapper.toResponse(user);
        return new UserResponse(base.id(), base.name(), base.mobile(), base.email(),
                base.role(), base.team(), base.status(), base.verified(), base.city(),
                base.mobileVerified(), base.verifiedContactOnly(),
                base.hideNumber(), base.shareActivityStatus(), base.shareReadReceipts(),
                base.listingsCount(), base.joinedAt(), base.lastActive(),
                base.createdAt(), base.permissions(), base.desks(),

                // Boxed, and only on the back-office routes: see UserResponse#flagged for why a
                // plain false would be the wrong answer on GET /auth/me.
                user.isFlagged(), user.getFlagReason(), badgeSource(user));
    }

    AdminUserRow row(User user) {
        return rows(List.of(user)).get(0);
    }

    /** One identity query and one pending-grant query for the whole page, not one per row. */
    List<AdminUserRow> rows(List<User> page) {
        List<UUID> ids = page.stream().map(User::getId).toList();
        Set<UUID> identityBacked = identity.verifiedAmong(
                page.stream().filter(User::isVerified).map(User::getId).toList());
        Set<UUID> pending = ids.isEmpty() ? Set.of()
                : Set.copyOf(badgeRequests.userIdsWithStatus(ids, BadgeGrantStatuses.PENDING));
        return page.stream().map(user -> {
            UserResponse base = mapper.toResponse(user);
            String source = !user.isVerified() ? null
                    : identityBacked.contains(user.getId()) ? BADGE_FROM_IDENTITY : BADGE_BY_HAND;
            return new AdminUserRow(base.id(), base.name(), MobileMask.mask(base.mobile()), base.role(),
                    base.status(), base.verified(), base.city(), base.listingsCount(),
                    base.joinedAt() != null ? base.joinedAt() : base.createdAt(),
                    user.isFlagged(), user.getFlagReason(), source, pending.contains(user.getId()));
        }).toList();
    }

    long pendingBadgeGrants() {
        return badgeRequests.countByStatus(BadgeGrantStatuses.PENDING);
    }

    private String badgeSource(User user) {
        if (!user.isVerified()) {
            return null;
        }
        return identity.isVerified(user.getId()) ? BADGE_FROM_IDENTITY : BADGE_BY_HAND;
    }
}
