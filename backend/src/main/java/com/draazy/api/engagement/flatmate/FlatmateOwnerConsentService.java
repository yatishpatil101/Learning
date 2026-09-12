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
 * The flat owner's OTP-confirmed acknowledgement that a sitting tenant may list a replacement. Why
 * its own service, and why the group-less path exists: docs/flows/consumer/flatmates.md §5.
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
     * Canonicalise the owner's number so the self-check, the OTP and the stored row key off the
     * same ten digits, and refuse the shortcut the edge cannot catch: consenting to yourself.
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
     * How long before the owner may be sent another code. Delegated because this flow spends the
     * same {@link OtpService} send budget as login, and a second copy is a second thing to get wrong.
     */
    public int resendCooldownSeconds() {
        return otpService.resendCooldownSeconds();
    }

    /**
     * Verify the owner's code and record the consent, idempotently. {@code groupId} is null for a
     * consent taken before the group exists; the row is keyed on the pair either way.
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
     * Has this tenant already recorded consent from this owner? Read at group-creation time so a
     * consent taken before the group had an id still lands on the row. Mobile must be normalised.
     */
    @Transactional(readOnly = true)
    public boolean has(String ownerMobile, UUID grantedBy) {
        return ownerMobile != null
                && consents.existsByOwnerMobileAndGrantedBy(ownerMobile, grantedBy);
    }
}
