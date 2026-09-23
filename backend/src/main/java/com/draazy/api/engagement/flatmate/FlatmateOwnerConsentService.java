package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.error.RateLimitedException;
import com.draazy.api.common.error.UnauthorizedException;
import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.identity.auth.OtpCode;
import com.draazy.api.identity.auth.OtpService;
import com.draazy.api.identity.auth.Tokens;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.provider.OtpSender;
import com.draazy.api.security.AuthPrincipal;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** The flat owner's OTP-confirmed acknowledgement that a sitting tenant may list a replacement. Why
 * its own service, and why the group-less path exists: docs/flows/consumer/flatmates.md §5. */
@Service
public class FlatmateOwnerConsentService {

    private final FlatmateOwnerConsentRepository consents;
    private final FlatmateRoomRepository rooms;
    private final FlatmateGroupRepository groups;
    private final FlatmateGuardrails guardrails;
    /** Whether the post a consent unblocks lands on the board or back in the review backlog. */
    private final FlatmatePublication publication;
    private final UserRepository users;
    private final OtpService otpService;
    private final AuditService audit;

    public FlatmateOwnerConsentService(FlatmateOwnerConsentRepository consents,
            FlatmateRoomRepository rooms, FlatmateGroupRepository groups,
            FlatmateGuardrails guardrails, FlatmatePublication publication,
            UserRepository users, OtpService otpService, AuditService audit) {
        this.consents = consents;
        this.rooms = rooms;
        this.groups = groups;
        this.guardrails = guardrails;
        this.publication = publication;
        this.users = users;
        this.otpService = otpService;
        this.audit = audit;
    }

    /** {@code noRollbackFor} must repeat {@link OtpService#verifyCode}'s own list: rollback rules are
     * consulted at every boundary, so a list that stops here resets the 3-guess ceiling. */
    @Transactional(noRollbackFor = {OtpSender.DeliveryFailedException.class,
            UnauthorizedException.class, RateLimitedException.class})
    public boolean ownerConsent(AuthPrincipal caller, UUID groupId, String ownerMobile, String otp) {
        FlatmateGroup group = groups.findById(groupId)
                .filter(g -> !g.isArchived())
                .orElseThrow(() -> NotFoundException.of("Group"));
        if (!group.getHostId().equals(caller.userId())) {
            throw new ForbiddenException("You can only request consent for a group you created.");
        }
        String mobile = normalise(caller, ownerMobile);

        if (FlatmateVocabulary.blankToNull(otp) == null) {
            send(caller.userId(), mobile, group.getAddressFingerprint());
            group.setOwnerConsentMobile(mobile);
            // Re-derived, not left standing: retargeting the number is a claim about a different
            // person, and a carried-over flag would read as consent B has never given.
            group.setOwnerConsent(has(mobile, caller.userId(), group.getAddressFingerprint()));
            groups.saveAndFlush(group);
            return false;
        }

        record(caller, mobile, otp, groupId, group.getAddressFingerprint());
        group.setOwnerConsent(true);
        group.setOwnerConsentMobile(mobile);
        groups.saveAndFlush(group);
        publication.recordOwnerConsent(groupId);
        return true;
    }

    /** The group-less twin: the address travels with the request (V30 scopes the row to a flat) and is
     * settled <em>before</em> the send, so an unfingerprintable address costs no SMS and no cooldown. */
    @Transactional(noRollbackFor = {OtpSender.DeliveryFailedException.class,
            UnauthorizedException.class, RateLimitedException.class})
    public boolean ownerConsent(AuthPrincipal caller, String title, String society, String locality,
            String ownerMobile, String otp) {
        String mobile = normalise(caller, ownerMobile);
        String fingerprint = guardrails.fingerprint(
                new FlatmateGuardrails.Address(null, society, locality, title));
        if (fingerprint == null) {
            throw new BadRequestException(
                    "Name the flat first — give the post a locality, and a society or a title.");
        }
        if (FlatmateVocabulary.blankToNull(otp) == null) {
            send(caller.userId(), mobile, fingerprint);
            return false;
        }
        record(caller, mobile, otp, null, fingerprint);
        applyConsentToLivePosts(caller, mobile, fingerprint);
        return true;
    }

    /** Asked of the consent table, never of the request — a client-typed number would otherwise set the
     * field Ops reads for the badge. Must run after {@code mapper.applyTo} and after the fingerprint. */
    void settleRoomConsent(AuthPrincipal caller, FlatmateRoom room) {
        room.setOwnerConsent(
                has(room.getOwnerConsentMobile(), caller.userId(), room.getAddressFingerprint()));
    }

    /** Without this sweep nothing re-reads the consent table when the post already exists, so the
     * flag stays false, Ops cannot approve it, and {@code reconcileDraazyAgreements} skips it forever. */
    private void applyConsentToLivePosts(AuthPrincipal caller, String mobile, String fingerprint) {
        rooms.findByAddressFingerprintAndArchivedFalse(fingerprint).stream()
                .filter(room -> caller.userId().equals(room.getHostId()))
                .filter(room -> mobile.equals(room.getOwnerConsentMobile()))
                .forEach(room -> {
                    settleRoomConsent(caller, room);
                    rooms.saveAndFlush(room);
                    publication.recordOwnerConsentForRoom(room.getId());
                });
        groups.findByAddressFingerprintAndArchivedFalse(fingerprint).stream()
                .filter(group -> caller.userId().equals(group.getHostId()))
                .filter(group -> mobile.equals(group.getOwnerConsentMobile()))
                .forEach(group -> {
                    group.setOwnerConsent(has(group.getOwnerConsentMobile(),
                            caller.userId(), group.getAddressFingerprint()));
                    groups.saveAndFlush(group);
                    publication.recordOwnerConsent(group.getId());
                });
    }

    /** Canonicalise the owner's number so the self-check, the OTP and the stored row key off the
     * same ten digits, and refuse the shortcut the edge cannot catch: consenting to yourself. */
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

    /** The caller travels because the recipient is a number they typed: every recipient-keyed budget
     * is one they can reset by typing a different one. {@code requestedBy} is the key they are stuck with. */
    public void send(UUID caller, String ownerMobile, String addressFingerprint) {
        otpService.sendCode(ownerMobile, purposeFor(addressFingerprint), caller);
    }

    /** Delegated because this flow spends the same {@link OtpService} send budget as login, and a
     * second copy is a second thing to get wrong. */
    public int resendCooldownSeconds() {
        return otpService.resendCooldownSeconds();
    }

    /** The rollback rules are inert under self-invocation but must match the boundary this claims to
     * be, or the first cross-bean caller resets the 3-guess ceiling. */
    @Transactional(noRollbackFor = {OtpSender.DeliveryFailedException.class,
            UnauthorizedException.class, RateLimitedException.class})
    public void record(AuthPrincipal caller, String ownerMobile, String otp, UUID groupId,
            String addressFingerprint) {
        if (addressFingerprint == null) {
            throw new BadRequestException(
                    "Name the flat first — give the post a title and locality, then ask the owner.");
        }
        otpService.verifyCode(ownerMobile, otp.strip(), purposeFor(addressFingerprint));
        upsert(ownerMobile, caller.userId(), groupId, addressFingerprint);
        audit.record(caller, "flatmate.ownerConsent", "flatmateOwnerConsent",
                groupId == null ? ownerMobile : groupId.toString(),
                "ownerMobile", ownerMobile, "address", addressFingerprint);
    }

    private static String purposeFor(String addressFingerprint) {
        return OtpCode.PURPOSE_OWNER_CONSENT + ":" + Tokens.sha256Hex(addressFingerprint);
    }

    /** The read after the insert is what turns {@code ON CONFLICT DO NOTHING}'s silence into the row:
     * the statement reports nothing about which case happened. */
    private void upsert(String ownerMobile, UUID grantedBy, UUID groupId, String fingerprint) {
        consents.insertIfAbsent(ownerMobile, grantedBy.toString(),
                groupId == null ? null : groupId.toString(), fingerprint);
        consents.findByOwnerMobileAndGrantedByAndAddressFingerprint(
                        ownerMobile, grantedBy, fingerprint)
                .ifPresent(row -> adoptGroup(row, groupId));
    }

    private void adoptGroup(FlatmateOwnerConsent row, UUID groupId) {
        if (groupId != null && row.getGroupId() == null) {
            row.adoptGroup(groupId);
            consents.saveAndFlush(row);
        }
    }

    /** Mobile must be normalised and the fingerprint must be the one the post was filed under; a null
     * one answers false, because a post whose flat cannot be named has nothing to be consented about. */
    @Transactional(readOnly = true)
    public boolean has(String ownerMobile, UUID grantedBy, String addressFingerprint) {
        return ownerMobile != null && addressFingerprint != null
                && consents.existsByOwnerMobileAndGrantedByAndAddressFingerprint(
                        ownerMobile, grantedBy, addressFingerprint);
    }
}
