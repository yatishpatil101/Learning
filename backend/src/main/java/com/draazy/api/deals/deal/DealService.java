package com.draazy.api.deals.deal;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.DealIntent;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.finance.tenancy.TenancyService;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The deal lifecycle: reserve, close, reopen, and the under-offer parties scratchpad. Every
 * operation is owner-only. Rationale: docs/flows/consumer/deals-offers-finalization.md#service.
 */
@Service
public class DealService {

    private static final Logger LOG = LoggerFactory.getLogger(DealService.class);

    private final DealRepository deals;
    private final DealPartyRepository parties;
    private final PropertyRepository properties;
    private final UserRepository users;

    /**
     * The tenancy lifecycle. Closing a rent deal opens a tenancy and reopening ends it, both inside
     * this service's transaction — {@code finance} ranks below {@code deals} so this arrow may point.
     */
    private final TenancyService tenancyService;

    public DealService(DealRepository deals, DealPartyRepository parties,
                       PropertyRepository properties, UserRepository users,
                       TenancyService tenancyService) {
        this.deals = deals;
        this.parties = parties;
        this.properties = properties;
        this.users = users;
        this.tenancyService = tenancyService;
    }

    /**
     * Contract {@code myDeals} — one page of the deals on the caller's own listings, newest first.
     * N+1-safe at three queries: owner listing ids, the page of rows, that page's counterparties.
     */
    @Transactional(readOnly = true)
    public Page<DealDto> myDeals(UUID callerId, Pageable pageable) {
        List<UUID> ownedPropertyIds = properties.findIdsByOwnerId(callerId);
        if (ownedPropertyIds.isEmpty()) {
            return Page.empty(pageable);
        }

        Page<Deal> rows = deals.findByPropertyIdInOrderByCreatedAtDesc(ownedPropertyIds, pageable);

        // Batch load counterparty users.
        List<UUID> counterpartyIds = rows.getContent().stream()
                .map(Deal::getCounterpartyId)
                .filter(id -> id != null)
                .distinct()
                .toList();
        Map<UUID, User> userMap = counterpartyIds.isEmpty()
                ? Map.of()
                : users.findAllById(counterpartyIds).stream()
                        .collect(Collectors.toMap(User::getId, Function.identity()));

        List<DealDto> content = rows.getContent().stream()
                .map(deal -> {
                    User cp = deal.getCounterpartyId() != null
                            ? userMap.get(deal.getCounterpartyId()) : null;
                    return DealMapper.toDto(deal, cp);
                })
                .toList();
        return new PageImpl<>(content, rows.getPageable(), rows.getTotalElements());
    }

    /**
     * Contract {@code getDeal} — deal status for one property, synthesizing an active Deal when no
     * row exists. 404 only if the property does not exist or is not the caller's.
     */
    @Transactional(readOnly = true)
    public DealDto getDeal(UUID callerId, UUID propertyId) {
        Property property = ownedProperty(callerId, propertyId);
        return deals.findByPropertyId(propertyId)
                .map(deal -> {
                    User counterparty = deal.getCounterpartyId() != null
                            ? users.findById(deal.getCounterpartyId()).orElse(null)
                            : null;
                    return DealMapper.toDto(deal, counterparty);
                })
                .orElseGet(() -> DealMapper.synthesizeActive(
                        propertyId.toString(), property.getDeal()));
    }

    /**
     * Contract {@code reserveDeal} — marks the property under offer. 404 when the property is not
     * the caller's, 409 on an illegal state transition.
     */
    @Transactional
    public void reserve(UUID callerId, UUID propertyId) {
        Property property = ownedProperty(callerId, propertyId);
        Deal deal = getOrCreate(propertyId, property.getDeal());

        if (!DealStatuses.canTransition(deal.getStatus(), DealStatuses.RESERVED)) {
            throw new ConflictException("Cannot reserve a deal in status " + deal.getStatus());
        }
        deal.setStatus(DealStatuses.RESERVED);
        deals.save(deal);
        // Mirror the reserved state so the listing badges "under offer". Moderation status stays
        // approved: a reserved listing is still live and still takes offers.
        property.setDealStatus(DealStatuses.RESERVED);
    }

    /**
     * Contract {@code closeDeal} — closes the deal (sold/rented) and publishes the outcome on the
     * listing. Rationale: docs/flows/consumer/deals-offers-finalization.md#service.
     */
    @Transactional
    public void close(UUID callerId, UUID propertyId, DealCloseRequest body) {
        Property property = ownedProperty(callerId, propertyId);
        Deal deal = getOrCreate(propertyId, property.getDeal());

        if (!DealStatuses.canTransition(deal.getStatus(), DealStatuses.CLOSED)) {
            throw new ConflictException("Cannot close a deal in status " + deal.getStatus());
        }

        String normalised = MobileMask.normalise(body.counterpartyMobile());
        if (normalised == null) {
            // Fail closed rather than storing whatever arrived: a masked number strips to five
            // plausible-looking digits, which a lenient normaliser would persist as an identity.
            throw new BadRequestException("counterpartyMobile must be a 10-digit mobile number");
        }
        deal.setCounterpartyMobile(normalised);
        deal.setAgreedPrice(body.agreedPrice());
        deal.setNote(body.note());
        deal.setStatus(DealStatuses.CLOSED);
        deal.setClosedAt(Instant.now());

        // Publish the outcome on the listing itself: the terminal moderation status drops it from
        // the approved-floored search, and the mirror stops a direct-link buyer seeing an offer form.
        property.setStatus(terminalStatusFor(property));
        property.setDealStatus(DealStatuses.CLOSED);

        // Resolve the counterparty user if the mobile is registered.
        users.findByMobile(normalised)
                .ifPresent(user -> deal.setCounterpartyId(user.getId()));

        deals.save(deal);

        // Closing a RENT deal opens the tenancy in this transaction; a rented flat with no tenancy
        // row leaves every downstream tenancy surface with nothing to read. Buy deals get nothing.
        if (DealIntent.RENT.equals(property.getDeal())) {
            tenancyService.openFromClosedDeal(
                            propertyId, callerId, deal.getCounterpartyId(), body.agreedPrice())
                    .ifPresentOrElse(
                            tenancy -> LOG.info("Tenancy {} active on rent close of property {}",
                                    tenancy.getId(), propertyId),
                            () -> LOG.info("Rent deal closed off-platform on property {}; "
                                    + "no tenancy opened", propertyId));
        }
    }

    /**
     * Contract {@code reopenDeal} — moves a closed or reserved deal back to active, clearing every
     * close-time field. Rationale: docs/flows/consumer/deals-offers-finalization.md#service.
     */
    @Transactional
    public void reopen(UUID callerId, UUID propertyId) {
        Property property = ownedProperty(callerId, propertyId);
        Deal deal = deals.findByPropertyId(propertyId)
                .orElseThrow(() -> new ConflictException(
                        "Cannot reopen a deal in status " + DealStatuses.ACTIVE));

        if (!DealStatuses.canTransition(deal.getStatus(), DealStatuses.ACTIVE)) {
            throw new ConflictException("Cannot reopen a deal in status " + deal.getStatus());
        }

        deal.setStatus(DealStatuses.ACTIVE);
        deal.setClosedAt(null);
        deal.setAgreedPrice(null);
        deal.setCounterpartyId(null);
        deal.setCounterpartyMobile(null);
        deal.setNote(null);
        deals.save(deal);

        // Back on the market: revert a terminal status to approved and clear the mirror. A
        // reserved-only reopen already had status approved, so setStatus is a no-op there.
        if (!property.isArchived() && (PropertyStatus.SOLD.equals(property.getStatus())
                || PropertyStatus.RENTED.equals(property.getStatus()))) {
            property.setStatus(PropertyStatus.APPROVED);
        }
        property.setDealStatus(DealStatuses.ACTIVE);

        // The counterpart of close: a reopened rent listing must end its tenancy, or the active
        // uniqueness index stays occupied and the next tenant can never be let in. Ended, never deleted.
        if (DealIntent.RENT.equals(property.getDeal())) {
            tenancyService.endActiveTenancy(propertyId);
        }
    }

    /**
     * Contract {@code listParties} — the under-offer parties on a deal.
     *
     * @throws NotFoundException when the property does not exist or is not the caller's
     */
    @Transactional(readOnly = true)
    public List<DealPartyDto> listParties(UUID callerId, UUID propertyId) {
        ownedProperty(callerId, propertyId);
        return deals.findByPropertyId(propertyId)
                .map(deal -> parties.findLiveByDealId(deal.getId()).stream()
                        .map(DealMapper::toPartyDto)
                        .toList())
                .orElse(List.of());
    }

    /**
     * Contract {@code addParty} — adds an off-platform interested party. An {@code active} deal
     * auto-reserves, since that is the owner's intent; a {@code closed} one is a 409.
     */
    @Transactional
    public DealPartyDto addParty(UUID callerId, UUID propertyId, DealPartyCreateRequest body) {
        Property property = ownedProperty(callerId, propertyId);
        Deal deal = getOrCreate(propertyId, property.getDeal());

        if (DealStatuses.CLOSED.equals(deal.getStatus())) {
            throw new ConflictException("Cannot add parties to a closed deal");
        }

        // Auto-reserve: adding a party to an active deal implies the owner is marking it
        // under offer.
        if (DealStatuses.ACTIVE.equals(deal.getStatus())) {
            deal.setStatus(DealStatuses.RESERVED);
            deals.save(deal);
            // Mirror the reserved state so the listing badges "under offer". Moderation
            // status stays approved — a reserved listing is still live and still takes offers.
            property.setDealStatus(DealStatuses.RESERVED);
        }

        // @IndianMobile validated the shape; store the canonical ten digits so a later masked read
        // resolves — DealParty is otherwise persisted verbatim.
        DealParty party = new DealParty(
                deal.getId(), body.name(), MobileMask.normalise(body.mobile()), body.note());
        party = parties.saveAndFlush(party);
        return DealMapper.toPartyDto(party);
    }

    /**
     * Contract {@code removeParty} — soft-deletes a party from a deal.
     *
     * @throws NotFoundException when the property/deal/party is not found or not the caller's
     */
    @Transactional
    public void removeParty(UUID callerId, UUID propertyId, UUID partyId) {
        ownedProperty(callerId, propertyId);
        Deal deal = deals.findByPropertyId(propertyId)
                .orElseThrow(() -> NotFoundException.of("Party"));
        DealParty party = parties.findLiveByIdAndDealId(partyId, deal.getId())
                .orElseThrow(() -> NotFoundException.of("Party"));
        party.setDeletedAt(Instant.now());
        parties.saveAndFlush(party);
    }

    /**
     * Close the deal as a side-effect of finalization acceptance, called transactionally from
     * {@code FinalizationService.accept}. Rationale: docs/flows/consumer/deals-offers-finalization.md.
     */
    @Transactional
    public void closeForFinalization(UUID ownerId, UUID propertyId, long agreedPrice,
                                     String counterpartyMobile, UUID counterpartyId) {
        Property property = ownedProperty(ownerId, propertyId);
        Deal deal = getOrCreate(propertyId, property.getDeal());

        if (!DealStatuses.canTransition(deal.getStatus(), DealStatuses.CLOSED)) {
            throw new ConflictException("Cannot close a deal in status " + deal.getStatus());
        }

        deal.setCounterpartyMobile(counterpartyMobile);
        deal.setCounterpartyId(counterpartyId);
        deal.setAgreedPrice(agreedPrice);
        deal.setStatus(DealStatuses.CLOSED);
        deal.setClosedAt(Instant.now());
        deals.save(deal);

        // The same terminal transition as close(), reached through the finalization seam.
        property.setStatus(terminalStatusFor(property));
        property.setDealStatus(DealStatuses.CLOSED);
    }

    // ---- internal helpers ----

    /**
     * Verify the caller owns the property. Returns the property for its deal intent. 404 if the
     * property does not exist or is not the caller's — never 403 (do not confirm existence).
     */
    private Property ownedProperty(UUID callerId, UUID propertyId) {
        return properties.findByIdAndOwner_Id(propertyId, callerId)
                .orElseThrow(() -> NotFoundException.of("Property"));
    }

    /**
     * The terminal moderation status a closed deal implies: a rent listing becomes {@code rented},
     * everything else {@code sold}, keeping an unknown intent on the safer side.
     */
    private static String terminalStatusFor(Property property) {
        return DealIntent.RENT.equals(property.getDeal())
                ? PropertyStatus.RENTED : PropertyStatus.SOLD;
    }

    /**
     * Get or lazily create the deal row for a property, catching the {@code uq_deals_property}
     * violation from a concurrent create and re-reading the winner.
     */
    private Deal getOrCreate(UUID propertyId, String dealIntent) {
        return deals.findByPropertyId(propertyId).orElseGet(() -> {
            try {
                Deal created = new Deal(propertyId, dealIntent);
                return deals.saveAndFlush(created);
            } catch (DataIntegrityViolationException constraint) {
                LOG.debug("Concurrent deal create for property {}, adopting winner", propertyId);
                return deals.findByPropertyId(propertyId)
                        .orElseThrow(() -> NotFoundException.of("Property"));
            }
        });
    }
}
