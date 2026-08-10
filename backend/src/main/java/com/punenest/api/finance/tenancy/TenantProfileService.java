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
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
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

    /**
     * The largest batch {@link #verifiedByMobile} will answer.
     *
     * <p>An unbounded list is an amplification primitive: one small request buying an unbounded
     * amount of database work, from any authenticated caller. The number is sized for the thing
     * this exists for — the longest list a screen renders at once is a page of offers or applicants,
     * which is tens of rows, not hundreds — so no legitimate client should ever meet it. A client
     * that does should page, and the 400 says so rather than silently truncating: an answer for
     * half a list, wearing the shape of an answer for the whole one, would blank badges that were
     * earned and nobody would notice.
     */
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
     * Contract {@code tenantsVerified} — the badge, for a whole list at once (tech-debt D114).
     *
     * <p><strong>Why this exists.</strong> The verified tick renders beside every row of a list —
     * every offer on a property, every applicant, every reviewer — and each row is about somebody
     * else. {@link #getByMobile} answers for one person, so a client doing it per row is an N+1 on
     * a render path. This is the same question asked once for the whole list.
     *
     * <p><strong>It answers a flag and only a flag.</strong> {@link #getByMobile} hands a related
     * caller a tenant's name, occupation and income; that is a screening read, made deliberately,
     * about one person. Reusing it per row would move a list's worth of somebody's income across
     * the wire to draw a tick. So this returns one bit per entry and never a reason: "no such
     * number", "registered but not verified" and "not your business" are all {@code false}, which
     * is the same refusal shape spec fix S10 chose for the single read, for the same reason. A
     * caller cannot use this to discover whether a number is registered at all.
     *
     * <p><strong>The relationship guard is not relaxed.</strong> An entry answers {@code true} only
     * if the caller could have read that profile through {@link #getByMobile} — an existing tenancy
     * either way round, or an approved contact request against one of the caller's listings. A
     * batch that skipped the guard would be a strictly cheaper way to ask a question the single
     * read refuses, which is how a guard gets quietly deleted.
     *
     * <p><strong>The stored flag, not a live badge lookup.</strong> {@code verified} is read from
     * the same {@code tenant_profiles} column {@link #getByMobile} returns, so the two endpoints
     * cannot disagree about the same person. It is refreshed whenever the tenant saves their
     * profile, so a tenant who verifies afterwards is briefly stale — and stale here means
     * <em>no badge</em>, never a badge nobody earned.
     *
     * @param mobiles the numbers as the caller has them; echoed back unchanged
     * @throws BadRequestException when the batch is larger than {@link #MAX_VERIFIED_BATCH}
     */
    @Transactional(readOnly = true)
    public List<TenantVerifiedDto> verifiedByMobile(UUID callerId, List<String> mobiles) {
        List<String> asked = mobiles == null ? List.of() : mobiles;
        if (asked.size() > MAX_VERIFIED_BATCH) {
            throw new BadRequestException(
                    "mobiles must contain at most " + MAX_VERIFIED_BATCH + " entries per request");
        }

        // Resolve each *distinct* number once. A caller who repeats one number a hundred times must
        // not buy a hundred lookups with it — the cap bounds the list, this bounds the work behind
        // a list that is within the cap.
        Map<String, UUID> resolved = new HashMap<>();
        Set<String> looked = new HashSet<>();
        for (String raw : asked) {
            String normalised = MobileMask.normalise(raw);
            if (normalised == null || !looked.add(normalised)) {
                continue;
            }
            users.findByMobile(normalised).ifPresent(user -> resolved.put(normalised, user.getId()));
        }

        // One query for every profile in the batch, rather than one per row.
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

    /**
     * Whether this caller may see a badge on this person — the badge exists <em>and</em> the caller
     * is entitled to know.
     *
     * <p>The unverified case short-circuits before the relationship queries. That is a cost
     * decision, not a security one, and it is safe precisely because both branches produce the same
     * {@code false}: nothing about the response distinguishes "there was no badge to show you" from
     * "there was, and you are a stranger". Ordering the checks the other way would double the
     * queries on the common row for no observable difference.
     */
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
