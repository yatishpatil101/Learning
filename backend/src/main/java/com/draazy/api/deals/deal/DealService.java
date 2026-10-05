package com.draazy.api.deals.deal;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.DealIntent;
import com.draazy.api.catalog.property.PropertyLifecycle;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.finance.tenancy.TenancyService;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.AuthPrincipal;
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

@Service
public class DealService {

    private static final Logger LOG = LoggerFactory.getLogger(DealService.class);

    private final DealRepository deals;
    private final DealPartyRepository parties;
    private final PropertyRepository properties;
    private final UserRepository users;
    private final PropertyLifecycle lifecycle;

    // Deal state owns tenancy side effects, so the transaction crosses into finance.
    private final TenancyService tenancyService;

    public DealService(DealRepository deals, DealPartyRepository parties,
                       PropertyRepository properties, UserRepository users,
                       PropertyLifecycle lifecycle, TenancyService tenancyService) {
        this.deals = deals;
        this.parties = parties;
        this.properties = properties;
        this.users = users;
        this.lifecycle = lifecycle;
        this.tenancyService = tenancyService;
    }

    @Transactional(readOnly = true)
    public Page<DealDto> myDeals(UUID callerId, Pageable pageable) {
        List<UUID> ownedPropertyIds = properties.findIdsByOwnerId(callerId);
        if (ownedPropertyIds.isEmpty()) {
            return Page.empty(pageable);
        }

        Page<Deal> rows = deals.findByPropertyIdInOrderByCreatedAtDesc(ownedPropertyIds, pageable);

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

    @Transactional
    public void reserve(UUID callerId, UUID propertyId) {
        Property property = ownedProperty(callerId, propertyId);
        Deal deal = getOrCreate(propertyId, property.getDeal());

        if (!DealStatuses.canTransition(deal.getStatus(), DealStatuses.RESERVED)) {
            throw new ConflictException("Cannot reserve a deal in status " + deal.getStatus());
        }
        deal.setStatus(DealStatuses.RESERVED);
        deals.save(deal);

        property.setDealStatus(DealStatuses.RESERVED);
    }

    @Transactional
    public void close(UUID callerId, UUID propertyId, DealCloseRequest body) {
        Property property = ownedProperty(callerId, propertyId);
        requireApprovedForClose(property);
        Deal deal = getOrCreate(propertyId, property.getDeal());

        if (!DealStatuses.canTransition(deal.getStatus(), DealStatuses.CLOSED)) {
            throw new ConflictException("Cannot close a deal in status " + deal.getStatus());
        }

        String normalised = MobileMask.normalise(body.counterpartyMobile());
        if (normalised == null) {

            throw new BadRequestException("counterpartyMobile must be a 10-digit mobile number");
        }
        deal.setCounterpartyMobile(normalised);
        deal.setAgreedPrice(body.agreedPrice());
        deal.setNote(body.note());
        deal.setStatus(DealStatuses.CLOSED);
        deal.setClosedAt(Instant.now());

        property.setStatus(terminalStatusFor(property));
        property.setDealStatus(DealStatuses.CLOSED);

        users.findByMobile(normalised)
                .ifPresent(user -> deal.setCounterpartyId(user.getId()));

        deals.save(deal);

        // The counterpart of close: a reopened rent listing must end its tenancy, or the active
        // uniqueness index stays occupied and the next tenant can never be let in. Ended, never deleted.
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

    // @IndianMobile validated the shape; store the canonical ten digits so a later masked read
    // resolves — DealParty is otherwise persisted verbatim.
    @Transactional
    public void reopen(AuthPrincipal caller, UUID propertyId) {
        Property property = ownedProperty(caller.userId(), propertyId);
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

        if (!property.isArchived() && (PropertyStatus.SOLD.equals(property.getStatus())
                || PropertyStatus.RENTED.equals(property.getStatus()))) {
            lifecycle.reenterPending(caller, property);
            property.recordResubmission();
        }
        property.setDealStatus(DealStatuses.ACTIVE);

        if (DealIntent.RENT.equals(property.getDeal())) {
            tenancyService.endActiveTenancy(propertyId);
        }
    }

    @Transactional(readOnly = true)
    public List<DealPartyDto> listParties(UUID callerId, UUID propertyId) {
        ownedProperty(callerId, propertyId);
        return deals.findByPropertyId(propertyId)
                .map(deal -> parties.findLiveByDealId(deal.getId()).stream()
                        .map(DealMapper::toPartyDto)
                        .toList())
                .orElse(List.of());
    }

    @Transactional
    public void closeForFinalization(UUID ownerId, UUID propertyId, long agreedPrice,
                                     String counterpartyMobile, UUID counterpartyId) {
        Property property = ownedProperty(ownerId, propertyId);
        requireApprovedForClose(property);
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

        property.setStatus(terminalStatusFor(property));
        property.setDealStatus(DealStatuses.CLOSED);
    }

    private Property ownedProperty(UUID callerId, UUID propertyId) {
        return properties.findByIdAndOwner_Id(propertyId, callerId)
                .orElseThrow(() -> NotFoundException.of("Property"));
    }

    private static String terminalStatusFor(Property property) {
        return DealIntent.RENT.equals(property.getDeal())
                ? PropertyStatus.RENTED : PropertyStatus.SOLD;
    }

    private static void requireApprovedForClose(Property property) {
        if (property.isArchived() || !PropertyStatus.APPROVED.equals(property.getStatus())) {
            throw new ConflictException("Only a live approved listing can be closed");
        }
    }

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
