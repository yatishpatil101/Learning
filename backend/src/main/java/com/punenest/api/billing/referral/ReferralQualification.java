package com.punenest.api.billing.referral;

import com.punenest.api.common.settings.PlatformSettings;
import com.punenest.api.common.trust.VerificationAnnouncer;
import com.punenest.api.identity.user.UserRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Turns "this owner's listing cleared the document gate" into a referral state change (Q17).
 *
 * <p>This is the {@code billing} end of {@link VerificationAnnouncer}. It exists so that
 * {@code catalog} can announce a verification without importing {@code billing}, which ranks above
 * it and would fail {@code ArchitectureBoundaryTest}.
 *
 * <p><strong>The rule.</strong> A referrer is credited when the referee's <em>first</em> listing
 * passes verification — the referral moves from {@link ReferralStatuses#PENDING} to
 * {@link ReferralStatuses#QUALIFIED}, the status the contract has always declared and no code path
 * ever produced (D56). Q17 rejected the cheaper triggers on record and they should not come back:
 * a verified mobile costs less than the credit it mints, verifying the referee's identity puts
 * friction on the exact surface being used to buy liquidity, and manual review does not scale.
 * Clearing the ownership-document gate is already expensive to fake, so it does the anti-fraud work
 * twice and this class needs no fraud machinery of its own.
 *
 * <p><strong>"First" and "idempotent" are the same guard here, deliberately.</strong> The
 * announcement runs inside the verifying transaction, so a retried write announces again, and an
 * owner who verifies a second listing announces a different property against the same referral —
 * two different stories with the same required ending, which is that nothing further is minted.
 * Rather than ask {@code catalog} how many verified listings an owner has (a question whose answer
 * races with the write in progress, and which would put a second source of truth beside the
 * referral row), first-ness is read off the row itself: {@code qualifiedAt} moves from null exactly
 * once, under a row lock, and every later announcement finds a row that is no longer pending and
 * does nothing. One guard, both invariants, nothing to drift.
 *
 * <p><strong>Exceeding the monthly cap defers; it never rejects (D61).</strong> Automated velocity
 * blocks were avoided in this scheme on purpose, because they "would reject genuine roommates and
 * flatmates, which is the platform's most common referral". That reasoning still holds and the cap
 * is built not to break it: past the limit the referral simply stays {@code pending} for the fraud
 * desk — exactly how every referral behaved before this class did anything — so the cost of the cap
 * is a human glance, never a lost reward. The limit itself is configuration
 * ({@code settings.fees.referralQualifyPerMonth}, default ten a month) so that moving it is a
 * deployment decision rather than a release.
 *
 * <p><strong>No audit row.</strong> {@code AuditService} records what a <em>person</em> decided, and
 * nobody decided this. The evidence lives on the referral itself — {@code qualified_at} and
 * {@code qualified_property_id} say when it happened and which listing caused it — and no money
 * moves until a checker calls {@code approve}, which does audit.
 */
@Service
public class ReferralQualification implements VerificationAnnouncer {

    private static final Logger log = LoggerFactory.getLogger(ReferralQualification.class);

    /**
     * The rolling window the D61 cap counts over.
     *
     * <p>Thirty days rather than a calendar month: a calendar boundary is a published gap somebody
     * can wait for, and a referrer holding verifications until the first of the month would collect
     * two allowances inside forty-eight hours.
     */
    private static final Duration CAP_WINDOW = Duration.ofDays(30);

    private final ReferralRepository referrals;
    private final UserRepository users;
    private final PlatformSettings settings;

    public ReferralQualification(ReferralRepository referrals, UserRepository users,
            PlatformSettings settings) {
        this.referrals = referrals;
        this.users = users;
        this.settings = settings;
    }

    /**
     * {@inheritDoc}
     *
     * <p>{@link Propagation#REQUIRED}, so this joins the caller's transaction rather than opening
     * its own. That is the point: if the verification write rolls back, the qualification it
     * announced has to roll back with it, or a referral is credited for a listing the platform does
     * not consider verified. {@code REQUIRES_NEW} would commit the credit independently, and this
     * note exists to stop someone reaching for it the first time a lock timeout shows up here.
     */
    @Override
    @Transactional(propagation = Propagation.REQUIRED)
    public void announceOwnershipVerified(UUID ownerId, UUID propertyId, Instant verifiedAt) {
        Optional<String> mobile = users.findById(ownerId).map(owner -> owner.getMobile());
        if (mobile.isEmpty()) {
            // An owner id identity does not know. Nothing to qualify, and not worth failing a
            // verification over.
            return;
        }

        Optional<Referral> pending = referrals.findPendingForQualification(mobile.get());
        if (pending.isEmpty()) {
            // The overwhelmingly common path: this owner was never referred. It also covers both
            // repeat cases -- an already-qualified row, and a second verified listing -- because
            // neither is pending any more. Indistinguishable here on purpose; see the class Javadoc
            // on why one guard serves both invariants.
            return;
        }

        Referral referral = pending.get();
        long cap = settings.referralQualifyPerMonth();
        long recent = referrals.countByReferrerIdAndQualifiedAtAfter(
                referral.getReferrerId(), verifiedAt.minus(CAP_WINDOW));
        if (recent >= cap) {
            log.info("Referral {} left pending for review: referrer {} has {} qualification(s) in "
                            + "the last {} days, cap {}",
                    referral.getId(), referral.getReferrerId(), recent, CAP_WINDOW.toDays(), cap);
            return;
        }

        if (referral.qualify(propertyId, verifiedAt)) {
            referrals.saveAndFlush(referral);
        }
    }
}
