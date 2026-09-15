package com.draazy.api.identity.user;

import com.draazy.api.security.AccountPermissions;
import com.draazy.api.security.Roles;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * Caller's own profile — {@link UserMapper}'s output plus resolved back-office permission atoms
 * (four routes return the caller to themselves and all four must fill this uniformly).
 */
@Component
public class SelfProfile {

    private final UserMapper userMapper;
    private final AccountPermissions accountPermissions;

    public SelfProfile(UserMapper userMapper, AccountPermissions accountPermissions) {
        this.userMapper = userMapper;
        this.accountPermissions = accountPermissions;
    }

    /**
     * Projects a user as their own profile. Non-staff get {@code permissions} null (dropped by
     * {@code NON_NULL}); staff/admin get the role-ceiling-intersected list, possibly empty.
     */
    public UserResponse of(User user) {
        UserResponse base = userMapper.toResponse(user);
        if (!backOffice(user.getRole())) {
            return base;
        }
        List<String> atoms =
                List.copyOf(accountPermissions.effectiveFor(user.getRole(), user.getId()));
        return new UserResponse(base.id(), base.name(), base.mobile(), base.email(), base.role(),
                base.team(), base.status(), base.verified(), base.city(), base.mobileVerified(),
                base.verifiedContactOnly(), base.hideNumber(),
                base.listingsCount(), base.joinedAt(), base.lastActive(), base.createdAt(), atoms,
                // Nulls on purpose, and NON_NULL drops both keys: the review flag is a note between
                // moderators about this person, and this is the one route that serves it *to* them.
                null, null);
    }

    private static boolean backOffice(String wireRole) {
        return Roles.Wire.STAFF.equals(wireRole) || Roles.Wire.ADMIN.equals(wireRole);
    }
}
