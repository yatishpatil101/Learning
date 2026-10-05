package com.draazy.api.documents.agreement;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.error.ValidationException;
import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.common.validation.Formats;
import com.draazy.api.documents.vault.Document;
import com.draazy.api.documents.vault.DocumentMapper;
import com.draazy.api.documents.vault.DocumentRepository;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.AuthPrincipal;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The rent-agreement records the flatmate trust sweep reads as evidence. Rows are born only from a
 * paid service request's final-document upload ({@link #prepare}); the wizard, pricing and ops queue
 * live under {@code /service-requests}. Who may call {@link #transition} is decided there too — this
 * class holds the invariants that must survive any caller.
 */
@Service
public class RentAgreementService {

    private final RentAgreementRepository agreements;
    private final DocumentRepository documents;
    private final DocumentMapper documentMapper;
    private final UserRepository users;
    private final AuditService audit;

    public RentAgreementService(RentAgreementRepository agreements, DocumentRepository documents,
            DocumentMapper documentMapper, UserRepository users, AuditService audit) {
        this.agreements = agreements;
        this.documents = documents;
        this.documentMapper = documentMapper;
        this.users = users;
        this.audit = audit;
    }

    /**
     * Both sides in one call — one document, two signatories. The tenant side matches on mobile
     * because that is the only identifier the record carries for them, and a mobile is only what
     * someone typed: until a row is registered it is the owner's to see, not whoever holds that
     * number. An owner-typed URL on a row no desk produced is never shown to the tenant side.
     */
    @Transactional(readOnly = true)
    public List<RentAgreementDto> mine(UUID callerId) {
        return toDtos(callerId, agreements.findForParty(callerId, mobileOf(callerId)).stream()
                .filter(a -> callerId.equals(a.getOwnerId()) || isEvidence(a.getStatus()))
                .toList());
    }

    /** One {@code draft} row per distinct valid tenant mobile. Unparseable numbers are dropped, not stored. */
    @Transactional
    public void prepare(PreparedAgreement prepared, Collection<String> tenantMobiles) {
        Set<String> mobiles = tenantMobiles.stream()
                .map(MobileMask::normalise)
                .filter(m -> m != null && m.matches(Formats.MOBILE))
                .collect(Collectors.toCollection(LinkedHashSet::new));
        agreements.saveAllAndFlush(mobiles.stream()
                .map(mobile -> new RentAgreement(prepared, mobile))
                .toList());
    }

    /**
     * The only writer of {@code status}. Out-of-order moves are 422 — only the stored row knows.
     *
     * <p>{@code registered} and {@code active} mint a trust badge with no human in the loop, so they
     * need a row the paid flow created, its registered copy, and a checker who is neither the staff
     * member who uploaded that copy nor a signatory.
     */
    @Transactional
    public void transition(AuthPrincipal caller, UUID id, String status) {
        String next = status == null ? "" : status.strip();
        if (!RentAgreementStatuses.isKnown(next)) {
            throw new ValidationException("Not a rent-agreement status. One of: "
                    + String.join(", ", RentAgreementStatuses.ALL) + ".");
        }

        RentAgreement agreement = agreements.lockById(id)
                .orElseThrow(() -> NotFoundException.of("Rent agreement"));
        String from = agreement.getStatus();
        if (!RentAgreementStatuses.canMove(from, next)) {
            List<String> legal = RentAgreementStatuses.nextFrom(from);
            throw new ValidationException(legal.isEmpty()
                    ? "This agreement is " + from + " and nothing follows it \u2014 a new tenancy is"
                            + " a new agreement."
                    : "An agreement that is " + from + " can only become "
                            + String.join(" or ", legal) + ".");
        }
        refuseSignatory(caller, agreement);
        if (isEvidence(next)) {
            requireEvidence(agreement);
            if (caller.userId().equals(agreement.getPreparedBy())) {
                throw new ForbiddenException("You uploaded this registered copy, so a colleague has"
                        + " to check it before the tenancy counts as registered.");
            }
        }

        agreement.moveTo(next, caller.userId());
        agreements.saveAndFlush(agreement);
        audit.record(caller, "rentAgreement.status", "rentAgreement", agreement.getId().toString(),
                "from", from, "to", next,
                "serviceRequestId", Objects.toString(agreement.getServiceRequestId(), null),
                "finalDocumentId", Objects.toString(agreement.getFinalDocumentId(), null));
    }

    public static boolean isEvidence(String status) {
        return RentAgreementStatuses.REGISTERED.equals(status)
                || RentAgreementStatuses.ACTIVE.equals(status);
    }

    private static void requireEvidence(RentAgreement agreement) {
        if (agreement.getServiceRequestId() == null || agreement.getFinalDocumentId() == null) {
            throw new ValidationException("Only an agreement Draazy drafted and registered through a"
                    + " paid service request can be marked registered.");
        }
    }

    private void refuseSignatory(AuthPrincipal caller, RentAgreement agreement) {
        String callerMobile = mobileOf(caller.userId());
        if (caller.userId().equals(agreement.getOwnerId())
                || (callerMobile != null && callerMobile.equals(agreement.getTenantMobile()))) {
            throw new ForbiddenException(
                    "You are a party to this agreement, so a colleague has to handle it.");
        }
    }

    private String mobileOf(UUID userId) {
        return users.findById(userId)
                .map(User::getMobile)
                .map(MobileMask::normalise)
                .orElse(null);
    }

    private List<RentAgreementDto> toDtos(UUID callerId, List<RentAgreement> rows) {
        Set<UUID> docIds = rows.stream()
                .map(RentAgreement::getFinalDocumentId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        Map<UUID, String> urls = documents.findAllById(docIds).stream()
                .collect(Collectors.toMap(Document::getId, d -> documentMapper.toDto(d).url()));
        return rows.stream()
                .map(a -> RentAgreementDto.of(a, documentUrl(callerId, a, urls)))
                .toList();
    }

    private static String documentUrl(UUID callerId, RentAgreement agreement, Map<UUID, String> urls) {
        if (agreement.getFinalDocumentId() != null) {
            return urls.get(agreement.getFinalDocumentId());
        }
        return callerId.equals(agreement.getOwnerId()) ? agreement.getDocumentUrl() : null;
    }
}
