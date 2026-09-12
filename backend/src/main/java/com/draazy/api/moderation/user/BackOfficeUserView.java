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
 * The back office's view of somebody else's account: how it is looked up, and how it goes onto the
 * wire.
 *
 * <p><strong>Not a helper named after its parent.</strong> {@code package-structure.md} §4.1 warns
 * against splitting a service into {@code XService} + {@code XServiceHelper}, because both files
 * still have to be read together and the parent keeps every responsibility it had. This is the other
 * kind of split: it owns one decision — <em>what a back-office caller is allowed to see of another
 * person</em> — and it is shared by two services that otherwise have nothing to do with each other
 * ({@link UserAdminService}, which administers the directory, and {@link UserModerationService},
 * which acts on a person). Duplicating it in both would be the real hazard: the two copies would
 * drift, and the drift would be one of them quietly serving an unmasked mobile.
 *
 * <p><strong>The masking asymmetry it exists to hold.</strong> A list masks; a single-user read does
 * not, and writes an audit row for the reveal. Ops genuinely need a phone number to act on a case,
 * so refusing it would push the work off-platform — but a paged list hands over thousands of numbers
 * per request for the cost of one click, which is a bulk-export surface wearing the clothes of a
 * search screen.
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
     * optionally redacted.
     *
     * <p>One method rather than two near-identical twenty-argument constructor calls. The record has
     * grown past the point where a positional copy is readable, and the failure mode of getting one
     * wrong is silent — two adjacent {@code boolean}s or two adjacent {@code Instant}s transpose
     * with no compiler complaint and no test unless something happens to assert that exact field.
     */
    private UserResponse project(User user, boolean maskMobile) {
        UserResponse base = mapper.toResponse(user);
        return new UserResponse(base.id(), base.name(),
                maskMobile ? MobileMask.mask(base.mobile()) : base.mobile(), base.email(),
                base.role(), base.team(), base.status(), base.verified(), base.city(),
                base.mobileVerified(), base.aadhaarVerified(), base.verifiedContactOnly(),
                base.hideNumber(), base.listingsCount(), base.joinedAt(), base.lastActive(),
                base.createdAt(), base.permissions(),
                // Boxed, and only on the back-office routes: see UserResponse#flagged for why a
                // plain false would be the wrong answer on GET /auth/me.
                user.isFlagged(), user.getFlagReason());
    }
}
