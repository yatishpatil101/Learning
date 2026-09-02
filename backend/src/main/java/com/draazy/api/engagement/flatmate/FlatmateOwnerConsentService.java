package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.identity.auth.OtpCode;
import com.draazy.api.identity.auth.OtpService;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.AuthPrincipal;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The flat owner's OTP-confirmed acknowledgement that a sitting tenant may list a replacement.
 *
 * <p><strong>Why this is a service of its own.</strong> {@code FlatmateSupplyService} sat exactly on
 * the 450-line split trigger, and {@code package-structure.md} §4.1 asks for the smallest use-case
 * that owns its own data and its own transaction. This is it: one table
 * ({@code flatmate_owner_consents}, V27), one OTP purpose ({@link OtpCode#PURPOSE_OWNER_CONSENT}),
 * and one question — did this owner agree to this tenant. Rooms, groups, seats and requests are none
 * of its business.
 *
 * <p><strong>Consent is a fact about two people, not about one post.</strong> V27 keys the table
 * {@code UNIQUE (owner_mobile, granted_by)} and leaves {@code group_id} nullable, which is the
 * schema saying the same thing: a tenant who reopens the form must not be made to re-OTP an owner
 * who already agreed, and a consent may exist before the group it will be attached to does.
 *
 * <p>That nullable column is what this class is for. The group-scoped endpoint
 * ({@code POST /flatmates/groups/{id}/owner-consent}) can only record consent for a group that
 * already exists, but the form asks for consent <em>while the group is being written</em> — so the
 * browser had no route it could call at the moment it needed one. It wrote
 * {@code draazyOwnerConsent} to {@code localStorage} instead and put {@code ownerConsent: true} on
 * the create payload, where {@link FlatmateMapper} correctly dropped it: a tenant who could assert
 * their own landlord's consent would make the record worthless. So the tenant did the whole OTP
 * dance with their landlord and got nothing for it — no chip on the card, and an Ops review entry
 * that said consent was absent.
 */
@Service
public class FlatmateOwnerConsentService {

    private final FlatmateOwnerConsentRepository consents;
    private final UserRepository users;
    private final OtpService otpService;
    private final AuditService audit;

    public FlatmateOwnerConsentService(FlatmateOwnerConsentRepository consents,
            UserRepository users, OtpService otpService, AuditService audit) {
        this.consents = consents;
        this.users = users;
        this.otpService = otpService;
        this.audit = audit;
    }

    /**
     * Canonicalise the owner's number and refuse the one shortcut somebody would certainly try.
     *
     * <p>Shape is validated at the edge ({@code @IndianMobile}); this normalises so the self-check,
     * the OTP and the stored row all key off the same ten digits the owner's account would use. The
     * rule the edge cannot know — <em>whose</em> number it is — is enforced here.
     */
    public String normalise(AuthPrincipal caller, String ownerMobile) {
        String mobile = MobileMask.normalise(ownerMobile);
        if (mobile == null) {
            throw new BadRequestException("Enter the owner's mobile number.");
        }
        User self = users.findById(caller.userId())
                .orElseThrow(() -> NotFoundException.of("User"));
        if (mobile.equals(self.getMobile())) {
            throw new BadRequestException(
                    "That is your own number. Consent has to come from the flat's owner.");
        }
        return mobile;
    }

    /** Dispatch a consent code to the owner. The number must already be through {@link #normalise}. */
    public void send(String ownerMobile) {
        otpService.sendCode(ownerMobile, OtpCode.PURPOSE_OWNER_CONSENT);
    }

    /**
     * Verify the owner's code and record the consent, idempotently.
     *
     * <p>{@code groupId} is null for a consent taken before the group exists — the case this class
     * was added for. The row is keyed on the pair either way, so attaching it to a group later would
     * be decoration: {@link #has} never consults {@code group_id}.
     *
     * <p>The verify throws 401 on a wrong code and 429 once the attempt cap is spent — the same
     * primitive that guards login, scoped to its own purpose so neither flow can be used against the
     * other.
     */
    @Transactional
    public void record(AuthPrincipal caller, String ownerMobile, String otp, UUID groupId) {
        otpService.verifyCode(ownerMobile, otp.strip(), OtpCode.PURPOSE_OWNER_CONSENT);
        consents.findByOwnerMobileAndGrantedBy(ownerMobile, caller.userId())
                .orElseGet(() -> consents.saveAndFlush(
                        new FlatmateOwnerConsent(ownerMobile, caller.userId(), groupId)));
        audit.record(caller, "flatmate.ownerConsent", "flatmateOwnerConsent",
                groupId == null ? ownerMobile : groupId.toString(), "ownerMobile", ownerMobile);
    }

    /**
     * Has this tenant already recorded consent from this owner?
     *
     * <p>Read at group-creation time so a consent taken minutes earlier, before the group had an id,
     * still lands on the row. Takes the already-normalised mobile: the caller has one by then, and
     * normalising twice would invite the two to disagree.
     */
    @Transactional(readOnly = true)
    public boolean has(String ownerMobile, UUID grantedBy) {
        return ownerMobile != null
                && consents.existsByOwnerMobileAndGrantedBy(ownerMobile, grantedBy);
    }
}
