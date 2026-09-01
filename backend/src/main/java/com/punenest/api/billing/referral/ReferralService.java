package com.punenest.api.billing.referral;

import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.settings.PlatformSettings;
import com.punenest.api.common.web.Ids;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.AuthPrincipal;
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
 * The referral scheme: a user's own code and rewards, and the ops desk that decides whether a
 * referral is real.
 *
 * <p><strong>The reward is owner contacts, not money (D31b).</strong> Redemption stamps a label and
 * a magnitude onto the row — "+15 owner contacts", 15 — and those two are what the fraud desk reads
 * and what the audit trail records. Nothing here pays anything out: the referrer's actual
 * entitlement is <em>derived</em> from these rows by {@code billing.entitlement}, by counting the
 * ones {@link ReferralStatuses#isGranting} accepts. That indirection is the point. A stored balance
 * has to be decremented by whoever remembers when a referral is clawed back; a derived one is
 * withdrawn by the clawback itself.
 *
 * <p><strong>A referral now pays without a human, and that is a change.</strong> Q17's automatic
 * {@link ReferralStatuses#QUALIFIED} transition — the referred party's first listing passing
 * ownership verification — used to be a hint for the checker and nothing more. It is now the grant
 * point. {@link #approve} still exists and still matters, because it is what a fraud desk uses to
 * bless a referral that did not qualify on its own, and {@link #clawback} is what takes a grant back.
 * What changed is that an honest referrer no longer waits in a queue for something the platform
 * already verified for itself. The exposure is bounded by the D61 monthly cap and by what is being
 * handed over: the right to ask fifteen owners a question.
 *
 * <p><strong>The rewards "ledger" is the referrals table itself.</strong> Approve and clawback are
 * documented as crediting and debiting a ledger; that ledger is
 * {@code sum(reward_amount) group by status}. A separate double-entry table was considered and
 * rejected: there is nothing to reconcile against — no external rail moves this, the amount is
 * frozen on the row at redemption, and every mutation already carries who decided, when and why.
 * The platform's other ledger, {@code finance.ledger.Transaction}, is the <em>user's own</em> rent
 * and expense book and would be actively wrong as a home for platform-side credits.
 */
@Service
public class ReferralService {

    /** Prefix of every code, so a pasted string is recognisable as ours. */
    private static final String CODE_PREFIX = "PUNE-";

    /**
     * Alphabet for the random half of a code. Deliberately excludes {@code I}, {@code O},
     * {@code 0} and {@code 1}: these codes get read off phone screens and dictated over calls, and
     * a referrer whose reward hinges on someone typing {@code 0} instead of {@code O} loses it.
     */
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

    /**
     * {@code GET /me/referrals} — the caller's code and what their referrals have bought them.
     *
     * <p>Not read-only: the code is minted on first read. Generating it at signup would mean a
     * migration over every existing user and a code for the overwhelming majority who never open
     * this screen; generating it here costs one insert, once, for the people who actually refer.
     *
     * <p>The request is carried in because minting is also when the referrer's half of the D55
     * correlation signals is stamped — see {@link ReferralCode}. Reads after the first do not
     * re-stamp, so this stays one insert and never a write on a repeat read.
     *
     * <p><strong>{@code converted} counts what paid, not what a human blessed (D31b).</strong> It
     * used to mean {@code rewarded} alone, which was correct while a checker was the only thing that
     * released a reward. Now that {@link ReferralStatuses#QUALIFIED} grants on its own, a referrer
     * whose friend has verified a listing would otherwise read "0 converted" beside fifteen contacts
     * they can already spend. The two numbers on this screen have to be able to explain each other.
     */
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
     * {@code POST /referrals/redeem} — 200, or 409.
     *
     * <p><strong>Every refusal is the same 409 with the same message.</strong> An unknown code, your
     * own code and a mobile that has already been referred are indistinguishable to the caller. The
     * alternative leaks: distinct messages turn this endpoint into an oracle for "is {@code PUNE-XXXX}
     * a real code?", which is exactly the reconnaissance step before farming one.
     *
     * <p>{@code shareChannel} is advisory and anything unrecognised is stored as unknown rather than
     * refused — see {@link ShareChannels#normalise}. The request is read for the two D55 digests,
     * which are compared here against the referrer's and then kept only as the booleans the desk
     * sees plus a ninety-day digest.
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
                // The label the fraud desk reads, in the unit the referrer was actually promised
                // (D31b). Frozen on the row at redemption rather than rendered from settings on
                // every read, so a campaign that changes the bonus does not silently restate what
                // someone was offered last month.
                "+" + reward + " owner contacts",
                reward,
                risk(velocityHigh, referred.isAadhaarVerified(), sameDevice || sameIp),
                referred.isAadhaarVerified(),
                // Aadhaar uniqueness is enforced at verification time -- a second account cannot
                // complete a badge against an identity hash the platform already holds
                // (AadhaarAlreadyRegisteredException). So a verified referred party is, by
                // construction, a unique one; there is nothing further to check here.
                referred.isAadhaarVerified(),
                velocityHigh,
                sameDevice,
                sameIp,
                observed);
        try {
            referrals.saveAndFlush(referral);
        } catch (DataIntegrityViolationException raced) {
            // why: two redemptions for the same mobile that both passed the check above before
            // either committed. uq_referrals_referred_mobile (V23) settles it, and the loser gets
            // the same refusal it would have got a millisecond later.
            //
            // Safe to catch here only because nothing below touches the database: the persistence
            // context is unusable after a constraint fires, and this path just builds and throws.
            // Worth keeping rather than letting the generic 409 through, because the refusal must
            // be byte-identical to every other one — see this method's Javadoc.
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
     * {@code POST /referrals/{id}/approve} — releases the reward. Staff or admin only.
     *
     * <p>Refuses unless the referred party is Aadhaar-verified. This is the scheme's one real
     * anti-fraud rule and it lived in the browser until wave 2c: {@code OpsReferrals} greyed out
     * the Approve button under a banner calling the check <em>mandatory</em>, while this endpoint
     * would have released the money to anyone who called it directly.
     *
     * <p>The check reads the referred party's <strong>current</strong> badge, not
     * {@link Referral#isAadhaarVerified()}. That column is {@code updatable = false} — it is a
     * snapshot of the moment the code was redeemed — and the ordinary path is to redeem first and
     * verify afterwards, so gating on the snapshot would permanently refuse the very referrals the
     * scheme is for. A referee who has since gone missing from the user table is refused, because
     * "cannot check" and "checked out" are not the same answer to a question about money.
     *
     * <p>Uniqueness is not checked separately, for the reason recorded in {@link #redeem}: a second
     * account cannot verify an identity hash the platform already holds, so a verified referee is a
     * unique one by construction. The DTO still carries both flags because the desk reads them.
     */
    @Transactional
    public ReferralDto approve(AuthPrincipal actor, String id) {
        return decide(actor, id, ReferralStatuses.REWARDED, null, r -> {
            if (!ReferralStatuses.isReviewable(r.getStatus())) {
                return illegalMove(r, ReferralStatuses.REWARDED);
            }
            return aadhaarVerifiedNow(r) ? null
                    : "The referred party is not Aadhaar-verified, so this reward cannot be released.";
        }, "referral.approve");
    }

    /** Whether the referred party holds an Aadhaar badge right now. See {@link #approve}. */
    private boolean aadhaarVerifiedNow(Referral referral) {
        return users.findByMobile(referral.getReferredMobile())
                .map(User::isAadhaarVerified)
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
     * {@code POST /referrals/{id}/clawback} — reverses a released reward, with a reason.
     *
     * <p>Only a {@code rewarded} referral can be clawed back. Anything else is a 409: clawing back
     * a referral that was never paid would silently rewrite history to say it had been.
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
     * The one place a referral changes state: load, check the transition, stamp, audit.
     *
     * <p>Three near-identical verbs written once. The differences are the target status, whether a
     * reason is carried, and what may refuse the move — everything else, including the audit
     * write that makes a money decision attributable, is identical and must stay that way.
     *
     * <p>{@code refusal} returns null to allow, or the sentence to send back. It returns the
     * sentence rather than a boolean because approve can refuse for two different reasons and a
     * desk told "Referral is pending and cannot be rewarded" about an Aadhaar problem would go
     * looking for a status bug that is not there — {@code pending} is precisely the state approve
     * works from.
     *
     * <p>The row is loaded under a write lock. See {@link ReferralRepository#findForDecision}.
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
        // "contacts", not "amount": the audit trail names the unit, because a bare number in a
        // trail that used to mean rupees and now means owner contacts is a sentence somebody will
        // read wrong in a year (D31b). Old records keep the old key and the old meaning, which is
        // the honest way for an append-only trail to survive a change of currency.
        audit.record(actor, action, "referral", referral.getId().toString(),
                "contacts", String.valueOf(referral.getRewardAmount()));
        return mapper.toDto(referral);
    }

    /**
     * The caller's code, minting one on first read.
     *
     * <p>Collisions are avoided by looking before leaping rather than by catching the unique index.
     * A constraint violation poisons the persistence context, so there is no "try again" available
     * once one fires — the retry has to happen before the insert or not at all. A genuinely
     * concurrent collision (two mints in flight at the same instant) still reaches the index and is
     * answered as a 409; at one chance in a million per attempt, that is a re-tap, not a design.
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
     * Which side of the marketplace the referred party had joined on <em>at redemption</em> — the
     * <em>referred</em> party's standing, not the referrer's. The contract allows exactly two
     * values, so a staff or admin account — which cannot meaningfully be referred anyway — records
     * as {@code seeker} rather than putting an undeclared value on the wire.
     *
     * <p><strong>This is a snapshot, and the desk does not read it.</strong> Redemption fires from
     * {@code Signup.jsx} in the same handler as registration, so the account is seconds old and this
     * necessarily returns {@code seeker}. {@link ReferralMapper#channelOf} derives the value the
     * queue actually shows from the referred party's current tally, exactly as {@link #approve}
     * reads their current Aadhaar badge rather than {@link Referral#isAadhaarVerified()}. Kept on
     * the row because it is evidence of what was true when the code was redeemed; do not reintroduce
     * it as the displayed value.
     *
     * <p><strong>Read from the listing tally, not from {@code role}.</strong> The role test this
     * replaced could never return {@code owner} under any timing: nothing in the application assigns
     * {@code Roles.Wire.OWNER} — both signup paths hardcode {@code buyer} and {@code setRole} has no
     * call site outside account creation — so the value was structurally unreachable rather than
     * merely unreached. Only the demo seed, which writes {@code role} literally, made it look
     * answered. {@code listingsCount} is the lifetime tally ({@link User#recordListingPosted()}),
     * which is the right question anyway: somebody whose first listing was rejected still joined on
     * the owner side.
     *
     * <p>Not to be confused with {@link Referral#getShareChannel()}, which is how the link actually
     * travelled. That the two were ever conflated is what D60 recorded.
     */
    private static String channelOf(User referred) {
        return referred.getListingsCount() > 0 ? "owner" : "seeker";
    }

    /**
     * The risk band shown to the desk.
     *
     * <p>Three inputs since V64: how fast the referrer is going, whether the referred party has a
     * verified identity behind them, and whether the two sides correlate on device or network
     * (D55). The correlation raises the band rather than refusing anything — a couple sharing a flat
     * and a router is the platform's most common genuine referral, and treating that as fraud would
     * reject exactly the people the scheme is for. It is a reason for a human to look, which is what
     * a risk band is.
     */
    private static String risk(boolean velocityHigh, boolean aadhaarVerified, boolean correlated) {
        if (velocityHigh) {
            return RISK_HIGH;
        }
        if (correlated) {
            return RISK_MEDIUM;
        }
        return aadhaarVerified ? RISK_LOW : RISK_MEDIUM;
    }

    /** The single, undifferentiated refusal. See {@link #redeem}. */
    private ConflictException refuse() {
        return new ConflictException("That referral code cannot be redeemed");
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
