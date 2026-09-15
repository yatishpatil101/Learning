package com.draazy.api.billing.referral;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.settings.PlatformSettings;
import com.draazy.api.common.web.Ids;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.AuthPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Referral scheme: caller's code and rewards, and the ops desk that decides validity.
 * Rationale: docs/flows/consumer/plans-billing-refer.md and docs/flows/ops/referrals-fraud.md.
 */
@Service
public class ReferralService {

    /** Prefix of every code, so a pasted string is recognisable as ours. */
    private static final String CODE_PREFIX = "PUNE-";

    /** Alphabet excludes I, O, 0, 1: codes are dictated aloud and typo-prone. */
    private static final String CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    /** Random characters after the prefix. 32^4 ≈ 1M codes — ample against a Pune-sized user base. */
    private static final int CODE_LENGTH = 4;

    /** Attempts before giving up on a unique code. Each collision is ~1-in-a-million. */
    private static final int CODE_ATTEMPTS = 5;

    /** Window and threshold for the velocity signal. */
    private static final Duration VELOCITY_WINDOW = Duration.ofDays(1);
    private static final long VELOCITY_LIMIT = 5;

    private static final String RISK_LOW = "low";
    private static final String RISK_MEDIUM = "medium";
    private static final String RISK_HIGH = "high";

    private static final SecureRandom RANDOM = new SecureRandom();

    private final ReferralRepository referrals;
    private final ReferralCodeRepository codes;
    private final ReferralMapper mapper;
    private final UserRepository users;
    private final PlatformSettings settings;
    private final ReferralSignals signals;
    private final AuditService audit;

    public ReferralService(ReferralRepository referrals, ReferralCodeRepository codes,
            ReferralMapper mapper, UserRepository users, PlatformSettings settings,
            ReferralSignals signals, AuditService audit) {
        this.referrals = referrals;
        this.codes = codes;
        this.mapper = mapper;
        this.users = users;
        this.settings = settings;
        this.signals = signals;
        this.audit = audit;
    }

    /** {@code GET /me/referrals} — mints on first read. Rationale: docs/flows/ops/referrals-fraud.md. */
    @Transactional
    public ReferralSummaryDto summary(AuthPrincipal caller, HttpServletRequest request) {
        String code = codeFor(caller.userId(), request);
        List<Referral> mine = referrals.findByReferrerId(caller.userId());

        int converted = 0;
        long earned = 0;
        long pending = 0;
        for (Referral r : mine) {
            if (ReferralStatuses.isGranting(r.getStatus())) {
                converted++;
                earned += r.getRewardAmount();
            } else if (ReferralStatuses.PENDING.equals(r.getStatus())) {
                pending += r.getRewardAmount();
            }
        }
        return new ReferralSummaryDto(code, mine.size(), converted,
                Math.toIntExact(earned), Math.toIntExact(pending));
    }

    /**
     * {@code POST /referrals/redeem} — 200, or a single indistinguishable 409.
     * Rationale: docs/flows/ops/referrals-fraud.md.
     */
    @Transactional
    public void redeem(AuthPrincipal caller, String rawCode, String shareChannel,
            HttpServletRequest request) {
        User referred = users.findById(caller.userId())
                .orElseThrow(() -> NotFoundException.of("User"));

        String code = normalise(rawCode);
        Optional<ReferralCode> owner = code == null ? Optional.empty() : codes.findByCode(code);
        if (owner.isEmpty()
                || owner.get().getUserId().equals(caller.userId())
                || referrals.existsByReferredMobile(referred.getMobile())) {
            throw refuse();
        }

        User referrer = users.findById(owner.get().getUserId()).orElseThrow(this::refuse);
        long reward = settings.referralContactBonus();
        boolean velocityHigh = referrals.countByReferrerIdAndAtAfter(
                referrer.getId(), Instant.now().minus(VELOCITY_WINDOW)) >= VELOCITY_LIMIT;

        ReferralSignals.Signals observed = signals.of(request);
        boolean sameIp = ReferralSignals.matches(owner.get().getReferrerIpHash(), observed.ipHash());
        boolean sameDevice =
                ReferralSignals.matches(owner.get().getReferrerDeviceHash(), observed.deviceHash());

        Referral referral = new Referral(
                referrer.getId(),
                referrer.getMobile(),
                referred.getName(),
                referred.getMobile(),
                channelOf(referred),
                ShareChannels.normalise(shareChannel),
                // Frozen label in the promised unit so a bonus change never restates old offers.
                "+" + reward + " owner contacts",
                reward,
                risk(velocityHigh, referred.isVerified(), sameDevice || sameIp),
                referred.isVerified(),
                // Identity uniqueness is guaranteed by the identity-hash constraint upstream.
                referred.isVerified(),
                velocityHigh,
                sameDevice,
                sameIp,
                observed);
        try {
            referrals.saveAndFlush(referral);
        } catch (DataIntegrityViolationException raced) {
            // Concurrent redemption for the same mobile; return the same 409 as every other refusal.
            throw refuse();
        }
    }

    /**
     * {@code GET /referrals} (spec fix S53, {@code x-roles: [staff, admin]}) — the paged queue.
     *
     * <p>Paged because it grows with the platform, not with one user (api-standards §5.1).
     */
    @Transactional(readOnly = true)
    public Page<ReferralDto> queue(String status, String risk, Pageable pageable) {
        Page<Referral> page = referrals.queue(blankToNull(status), blankToNull(risk), pageable);
        // why not page.map(mapper::toDto): that would resolve the referrer's name one row at a
        // time. toDtos resolves the whole page in a single query.
        return new PageImpl<>(mapper.toDtos(page.getContent()), pageable, page.getTotalElements());
    }

    /**
     * {@code POST /referrals/{id}/approve} — releases the reward; requires a current identity badge.
     * Rationale: docs/flows/ops/referrals-fraud.md.
     */
    @Transactional
    public ReferralDto approve(AuthPrincipal actor, String id) {
        return decide(actor, id, ReferralStatuses.REWARDED, null, r -> {
            if (!ReferralStatuses.isReviewable(r.getStatus())) {
                return illegalMove(r, ReferralStatuses.REWARDED);
            }
            return identityVerifiedNow(r) ? null
                    : "The referred party is not identity-verified, so this reward cannot be released.";
        }, "referral.approve");
    }

    /** Whether the referred party holds the identity badge right now. See {@link #approve}. */
    private boolean identityVerifiedNow(Referral referral) {
        return users.findByMobile(referral.getReferredMobile())
                .map(User::isVerified)
                .orElse(false);
    }

    /** {@code POST /referrals/{id}/reject} — refuses the reward, with a reason. */
    @Transactional
    public ReferralDto reject(AuthPrincipal actor, String id, String reason) {
        return decide(actor, id, ReferralStatuses.REJECTED, reason,
                r -> ReferralStatuses.isReviewable(r.getStatus()) ? null
                        : illegalMove(r, ReferralStatuses.REJECTED),
                "referral.reject");
    }

    /**
     * {@code POST /referrals/{id}/clawback} — reverses a released reward. Only {@code rewarded} is
     * clawable, so history is never rewritten to say something was paid when it was not.
     */
    @Transactional
    public ReferralDto clawback(AuthPrincipal actor, String id, String reason) {
        return decide(actor, id, ReferralStatuses.CLAWED_BACK, reason,
                r -> ReferralStatuses.REWARDED.equals(r.getStatus()) ? null
                        : illegalMove(r, ReferralStatuses.CLAWED_BACK),
                "referral.clawback");
    }

    /** The refusal sentence for a move the status vocabulary does not allow. */
    private static String illegalMove(Referral referral, String nextStatus) {
        return "Referral is " + referral.getStatus() + " and cannot be " + nextStatus;
    }

    /**
     * Single write-locked state transition; {@code refusal} returns the exact sentence to send back.
     * Rationale: docs/flows/ops/referrals-fraud.md.
     */
    private ReferralDto decide(AuthPrincipal actor, String id, String nextStatus, String reason,
            java.util.function.Function<Referral, String> refusal, String action) {
        Referral referral = Ids.parseUuid(id)
                .flatMap(referrals::findForDecision)
                .orElseThrow(() -> NotFoundException.of("Referral"));
        String refused = refusal.apply(referral);
        if (refused != null) {
            throw new ConflictException(refused);
        }
        referral.decide(nextStatus, actor.userId().toString(), blankToNull(reason));
        referrals.saveAndFlush(referral);
        // Audit key names the unit ("contacts") so the trail survives the D31b unit change.
        audit.record(actor, action, "referral", referral.getId().toString(),
                "contacts", String.valueOf(referral.getRewardAmount()));
        return mapper.toDto(referral);
    }

    /**
     * The caller's code, minting one on first read.
     * Looks before leaping since a constraint violation would poison the persistence context.
     */
    private String codeFor(UUID userId, HttpServletRequest request) {
        Optional<ReferralCode> existing = codes.findById(userId);
        if (existing.isPresent()) {
            return existing.get().getCode();
        }
        ReferralSignals.Signals observed = signals.of(request);
        for (int attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
            String candidate = generateCode();
            if (!codes.existsByCode(candidate)) {
                return codes.saveAndFlush(new ReferralCode(userId, candidate, observed)).getCode();
            }
        }
        throw new IllegalStateException("Could not mint a unique referral code for " + userId);
    }

    private static String generateCode() {
        StringBuilder code = new StringBuilder(CODE_PREFIX);
        for (int i = 0; i < CODE_LENGTH; i++) {
            code.append(CODE_ALPHABET.charAt(RANDOM.nextInt(CODE_ALPHABET.length())));
        }
        return code.toString();
    }

    /** Codes are dictated aloud and pasted with stray spaces; store and match one canonical form. */
    private static String normalise(String code) {
        if (code == null) {
            return null;
        }
        String trimmed = code.trim().toUpperCase(java.util.Locale.ROOT);
        return trimmed.isEmpty() ? null : trimmed;
    }

    /**
     * Snapshot at redemption; queue displays the current value via {@link ReferralMapper#channelOf}.
     * Rationale: docs/flows/ops/referrals-fraud.md.
     */
    private static String channelOf(User referred) {
        return referred.getListingsCount() > 0 ? "owner" : "seeker";
    }

    /**
     * Risk band for the desk. Correlation raises the band rather than refusing, since a shared flat
     * or router is the common shape of a real referral. Rationale: docs/flows/ops/referrals-fraud.md.
     */
    private static String risk(boolean velocityHigh, boolean identityVerified, boolean correlated) {
        if (velocityHigh) {
            return RISK_HIGH;
        }
        if (correlated) {
            return RISK_MEDIUM;
        }
        return identityVerified ? RISK_LOW : RISK_MEDIUM;
    }

    /** The single, undifferentiated refusal. See {@link #redeem}. */
    private ConflictException refuse() {
        return new ConflictException("That referral code cannot be redeemed");
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
