package com.punenest.api.finance.tenancy;

import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.trust.MobileMask;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.identity.verification.IdentityVerificationRepository;
import com.punenest.api.identity.verification.VerificationStatuses;
import com.punenest.api.leads.contact.ContactRequestRepository;
import com.punenest.api.leads.contact.ContactRequestStatuses;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The tenant screening profile — the tenant's own read/write, and the guarded owner-side read.
 *
 * <p><strong>The score is server-computed and that is the whole point</strong> (spec fix S17). It is
 * the number an owner uses to decide who to let into their flat, so a tenant who could set it would
 * be grading their own paper. {@link #score} is recomputed on every save from the stored fields;
 * nothing accepts it from a client.
 */
@Service
public class TenantProfileService {

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

    /**
     * Contract {@code getTenantProfile} — the caller's own profile.
     *
     * <p>Returns an empty profile rather than 404 when none has been saved. "You have not filled
     * this in yet" is not an error, and a 404 would force the client to special-case a status code
     * just to render a blank form.
     */
    @Transactional(readOnly = true)
    public TenantProfileDto getMine(UUID callerId) {
        User caller = requireUser(callerId);
        return profiles.findById(callerId)
                .map(profile -> TenancyMapper.toDto(profile, caller.getMobile(), true))
                .orElseGet(() -> TenancyMapper.emptyProfile(caller.getMobile(), isVerified(callerId)));
    }

    /**
     * Contract {@code updateTenantProfile} — replace the caller's profile and return it with a
     * freshly computed score.
     *
     * @throws BadRequestException when {@code occupants} is not a recognised value
     */
    @Transactional
    public TenantProfileDto updateMine(UUID callerId, TenantProfileUpdateRequest body) {
        if (!OccupantTypes.isValid(body.occupants())) {
            throw new BadRequestException(
                    "occupants must be one of: family, bachelor_male, bachelor_female, company_lease");
        }
        User caller = requireUser(callerId);
        TenantProfile profile = profiles.findById(callerId).orElseGet(() -> new TenantProfile(callerId));

        // PUT replaces: an absent field clears the stored value. See TenantProfileUpdateRequest.
        // The mapper's allowlist decides which fields that covers.
        profileMapper.applyTo(body, profile);

        // verified mirrors the Aadhaar badge and is never taken from the request; recomputed here so
        // a tenant who verifies after saving sees the badge without having to save again.
        profile.setVerified(isVerified(callerId));
        profile.setScore(score(profile));

        return TenancyMapper.toDto(profiles.save(profile), caller.getMobile(), true);
    }

    /**
     * Contract {@code getTenantProfileByMobile} — an owner screening a tenant they are actually
     * dealing with (spec fix S10).
     *
     * <p><strong>404, never 403, for every failure.</strong> Unregistered mobile, no profile saved,
     * no relationship — all the same answer. The endpoint is keyed by the exact identifier the
     * contact gate exists to protect, so any response that distinguishes "no such number" from "that
     * number exists but you may not see it" turns it into the mobile-enumeration oracle the guard
     * was added to close.
     *
     * <p>The relationship is either an existing tenancy in either direction, or an approved contact
     * request from that person against one of the caller's listings — the two ways a stranger
     * legitimately becomes someone whose income the caller has a reason to see.
     */
    @Transactional(readOnly = true)
    public TenantProfileDto getByMobile(UUID callerId, String rawMobile) {
        String mobile = MobileMask.normalise(rawMobile);
        if (mobile == null) {
            throw NotFoundException.of("Tenant profile");
        }
        Optional<User> target = users.findByMobile(mobile);
        if (target.isEmpty()) {
            throw NotFoundException.of("Tenant profile");
        }
        UUID targetId = target.get().getId();
        if (targetId.equals(callerId)) {
            return getMine(callerId);
        }
        boolean related = tenancies.existsBetween(callerId, targetId)
                || contactRequests.existsApprovedForOwner(
                        targetId, callerId, ContactRequestStatuses.APPROVED);
        if (!related) {
            throw NotFoundException.of("Tenant profile");
        }
        return profiles.findById(targetId)
                .map(profile -> TenancyMapper.toDto(profile, mobile, false))
                .orElseThrow(() -> NotFoundException.of("Tenant profile"));
    }

    /**
     * The trust score, 0–100 — the mock's formula (<code>lib/store/rent.js</code>), preserved
     * exactly so a tenant's number does not move when the UI stops reading its mock.
     *
     * <p>The weights encode what an owner actually screens on: a verified identity is worth more
     * than everything except occupation, because it is the only field the tenant cannot simply
     * assert. Everything else is self-reported, so each is worth less than the one fact a third
     * party confirmed.
     */
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

    /** Whether the user holds a verified Aadhaar badge. Absence never blocks anything (ADR-019). */
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
