package com.punenest.api.documents.agreement;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.web.Ids;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The owner's Leave &amp; License agreement records.
 *
 * <p><strong>Deliberately thin, and worth saying why.</strong> The rent-agreement <em>wizard</em>
 * is a maker-checker workflow with statutory cost maths (Maharashtra Article 36A stamp duty),
 * co-fill invites and an ops queue — all of which the contract puts under
 * {@code /service-requests}, not here. These two operations are the durable record the workflow
 * produces and the owner's list of it. Implementing the cost calculation here, ahead of the
 * endpoints that expose it, would give us a second place for the money maths to live and drift.
 *
 * <p><strong>No KYC gate on a draft, on purpose.</strong> The flow doc calls rent agreements the
 * L3 "deal-verified" step where hard KYC legitimately applies — but the wizard <em>collects</em>
 * owner KYC as one of its steps, so requiring verified KYC to create the draft would lock the door
 * from the inside. The gate belongs on the transition out of {@code draft} (e-sign / registration),
 * which lands with the service workflow.
 */
@Service
public class RentAgreementService {

    private final RentAgreementRepository agreements;
    private final PropertyRepository properties;

    public RentAgreementService(RentAgreementRepository agreements, PropertyRepository properties) {
        this.agreements = agreements;
        this.properties = properties;
    }

    /** Contract {@code myRentAgreements} — the caller's own agreements, newest first. */
    @Transactional(readOnly = true)
    public List<RentAgreementDto> mine(UUID ownerId) {
        return agreements.findByOwnerIdOrderByCreatedAtDesc(ownerId).stream()
                .map(RentAgreementDto::of)
                .toList();
    }

    /**
     * Contract {@code createRentAgreement} — record a new draft against one of the caller's
     * listings.
     *
     * <p>The owner comes from the JWT and the property must already be theirs, so an agreement can
     * never be filed against someone else's flat — a 404, never a 403.
     *
     * @throws NotFoundException when the listing is unknown or not the caller's
     */
    @Transactional
    public RentAgreementDto create(UUID ownerId, RentAgreementCreate body) {
        UUID propertyId = Ids.parseUuid(body.propertyId())
                .flatMap(id -> properties.findByIdAndOwner_Id(id, ownerId))
                .or(() -> properties.findBySlugAndOwner_Id(body.propertyId(), ownerId))
                .map(Property::getId)
                .orElseThrow(() -> NotFoundException.of("Property"));

        // saveAndFlush: id and createdAt only populate at INSERT, and the DTO needs the id.
        return RentAgreementDto.of(agreements.saveAndFlush(new RentAgreement(propertyId, ownerId,
                body.tenantMobile(), body.rent(), body.deposit(), body.startDate(),
                body.durationMonths())));
    }
}
