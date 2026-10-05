package com.draazy.api.identity.user;

import com.draazy.api.security.AccountPermissions;
import com.draazy.api.security.Roles;
import java.util.List;
import org.springframework.stereotype.Component;

// Four routes return the caller to themselves, so each must resolve permissions uniformly.
@Component
public class SelfProfile {

    private final UserMapper userMapper;
    private final AccountPermissions accountPermissions;

    public SelfProfile(UserMapper userMapper, AccountPermissions accountPermissions) {
        this.userMapper = userMapper;
        this.accountPermissions = accountPermissions;
    }

    // Consumer accounts get permissions null; back-office accounts get the resolved atom list.
    public UserResponse of(User user) {
        UserResponse base = userMapper.toResponse(user);
        List<String> desks = Roles.isBackOffice(user.getRole())
                ? accountPermissions.desksFor(user.getRole(), user.getId()).stream().sorted().toList()
                : List.of();
        if (!Roles.isBackOffice(user.getRole())) {
            return new UserResponse(base.id(), base.name(), base.mobile(), base.email(), base.role(),
                    base.team(), base.status(), base.verified(), base.city(), base.mobileVerified(),
                    base.verifiedContactOnly(), base.hideNumber(), base.shareActivityStatus(),
                    base.shareReadReceipts(), base.listingsCount(), base.joinedAt(),
                    base.lastActive(), base.createdAt(), null, desks, null, null, null);
        }
        List<String> atoms =
                List.copyOf(accountPermissions.effectiveFor(user.getRole(), user.getId()));
        return new UserResponse(base.id(), base.name(), base.mobile(), base.email(), base.role(),
                base.team(), base.status(), base.verified(), base.city(), base.mobileVerified(),
                base.verifiedContactOnly(), base.hideNumber(), base.shareActivityStatus(),
                base.shareReadReceipts(),
                base.listingsCount(), base.joinedAt(), base.lastActive(), base.createdAt(), atoms,
                desks, null, null, null);
    }
}
