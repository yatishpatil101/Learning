package com.draazy.api.billing.referral;

import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

/** Batch-loads referrer name and referee tally to avoid N+1. */
@Component
public class ReferralMapper {

    private final UserRepository users;

    public ReferralMapper(UserRepository users) {
        this.users = users;
    }

    public ReferralDto toDto(Referral referral) {
        return toDtos(List.of(referral)).getFirst();
    }

    public List<ReferralDto> toDtos(List<Referral> referrals) {
        if (referrals.isEmpty()) {
            return List.of();
        }
        Set<UUID> referrerIds = referrals.stream()
                .map(Referral::getReferrerId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        Map<UUID, String> names = new HashMap<>();
        if (!referrerIds.isEmpty()) {
            for (User u : users.findAllById(referrerIds)) {
                names.put(u.getId(), u.getName());
            }
        }
        Set<String> referredMobiles = referrals.stream()
                .map(Referral::getReferredMobile)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        Map<String, Boolean> hasListed = new HashMap<>();
        if (!referredMobiles.isEmpty()) {
            for (User u : users.findAllByMobileIn(referredMobiles)) {
                hasListed.put(u.getMobile(), u.getListingsCount() > 0);
            }
        }
        return referrals.stream().map(r -> new ReferralDto(
                r.getId().toString(),
                names.get(r.getReferrerId()),
                r.getReferrerMobile(),
                r.getReferred(),
                r.getReferredMobile(),
                channelOf(r, hasListed),
                r.getShareChannel(),
                r.getReward(),
                r.getRewardAmount(),
                r.getStatus(),
                r.getRisk(),
                r.isIdentityVerified(),
                r.isIdentityUnique(),
                r.isSameDevice(),
                r.isSameIp(),
                r.isVelocityHigh(),
                r.isActivated(),
                r.getAt(),
                r.getQualifiedAt(),
                r.getHandledBy(),
                r.getHandledAt())).toList();
    }

    /** Reads the side from the current tally, falling back to the stored value if the mobile can't be resolved. */
    private static String channelOf(Referral r, Map<String, Boolean> hasListed) {
        Boolean listed = hasListed.get(r.getReferredMobile());
        if (listed == null) {
            return r.getChannel();
        }
        return Boolean.TRUE.equals(listed) ? "owner" : "seeker";
    }
}
