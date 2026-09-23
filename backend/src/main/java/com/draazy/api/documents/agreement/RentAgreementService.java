package com.draazy.api.documents.agreement;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.error.ValidationException;
import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.common.web.Ids;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.AuthPrincipal;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Deliberately thin: the rent-agreement wizard (stamp-duty maths, co-fill, ops queue) lives under
 * {@code /service-requests}. KYC is gated on the transition out of {@code draft}, not on creation. */
@Service
public class RentAgreementService {

    private final RentAgreementRepository agreements;
    private final PropertyRepository properties;
    private final UserRepository users;
    private final AuditService audit;

    public RentAgreementService(RentAgreementRepository agreements, PropertyRepository properties,
            UserRepository users, AuditService audit) {
        this.agreements = agreements;
        this.properties = properties;
        this.users = users;
        this.audit = audit;
    }

    /** Both sides in one call — one document, two signatories. The tenant side matches on mobile
     * because that is the only identifier the record carries for them. */
    @Transactional(readOnly = true)
    public List<RentAgreementDto> mine(UUID ownerId) {
        String mobile = users.findById(ownerId)
                .map(User::getMobile)
                .map(MobileMask::normalise)
                .filter(m -> !m.isBlank())
                .orElse(null);
        return agreements.findForParty(ownerId, mobile).stream()
                .map(RentAgreementDto::of)
                .toList();
    }

    /** The property must already be the caller's, so an agreement can never be filed against someone
     * else's flat — a 404, never a 403. */
    @Transactional
    public RentAgreementDto create(UUID ownerId, RentAgreementCreate body) {
        UUID propertyId = Ids.parseUuid(body.propertyId())
                .flatMap(id -> properties.findByIdAndOwner_Id(id, ownerId))
                .or(() -> properties.findBySlugAndOwner_Id(body.propertyId(), ownerId))
                .map(Property::getId)
                .orElseThrow(() -> NotFoundException.of("Property"));

        // @IndianMobile validated the shape; store the canonical ten digits so the V6 CHECK holds.
        return RentAgreementDto.of(agreements.saveAndFlush(new RentAgreement(propertyId, ownerId,
                MobileMask.normalise(body.tenantMobile()), body.rent(), body.deposit(),
                body.startDate(), body.durationMonths())));
    }

    /** The only writer of {@code status}: {@code FlatmateTrustReconciler} badges hosts against rows
     * this method moved off {@code draft}. Out-of-order moves are 422 — only the stored row knows. */
    @Transactional
    public RentAgreementDto transition(AuthPrincipal caller, UUID id, String status,
            String documentUrl) {
        String next = status == null ? "" : status.strip();
        if (!RentAgreementStatuses.isKnown(next)) {
            throw new ValidationException("Not a rent-agreement status. One of: "
                    + String.join(", ", RentAgreementStatuses.ALL) + ".");
        }

        RentAgreement agreement = agreements.findById(id)
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

        String scan = documentUrl == null ? null : documentUrl.strip();
        if (scan != null && !scan.isEmpty() && !scan.startsWith("https://")) {
            // Handed straight back to both parties as the link to their own tenancy: a javascript:
            // or data: URL runs in a session that has every reason to trust it.
            throw new ValidationException(
                    "The agreement document has to be an https:// link to the stored scan.");
        }

        agreement.moveTo(next, scan);
        agreements.saveAndFlush(agreement);
        // The URL is the evidence the status is claiming, so an audit row without it records that
        // somebody said "registered" and not what they said it on.
        if (scan != null && !scan.isEmpty()) {
            audit.record(caller, "rentAgreement.status", "rentAgreement",
                    agreement.getId().toString(), "from", from, "to", next, "documentUrl", scan);
        } else {
            audit.record(caller, "rentAgreement.status", "rentAgreement",
                    agreement.getId().toString(), "from", from, "to", next);
        }
        return RentAgreementDto.of(agreement);
    }
}
