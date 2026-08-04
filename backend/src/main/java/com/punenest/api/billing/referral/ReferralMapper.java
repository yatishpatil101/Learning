package com.punenest.api.billing.referral;

import com.punenest.api.common.trust.MobileMask;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Entity→wire projection for the referral fraud desk.
 *
 * <p>Batch-loaded: the contract's {@code Referral} carries the referrer's <em>name</em>, which lives
 * on {@code users}, so a per-row lookup would be an N+1 across every page of the queue.
 * {@link #toDtos} issues one extra query whatever the page size.
 *
 * <p><strong>The masking is hand-written and private, deliberately.</strong> {@code api-standards.md}
 * §8.1: a {@code String → String} helper visible to a generator gets adopted as an implicit
 * converter and silently applied to unrelated fields. Both mobiles go through {@link #masked} and
 * nothing in this class returns a raw one.
 */
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
                .collect(java.util.stream.Collectors.toCollection(HashSet::new));
        Map<UUID, String> names = new HashMap<>();
        if (!referrerIds.isEmpty()) {
            for (User u : users.findAllById(referrerIds)) {
                names.put(u.getId(), u.getName());
            }
        }
        return referrals.stream().map(r -> new ReferralDto(
                r.getId().toString(),
                names.get(r.getReferrerId()),
                masked(r.getReferrerMobile()),
                r.getReferred(),
                masked(r.getReferredMobile()),
                r.getChannel(),
                r.getReward(),
                r.getRewardAmount(),
                r.getStatus(),
                r.getRisk(),
                r.isAadhaarVerified(),
                r.isAadhaarUnique(),
                r.isSameDevice(),
                r.isSameIp(),
                r.isVelocityHigh(),
                r.isActivated(),
                r.getAt(),
                r.getHandledBy(),
                r.getHandledAt())).toList();
    }

    /** See the class Javadoc for why this is private and hand-written. */
    private static String masked(String mobile) {
        return MobileMask.mask(mobile);
    }
}
