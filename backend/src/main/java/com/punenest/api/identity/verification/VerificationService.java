package com.punenest.api.identity.verification;

import com.punenest.api.common.error.AadhaarAlreadyRegisteredException;
import com.punenest.api.common.trust.MobileMask;
import com.punenest.api.common.trust.OwnerBadgeSink;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.provider.KycProvider;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The opt-in L2 identity badge: read it, start a DigiLocker consent flow, and absorb the provider's
 * asynchronous verdict.
 *
 * <p><strong>A badge, never a wall (ADR-019).</strong> Nothing in this class is consulted to decide
 * whether a user may browse, post or contact. The one place the badge has teeth is
 * {@code leads.contact.ContactService}, and only when an owner has explicitly opted into
 * verified-contact-only. Everything here is additive trust.
 *
 * <p><strong>Aadhaar hygiene.</strong> We never receive, store or log a raw Aadhaar number — the user
 * enters it on DigiLocker. All we persist is a masked last-4 for display and a provider-computed
 * {@code identityHash} for dedup. The Aadhaar-linked mobile is compared once to derive the soft
 * {@code mobileMatch} signal (ADR-009a) and then dropped.
 */
@Service
public class VerificationService {

    private final IdentityVerificationRepository verifications;
    private final UserRepository users;
    private final OwnerBadgeSink ownerBadge;
    private final KycProvider kycProvider;
    private final VerificationMapper verificationMapper;

    public VerificationService(IdentityVerificationRepository verifications, UserRepository users,
            OwnerBadgeSink ownerBadge, KycProvider kycProvider,
            VerificationMapper verificationMapper) {
        this.verifications = verifications;
        this.users = users;
        this.ownerBadge = ownerBadge;
        this.kycProvider = kycProvider;
        this.verificationMapper = verificationMapper;
    }

    /**
     * Contract {@code getAadhaarStatus} — the caller's badge, or the fully-specified "never tried"
     * answer. Never 404s: absence of a badge is a state, not a missing resource.
     */
    @Transactional(readOnly = true)
    public AadhaarVerificationResponse status(UUID userId) {
        return verifications.findByUserId(userId)
                .map(verificationMapper::toResponse)
                .orElseGet(AadhaarVerificationResponse::none);
    }

    /**
     * Contract {@code submitAadhaar} — begin (or retry) the DigiLocker consent flow. {@code 202}: we
     * are handing back a URL, not a badge; the verdict arrives later on the webhook.
     *
     * <p>Reuses the {@link KycProvider} seam, so the whole flow is demoable with no vendor account.
     * The in-progress handle ({@code ref}, {@code verification_url}, {@code expires_at},
     * {@code status=pending}) is persisted before the URL is returned, because the webhook correlates
     * on {@code ref} and may well arrive before the client finishes its redirect.
     *
     * <p><strong>Retry policy.</strong> An abandoned or genuinely failed attempt is retryable — a new
     * session simply overwrites the handle. A row that {@link VerificationStatuses#isIdentityCollision
     * marks a dedup collision} is not: that identity belongs to another account and no number of
     * retries will change it, so the caller gets {@code 409 aadhaar_already_registered}.
     *
     * <p><em>Why the 409 lands here rather than at the collision itself:</em> the dedup key only
     * exists once DigiLocker responds, i.e. inside a webhook that must always answer {@code 200} to
     * the provider. The webhook records the outcome; this endpoint is where the user learns of it.
     *
     * @throws AadhaarAlreadyRegisteredException when this caller's last attempt collided
     */
    @Transactional
    public KycStartResponse start(UUID userId) {
        IdentityVerification row = verifications.findByUserId(userId)
                .orElseGet(() -> new IdentityVerification(userId));

        if (VerificationStatuses.isIdentityCollision(row.getStatus(), row.getMaskedAadhaar())) {
            throw new AadhaarAlreadyRegisteredException(
                    "This Aadhaar is already linked to another account");
        }

        KycProvider.KycSession session = kycProvider.start(userId.toString());
        row.setRef(session.ref());
        row.setVerificationUrl(session.verificationUrl());
        row.setExpiresAt(session.expiresAt());
        row.setStatus(VerificationStatuses.PENDING);
        row.setSource(VerificationSources.DIGILOCKER);
        verifications.save(row);

        return new KycStartResponse(session.ref(), session.verificationUrl(), session.expiresAt());
    }

    /**
     * Contract {@code cashfreeDigilockerWebhook} — absorb the provider's verdict.
     *
     * <p><strong>Idempotent.</strong> Providers retry; a replayed {@code SUCCESS} for an
     * already-verified {@code ref} is a no-op rather than a second badge grant or a re-stamped
     * {@code verifiedAt}. An unknown {@code ref} is dropped silently — it is either a stale replay or
     * someone probing, and neither deserves an answer.
     *
     * <p><strong>One Aadhaar, one account (ADR-009b).</strong> Before granting, the
     * {@code identityHash} is checked against every other row. A hit means this human already has a
     * badge elsewhere: the attempt is recorded as {@code failed} <em>with</em> the masked value — the
     * marker {@link #start} later turns into a {@code 409} — and no badge is granted. The
     * {@code identity_hash} UNIQUE index remains the real guarantee; this read only lets us fail
     * gracefully instead of on a constraint violation.
     *
     * <p>On success the user's {@code aadhaar_verified} and {@code verified} flags are flipped, which
     * is what {@code leads.contact} reads live when evaluating an owner's verified-contact-only
     * preference.
     *
     * <p>Never throws for a payload-level problem: the caller must answer {@code 200} regardless.
     */
    @Transactional
    public void handleWebhook(DigilockerWebhook payload) {
        Optional<IdentityVerification> found = Optional.ofNullable(payload.ref())
                .flatMap(verifications::findByRef);
        if (found.isEmpty()) {
            return;
        }
        IdentityVerification row = found.get();

        if (VerificationStatuses.VERIFIED.equals(row.getStatus())) {
            return;
        }
        if (!WebhookStatuses.SUCCESS.equals(payload.status()) || payload.data() == null) {
            row.setStatus(VerificationStatuses.FAILED);
            row.setBadge(false);
            verifications.save(row);
            return;
        }

        DigilockerWebhook.Data data = payload.data();
        boolean claimedElsewhere = Optional.ofNullable(data.identityHash())
                .flatMap(verifications::findByIdentityHash)
                .filter(other -> !other.getUserId().equals(row.getUserId()))
                .isPresent();
        if (claimedElsewhere) {
            row.setStatus(VerificationStatuses.FAILED);
            row.setBadge(false);
            row.setMaskedAadhaar(data.maskedAadhaar());
            verifications.save(row);
            return;
        }

        User user = users.findById(row.getUserId()).orElse(null);
        row.setBadge(true);
        row.setStatus(VerificationStatuses.VERIFIED);
        row.setSource(VerificationSources.DIGILOCKER);
        row.setMaskedAadhaar(data.maskedAadhaar());
        row.setIdentityHash(data.identityHash());
        row.setMobileMatch(mobileMatch(user, data.mobile()));
        row.setVerifiedAt(Instant.now());
        verifications.save(row);

        if (user != null) {
            user.setAadhaarVerified(true);
            user.setVerified(true);
            users.save(user);
            /* Carry the badge onto the listings. Without this the funnel stops at the profile screen:
             * the owner sees a green pill while every listing they hold still tells buyers the owner
             * is unverified, and the "verified owners rank higher" promise the whole opt-in flow is
             * sold on quietly does nothing.
             *
             * This is only the back-fill half. It runs once — the early return above makes a replayed
             * success a no-op — so it cannot be the mechanism for listings posted *after* verifying;
             * `ListingService.create` stamps those from the owner at birth. The two halves together
             * are what keep the denormalised column true.
             *
             * Through a kernel port rather than `PropertyRepository` directly: identity sits below
             * catalog, catalog already reads identity to resolve an owner, and importing back up
             * would close that loop into a cycle. `OwnerBadgeSink` is the same inversion
             * `ContactGate` uses in the other direction. */
            ownerBadge.markOwnerVerified(user.getId());
        }
    }

    /**
     * <strong>Dev profile only</strong> (called solely from the {@code @DevOnly}
     * {@code DevVerificationController}). Grant the caller the badge by synthesizing a DigiLocker
     * {@code SUCCESS} for their current — or a freshly-created — verification handle and running it
     * through the real {@link #handleWebhook} path, so idempotency, the one-Aadhaar-one-account dedup
     * and the {@code verified}/{@code aadhaar_verified} flag flips are all exercised rather than
     * bypassed.
     *
     * <p>Exists because the badge's happy path is otherwise undemonstrable in dev: {@link #start}
     * hands back a pending handle and the grant only ever arrives on
     * {@code /webhooks/cashfree/digilocker}, which a developer's backend never receives (D122). The
     * synthetic identity is namespaced by user id so two dev accounts never collide on the
     * {@code identity_hash} UNIQUE index, and the Aadhaar-linked mobile is set to the caller's own
     * number so the soft {@code mobileMatch} signal reads true — the common real-world case.
     */
    @Transactional
    public AadhaarVerificationResponse simulateSuccess(UUID userId) {
        IdentityVerification row = verifications.findByUserId(userId)
                .orElseGet(() -> new IdentityVerification(userId));
        if (row.getRef() == null) {
            row.setRef("dev-sim-" + userId);
            row.setStatus(VerificationStatuses.PENDING);
            row.setSource(VerificationSources.DIGILOCKER);
            verifications.save(row);
        }

        User user = users.findById(userId).orElse(null);
        String mobile = user != null ? user.getMobile() : null;
        String last4 = String.format("%04d", Math.floorMod(userId.hashCode(), 10_000));
        DigilockerWebhook synthetic = new DigilockerWebhook(
                "DIGILOCKER_VERIFICATION_SUCCESS", row.getRef(), WebhookStatuses.SUCCESS,
                new DigilockerWebhook.Data("XXXX XXXX " + last4, mobile, "dev-sim-hash-" + userId));
        handleWebhook(synthetic);
        return status(userId);
    }

    /**
     * The soft mobile-match signal (ADR-009a): does the Aadhaar-linked number equal the account
     * number? Compared on digits only, since the two sources format differently.
     *
     * <p>Returns {@code null} — "unknown" — when either side is missing, rather than {@code false},
     * because a false negative here would look like a fraud signal in any later risk model. Nothing
     * today reads it as a gate.
     */
    private Boolean mobileMatch(User user, String kycMobile) {
        if (user == null || user.getMobile() == null || kycMobile == null) {
            return null;
        }
        // Canonicalise both sides through the one shared normaliser (Q1) so a KYC number formatted
        // with a +91 prefix or spacing still matches the stored ten-digit account number.
        String account = MobileMask.normalise(user.getMobile());
        return account != null && account.equals(MobileMask.normalise(kycMobile));
    }
}
