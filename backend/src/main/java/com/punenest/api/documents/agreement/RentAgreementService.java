package com.punenest.api.documents.agreement;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.trust.MobileMask;
import com.punenest.api.common.web.Ids;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
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
    private final UserRepository users;

    public RentAgreementService(RentAgreementRepository agreements, PropertyRepository properties,
            UserRepository users) {
        this.agreements = agreements;
        this.properties = properties;
        this.users = users;
    }

    /**
     * Contract {@code myRentAgreements} — every agreement the caller is a <em>party</em> to,
     * newest first: the ones they filed as landlord, and the ones filed against them as tenant.
     *
     * <p>Both sides come back from one call because an agreement is one document with two
     * signatories, and the pages that read it — the tenant's rental hub and the owner's document
     * vault — already scope what they show by property. Splitting the two sides into two routes
     * would make the vault, which renders an owner pack and a tenancy pack side by side, issue two
     * requests to rebuild a list the server can produce in one; and a landlord who rents their own
     * home elsewhere is a single person whose "my agreements" plainly means both.
     *
     * <p>The tenant side matches on mobile rather than user id because that is the only identifier
     * the record carries for them — an owner may file an agreement before the tenant has an
     * account at all. A caller with no mobile on file therefore sees only their owner side, which
     * is the correct answer rather than a degraded one.
     */
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

        // @IndianMobile validated the shape; store the canonical ten digits so the V6 CHECK holds.
        return RentAgreementDto.of(agreements.saveAndFlush(new RentAgreement(propertyId, ownerId,
                MobileMask.normalise(body.tenantMobile()), body.rent(), body.deposit(),
                body.startDate(), body.durationMonths())));
    }
}
