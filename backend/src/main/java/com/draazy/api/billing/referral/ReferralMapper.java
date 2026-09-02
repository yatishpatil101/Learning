package com.draazy.api.billing.referral;

import com.draazy.api.common.trust.MobileMask;
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

/**
 * Entity→wire projection for the referral fraud desk.
 *
 * <p>Batch-loaded: the contract's {@code Referral} carries the referrer's <em>name</em>, which lives
 * on {@code users}, so a per-row lookup would be an N+1 across every page of the queue.
 * {@link #toDtos} issues one extra query whatever the page size. It resolves the <em>referred</em>
 * party the same way, for {@link #channelOf} — two queries per page, not two per row.
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
                masked(r.getReferrerMobile()),
                r.getReferred(),
                masked(r.getReferredMobile()),
                channelOf(r, hasListed),
                r.getShareChannel(),
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
                r.getQualifiedAt(),
                r.getHandledBy(),
                r.getHandledAt())).toList();
    }

    /**
     * Which side of the marketplace the referred party is on, read <strong>now</strong> rather than
     * off {@link Referral#getChannel()}.
     *
     * <p>The stored column is a snapshot taken inside {@code redeem}, and redemption fires from
     * {@code Signup.jsx} in the same handler as registration — so the account it describes is
     * seconds old and has necessarily posted nothing. Frozen, the column can only ever say
     * {@code seeker}, which is why the desk's "Owner referral / Seeker referral" subtitle has never
     * once said the former. Freezing is right for {@link Referral#getReward()}, which restates a
     * promise made to the referrer and must not drift when a campaign changes; it is wrong here,
     * because "which side did they turn out to be on" is a description of the referred party that
     * only becomes answerable after they act.
     *
     * <p>This mirrors {@code approve}, which already reads the referred party's <em>current</em>
     * Aadhaar badge rather than {@link Referral#isAadhaarVerified()} for the same reason: the
     * ordinary path is to redeem first and do the thing second. The snapshot columns stay on the row
     * as evidence of what was true at redemption; neither is what a decision reads.
     *
     * <p>Falls back to the stored value when the mobile resolves to no account — an erased referee,
     * or a row predating the account. Two values only, per the contract, so an unresolvable row
     * reports what it was born with rather than putting a third state on the wire.
     */
    private static String channelOf(Referral r, Map<String, Boolean> hasListed) {
        Boolean listed = hasListed.get(r.getReferredMobile());
        if (listed == null) {
            return r.getChannel();
        }
        return Boolean.TRUE.equals(listed) ? "owner" : "seeker";
    }

    /** See the class Javadoc for why this is private and hand-written. */
    private static String masked(String mobile) {
        return MobileMask.mask(mobile);
    }
}
