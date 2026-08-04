package com.punenest.api.deals.deal;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.DealIntent;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.trust.MobileMask;
import com.punenest.api.finance.tenancy.TenancyService;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The deal lifecycle: reserve, close, reopen, and the under-offer parties scratchpad.
 *
 * <p><strong>Owner-only.</strong> Every operation is scoped to the listing's owner (from the JWT).
 * A non-owner gets 404, never 403 — do not confirm existence.
 *
 * <p><strong>Lazy create (reconciliation item d).</strong> No stored row = active. Rows are
 * created on the first write ({@code reserve}/{@code close}/{@code addParty}). The unique index
 * {@code uq_deals_property} guarantees concurrent lazy creates cannot fork a listing into two
 * deals; {@link DataIntegrityViolationException} is caught and the winner re-read, exactly as
 * A1 does for duplicate offers.
 *
 * <p><strong>Reopen clears close-time fields.</strong> A reopened listing is back on the market;
 * stale agreed terms (price, counterparty, note) are misleading. {@code agreed_price},
 * {@code counterparty_id}, {@code counterparty_mobile}, {@code note}, and {@code closed_at} are
 * all nulled. The reasoning: a Pune owner who reopens after a deal fell through should not see
 * the old buyer's mobile and agreed price as if they were still valid — that data belonged to
 * the failed transaction and would mislead any new negotiation.
 */
@Service
public class DealService {

    private static final Logger LOG = LoggerFactory.getLogger(DealService.class);

    private final DealRepository deals;
    private final DealPartyRepository parties;
    private final PropertyRepository properties;
    private final UserRepository users;

    /**
     * The tenancy lifecycle (D1). Closing a rent deal opens a tenancy and reopening ends it, both
     * inside this service's transaction — {@code finance} ranks below {@code deals} in the layering
     * precisely so this arrow may point this way.
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
     * Contract {@code myDeals} — all deals on the caller's own listings.
     *
     * <p>N+1-safe: one query for the owner's listing ids, one for the deal rows, one for the
     * counterparty users.
     */
    @Transactional(readOnly = true)
    public List<DealDto> myDeals(UUID callerId) {
        List<UUID> ownedPropertyIds = properties.findIdsByOwnerId(callerId);
        if (ownedPropertyIds.isEmpty()) {
            return List.of();
        }

        List<Deal> rows = deals.findByPropertyIdIn(ownedPropertyIds);

        // Batch load counterparty users.
        List<UUID> counterpartyIds = rows.stream()
                .map(Deal::getCounterpartyId)
                .filter(id -> id != null)
                .distinct()
                .toList();
        Map<UUID, User> userMap = counterpartyIds.isEmpty()
                ? Map.of()
                : users.findAllById(counterpartyIds).stream()
                        .collect(Collectors.toMap(User::getId, Function.identity()));

        return rows.stream()
                .map(deal -> {
                    User cp = deal.getCounterpartyId() != null
                            ? userMap.get(deal.getCounterpartyId()) : null;
                    return DealMapper.toDto(deal, cp);
                })
                .toList();
    }

    /**
     * Contract {@code getDeal} — deal status for one property.
     *
     * <p>Returns a <strong>synthesized active Deal</strong> when no row exists (reconciliation
     * item d). 404 only if the property does not exist or is not the caller's.
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
     * Contract {@code reserveDeal} — marks the property under offer.
     *
     * @throws NotFoundException when the property does not exist or is not the caller's
     * @throws ConflictException on an illegal state transition
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
    }

    /**
     * Contract {@code closeDeal} — closes the deal (sold/rented).
     *
     * <p><strong>Off-platform close.</strong> {@code counterpartyMobile} may be a mobile with no
     * registered account — for a Pune owner the buyer is very often found off-platform. The mobile
     * is normalised to the last 10 digits (matching how {@code identity.user} normalises mobiles)
     * and stored in {@code deals.counterparty_mobile}. {@code counterparty_id} is populated only
     * when the mobile resolves to a registered user.
     *
     * <p><strong>{@code properties.status} is NOT touched (D4).</strong>
     *
     * @throws NotFoundException when the property does not exist or is not the caller's
     * @throws ConflictException on an illegal state transition
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
            // Fail closed rather than storing whatever arrived. A masked number strips to five
            // plausible-looking digits, so a lenient normaliser would happily persist a mask as
            // the counterparty's identity -- the exact defect this project already shipped and
            // fixed on the client.
            throw new BadRequestException("counterpartyMobile must be a 10-digit mobile number");
        }
        deal.setCounterpartyMobile(normalised);
        deal.setAgreedPrice(body.agreedPrice());
        deal.setNote(body.note());
        deal.setStatus(DealStatuses.CLOSED);
        deal.setClosedAt(Instant.now());

        // Resolve the counterparty user if the mobile is registered.
        users.findByMobile(normalised)
                .ifPresent(user -> deal.setCounterpartyId(user.getId()));

        deals.save(deal);

        // D1: closing a RENT deal opens the tenancy, in this transaction. A rented flat with no
        // tenancy row would leave the owner unable to collect rent through the platform and the
        // tenant with no agreement to point at -- and rent_payments/rent_mandates hang off the
        // tenancy, so the gap is not cosmetic. Buy deals get nothing: there is no ongoing
        // relationship to model once the sale closes.
        //
        // Returns empty when the counterparty is off-platform, which is common and fine -- see
        // TenancyService.openFromClosedDeal.
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
     * Contract {@code reopenDeal} — moves a closed or reserved deal back to active.
     *
     * <p><strong>Clears close-time fields.</strong> A reopened listing is back on the market.
     * Stale agreed terms (price, counterparty mobile, counterparty id, note) are misleading —
     * they belonged to the old (now-failed) transaction. The owner who reopens after a deal fell
     * through should not see the previous buyer's number and agreed price as if they were still
     * valid; that data would mislead any new negotiation and, for a mobile, would keep a stale
     * personal identifier attached to a listing that is about to attract a new audience.
     * {@code closed_at} is also cleared.
     *
     * @throws NotFoundException when the property does not exist or is not the caller's
     * @throws ConflictException on an illegal state transition (e.g. reopening an active deal)
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

        // D1, the counterpart of close: a reopened rent listing is back on the market, so the
        // tenancy it opened must end. Left active, it would keep uq_tenancies_active_per_property
        // occupied and the next tenant could never be let in -- and the old tenant would keep
        // appearing as the current occupant of a flat they have left. `ended`, never deleted: who
        // lived there is the record, and rent payments hang off that row.
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
     * Contract {@code addParty} — adds an off-platform interested party.
     *
     * <p><strong>Auto-reserve (reconciliation: parties require a reserved deal).</strong> If the
     * deal is {@code active}, it transitions to {@code reserved} — that IS the owner's intent
     * when they start jotting down interested parties. If the deal is {@code closed}, a 409 is
     * returned.
     *
     * @throws NotFoundException when the property does not exist or is not the caller's
     * @throws ConflictException when the deal is closed
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
        }

        DealParty party = new DealParty(deal.getId(), body.name(), body.mobile(), body.note());
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
     * Close the deal as a side-effect of finalization acceptance (the finalization seam).
     *
     * <p>Called transactionally from {@code FinalizationService.accept}. This entry point exists
     * specifically so finalization can close a deal without duplicating deal-close logic or writing
     * to the deals table directly. It is narrowly scoped: it does not check ownership (the
     * finalization service has already authorised the counterparty) and it does not validate the
     * mobile (the initiator was already resolved to a registered user at request time).
     *
     * <p><strong>Throws {@link ConflictException} if the deal is already closed</strong>, which
     * causes the caller's transaction to roll back. This is the atomicity guarantee: if the deal
     * close fails, no finalization request is left {@code accepted}.
     *
     * @param ownerId      the listing owner (counterparty in finalization)
     * @param propertyId   the listing being finalized
     * @param agreedPrice  whole INR
     * @param counterpartyMobile the initiator's mobile (already normalised at request time)
     * @param counterpartyId     the initiator's user id
     * @throws ConflictException when the deal cannot transition to closed
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
     * Get or lazily create the deal row for a property. Catches
     * {@link DataIntegrityViolationException} from the {@code uq_deals_property} unique index
     * and re-reads the winner, exactly as A1 does for duplicate offers.
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
