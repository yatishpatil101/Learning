package com.draazy.api.finance.tenancy;

import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.common.trust.VerifiedTenantLookup;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.identity.verification.IdentityVerificationRepository;
import com.draazy.api.identity.verification.VerificationStatuses;
import com.draazy.api.leads.contact.ContactRequestRepository;
import com.draazy.api.leads.contact.ContactRequestStatuses;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TenantProfileService implements VerifiedTenantLookup {

    public static final int MAX_VERIFIED_BATCH = 50;

    private final TenantProfileRepository profiles;
    private final UserRepository users;
    private final TenancyRepository tenancies;
    private final ContactRequestRepository contactRequests;
    private final IdentityVerificationRepository verifications;
    private final TenantProfileMapper profileMapper;

    public TenantProfileService(TenantProfileRepository profiles,
                                UserRepository users,
                                TenancyRepository tenancies,
                                ContactRequestRepository contactRequests,
                                IdentityVerificationRepository verifications,
                                TenantProfileMapper profileMapper) {
        this.profiles = profiles;
        this.users = users;
        this.tenancies = tenancies;
        this.contactRequests = contactRequests;
        this.verifications = verifications;
        this.profileMapper = profileMapper;
    }

    @Transactional(readOnly = true)
    public TenantProfileDto getMine(UUID callerId) {
        User caller = requireUser(callerId);
        return profiles.findById(callerId)
                .map(profile -> TenancyMapper.toDto(profile, caller.getMobile(), true))
                .orElseGet(() -> TenancyMapper.emptyProfile(caller.getMobile(), isVerified(callerId)));
    }

    @Transactional
    public TenantProfileDto updateMine(UUID callerId, TenantProfileUpdateRequest body) {
        if (!OccupantTypes.isValid(body.occupants())) {
            throw new BadRequestException(
                    "occupants must be one of: family, bachelor_male, bachelor_female, company_lease");
        }
        User caller = requireUser(callerId);
        TenantProfile profile = profiles.findById(callerId).orElseGet(() -> new TenantProfile(callerId));

        profileMapper.applyTo(body, profile);

        profile.setVerified(isVerified(callerId));
        profile.setScore(score(profile));

        return TenancyMapper.toDto(profiles.save(profile), caller.getMobile(), true);
    }

    @Transactional(readOnly = true)
    public List<TenantVerifiedDto> verifiedByMobile(UUID callerId, List<String> mobiles) {
        List<String> asked = mobiles == null ? List.of() : mobiles;
        if (asked.size() > MAX_VERIFIED_BATCH) {
            throw new BadRequestException(
                    "mobiles must contain at most " + MAX_VERIFIED_BATCH + " entries per request");
        }

        Map<String, UUID> resolved = new HashMap<>();
        Set<String> looked = new HashSet<>();
        for (String raw : asked) {
            String normalised = MobileMask.normalise(raw);
            if (normalised == null || !looked.add(normalised)) {
                continue;
            }
            users.findByMobile(normalised).ifPresent(user -> resolved.put(normalised, user.getId()));
        }

        Set<UUID> verified = profiles.findAllById(resolved.values()).stream()
                .filter(TenantProfile::isVerified)
                .map(TenantProfile::getUserId)
                .collect(Collectors.toSet());

        Map<UUID, Boolean> relationships = new HashMap<>();
        List<TenantVerifiedDto> answer = new ArrayList<>(asked.size());
        for (String raw : asked) {
            UUID targetId = resolved.get(MobileMask.normalise(raw));
            answer.add(new TenantVerifiedDto(raw, maySeeBadge(callerId, targetId, verified, relationships)));
        }
        return answer;
    }

    @Override
    @Transactional(readOnly = true)
    public Set<UUID> verifiedAmong(Collection<UUID> userIds) {
        if (userIds == null || userIds.isEmpty()) {
            return Set.of();
        }
        List<UUID> distinct = userIds.stream().filter(Objects::nonNull).distinct().toList();
        if (distinct.isEmpty()) {
            return Set.of();
        }

        return profiles.findAllById(distinct).stream()
                .filter(TenantProfile::isVerified)
                .map(TenantProfile::getUserId)
                .collect(Collectors.toSet());
    }

    // Badge visible only when it exists and the caller is entitled.
    // Unverified short-circuits before the relationship queries; both branches produce indistinguishable `false`.
    private boolean maySeeBadge(UUID callerId, UUID targetId, Set<UUID> verified,
                                Map<UUID, Boolean> relationships) {
        if (targetId == null || !verified.contains(targetId)) {
            return false;
        }
        if (targetId.equals(callerId)) {
            return true;
        }
        return relationships.computeIfAbsent(targetId, id ->
                tenancies.existsBetween(callerId, id)
                        || contactRequests.existsApprovedForOwner(
                                id, callerId, ContactRequestStatuses.APPROVED));
    }

    static int score(TenantProfile profile) {
        int total = 0;
        if (profile.isVerified()) {
            total += 30;
        }
        if (isPresent(profile.getOccupation())) {
            total += 20;
        }
        if (profile.getIncome() != null && profile.getIncome() > 0) {
            total += 15;
        }
        if (isPresent(profile.getPriorLandlord())) {
            total += 15;
        }
        if (isPresent(profile.getAbout())) {
            total += 10;
        }
        if (isPresent(profile.getOccupants())) {
            total += 10;
        }
        return Math.min(100, total);
    }

    private static boolean isPresent(String value) {
        return value != null && !value.isBlank();
    }

    private boolean isVerified(UUID userId) {
        return verifications.findByUserId(userId)
                .map(verification -> VerificationStatuses.VERIFIED.equals(verification.getStatus()))
                .orElse(false);
    }

    private User requireUser(UUID callerId) {
        return users.findById(callerId)
                .orElseThrow(() -> NotFoundException.of("User"));
    }
}
