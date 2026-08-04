package com.punenest.api.deals.offer;

import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.ForbiddenException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.trust.ContactVisibility;
import com.punenest.api.common.web.Ids;
import com.punenest.api.deals.deal.DealRepository;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.leads.contact.ContactRequestRepository;
import com.punenest.api.leads.contact.ContactRequestStatuses;
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
 * The offer negotiation lifecycle: submit, respond (accept/decline/counter), and the two
 * list reads (my offers, offers on my listings).
 *
 * <p><strong>Direction inference (reconciliation item b).</strong> The caller is either the offer's
 * author (the buyer) or the listing owner — determined server-side from the JWT and the stored
 * rows. Anyone else gets 404 (not 403). The inferred side is written into
 * {@code offer_history.by}, preserving two-sided negotiation without trusting the client to
 * declare which side it is.
 *
 * <p><strong>Cross-context reads.</strong> This service reads {@code catalog.property} and
 * {@code identity.user} repositories directly — same documented exception as the contacts feature
 * (see slice-3 cross-context decision in {@code tasks/todo.md}).
 */
@Service
public class OfferService {

    private static final Logger LOG = LoggerFactory.getLogger(OfferService.class);

    private final OfferRepository offers;
    private final OfferHistoryRepository history;
    private final PropertyRepository properties;
    private final UserRepository users;
    private final DealRepository deals;
    private final ContactRequestRepository contactRequests;

    public OfferService(OfferRepository offers, OfferHistoryRepository history,
                        PropertyRepository properties, UserRepository users,
                        DealRepository deals, ContactRequestRepository contactRequests) {
        this.offers = offers;
        this.history = history;
        this.properties = properties;
        this.users = users;
        this.deals = deals;
        this.contactRequests = contactRequests;
    }

    /**
     * Contract {@code submitOffer} — buyer submits a price offer on a listing.
     *
     * <p>Invariants enforced:
     * <ul>
     *   <li>Property must exist and not be archived (404).</li>
     *   <li>No closed deal on this property (409).</li>
     *   <li>No existing live offer by this user on this property (409 — duplicate).</li>
     *   <li>A history row is appended with {@code by='buyer'} (the submit event).</li>
     * </ul>
     *
     * @throws NotFoundException when the property does not exist
     * @throws ConflictException when a closed deal blocks or a live offer already exists
     */
    @Transactional
    public OfferDto submit(UUID callerId, OfferCreateRequest body) {
        UUID propertyId = Ids.parseUuid(body.propertyId()).orElse(null);
        if (propertyId == null || properties.findById(propertyId).isEmpty()) {
            throw NotFoundException.of("Property");
        }

        // Closed deal blocks new offers.
        if (deals.findClosedByPropertyId(propertyId).isPresent()) {
            throw new ConflictException("A closed deal exists on this property");
        }

        // Duplicate prevention: service-level check for a clean error message.
        if (offers.findLiveByUserAndProperty(callerId, propertyId).isPresent()) {
            throw new ConflictException("You already have a live offer on this property");
        }

        Offer offer;
        try {
            offer = new Offer(propertyId, callerId, body.amount(), body.message());
            offer = offers.saveAndFlush(offer);
        } catch (DataIntegrityViolationException constraintViolation) {
            // The partial unique index uq_offers_live_per_user_property caught a concurrent
            // double-tap that slipped past the service-level check.
            LOG.debug("Concurrent duplicate offer for user {} on property {}", callerId, propertyId);
            throw new ConflictException("You already have a live offer on this property");
        }

        // History row: the submit event.
        OfferHistory entry = new OfferHistory(offer.getId(), offer.getAmount(), OfferStatuses.BY_BUYER);
        history.saveAndFlush(entry);

        User buyer = users.findById(callerId).orElse(null);
        // Route the created-resource response through the same visibility rule as the list reads
        // rather than hardcoding a value here. The answer happens to be "revealed" -- the caller
        // is the buyer, so it is their own number -- but a second, hand-picked visibility at this
        // callsite is how the two drift apart the moment the rule changes.
        ContactVisibility visibility = buyerMobileVisibility(
                callerId, callerId, propertyId, offer.getStatus());
        return OfferMapper.toDto(offer, buyer, List.of(entry), visibility);
    }

    /**
     * Contract {@code respondOffer} — accept, decline, or counter an offer.
     *
     * <p><strong>Scoping.</strong> The caller must be either the offer's author (buyer) or the
     * property's owner. Anyone else → 404 (not 403 — do not confirm existence).
     *
     * <p><strong>Who may do what.</strong> {@code accept} and {@code decline} are the owner's
     * decision alone (403 for the buyer). {@code counter} is two-sided — either participant may
     * counter, which is what makes this a negotiation.
     *
     * <p><strong>Direction inference.</strong> If the caller is the author, direction = buyer.
     * If the caller is the property owner, direction = owner. This determines which side the
     * history entry records.
     *
     * <p><strong>Withdraw.</strong> Only the offer's author may withdraw. The spec has no
     * explicit withdraw endpoint in the four ops, but {@code canTransition} models the state.
     *
     * @throws NotFoundException when the offer is unknown or the caller is not a participant
     * @throws ConflictException on an illegal state transition
     */
    @Transactional
    public void respond(UUID callerId, UUID offerId, OfferRespondRequest body) {
        Offer offer = offers.findById(offerId)
                .orElseThrow(() -> NotFoundException.of("Offer"));

        UUID ownerId = properties.findById(offer.getPropertyId())
                .map(p -> p.getOwner().getId())
                .orElseThrow(() -> NotFoundException.of("Offer"));

        boolean isBuyer = callerId.equals(offer.getFromUserId());
        boolean isOwner = callerId.equals(ownerId);
        if (!isBuyer && !isOwner) {
            throw NotFoundException.of("Offer");
        }

        // Accept and decline are the owner's decision alone. Counter is the one two-sided action:
        // either side may counter, which is what makes this a negotiation rather than a form
        // submission. Without this split a buyer could accept their own offer -- marking a price
        // as agreed with no owner involvement at all, and (via the status-driven reveal below)
        // unmasking a mobile the owner never chose to see. 403 rather than 404 here on purpose:
        // the buyer is a legitimate participant who may read this offer, they just may not decide
        // it, so hiding its existence would be a lie.
        if (!isOwner && !OfferActions.COUNTER.equals(body.action())) {
            throw new ForbiddenException("Only the listing owner can " + body.action() + " an offer");
        }

        // Counter requires a counterAmount. Checked before the transition so a malformed payload
        // is a 422-family error rather than being reported as an illegal state change.
        if (OfferActions.COUNTER.equals(body.action()) && body.counterAmount() == null) {
            throw new BadRequestException("counterAmount is required when action is 'counter'");
        }

        String targetStatus = mapActionToStatus(body.action(), body.counterAmount());

        if (!OfferStatuses.canTransition(offer.getStatus(), targetStatus)) {
            throw new ConflictException("Cannot " + body.action() + " an offer in status "
                    + offer.getStatus());
        }

        offer.setStatus(targetStatus);
        if (body.message() != null) {
            offer.setMessage(body.message());
        }
        if (OfferActions.COUNTER.equals(body.action())) {
            offer.setAmount(body.counterAmount());
        }
        offers.save(offer);

        // History: append on counter only (submit is in submit(), accept/decline are terminal
        // status changes, not amount events — reconciliation item i).
        if (OfferActions.COUNTER.equals(body.action())) {
            String by = isBuyer ? OfferStatuses.BY_BUYER : OfferStatuses.BY_OWNER;
            history.save(new OfferHistory(offer.getId(), body.counterAmount(), by));
        }
    }

    /**
     * Contract {@code myOffers} — offers the caller MADE, newest first.
     *
     * <p>N+1-safe: one query for the offers, one for the users (authors = caller, trivial),
     * one for the history entries.
     */
    @Transactional(readOnly = true)
    public List<OfferDto> myOffers(UUID callerId) {
        List<Offer> rows = offers.findByFromUserIdOrderByCreatedAtDesc(callerId);
        return projectOffers(rows, callerId);
    }

    /**
     * Contract {@code offersOnMine} — offers on the caller's own listings.
     *
     * <p>Strictly owner-scoped: the property-id set comes from {@code properties.owner_id}, so a
     * caller can never see offers against someone else's listing.
     *
     * <p>N+1-safe: one query for the owner's listing ids, one for the offers, one for the
     * buyers, one for the history entries.
     */
    @Transactional(readOnly = true)
    public List<OfferDto> offersOnMine(UUID callerId) {
        List<UUID> ownedPropertyIds = properties.findIdsByOwnerId(callerId);
        if (ownedPropertyIds.isEmpty()) {
            return List.of();
        }
        List<Offer> rows = offers.findByPropertyIdInOrderByCreatedAtDesc(ownedPropertyIds);
        return projectOffers(rows, callerId);
    }

    /**
     * Project a list of offers into DTOs with N+1-safe batch loading.
     *
     * @param rows     the offer entities
     * @param viewerId the viewer (to determine mobile visibility)
     */
    private List<OfferDto> projectOffers(List<Offer> rows, UUID viewerId) {
        if (rows.isEmpty()) {
            return List.of();
        }

        // Batch load: all distinct buyer ids.
        Map<UUID, User> buyerMap = users.findAllById(
                        rows.stream().map(Offer::getFromUserId).distinct().toList())
                .stream().collect(Collectors.toMap(User::getId, Function.identity()));

        // Batch load: all history entries for these offers.
        List<UUID> offerIds = rows.stream().map(Offer::getId).toList();
        Map<UUID, List<OfferHistory>> historyMap = history.findByOfferIdInOrderByAtAsc(offerIds)
                .stream().collect(Collectors.groupingBy(OfferHistory::getOfferId));

        return rows.stream().map(offer -> {
            User buyer = buyerMap.get(offer.getFromUserId());
            List<OfferHistory> trail = historyMap.getOrDefault(offer.getId(), List.of());
            ContactVisibility visibility = buyerMobileVisibility(
                    viewerId, offer.getFromUserId(), offer.getPropertyId(), offer.getStatus());
            return OfferMapper.toDto(offer, buyer, trail, visibility);
        }).toList();
    }

    /**
     * The reverse contact-gate question (D5): may the viewer see the <em>buyer's</em> mobile?
     *
     * <p>An offer is itself an approach. The buyer's mobile stays masked until:
     * <ul>
     *   <li>the offer is {@code accepted} (the owner acted), <strong>or</strong></li>
     *   <li>an {@code approved} contact request exists for (buyer → property)</li>
     * </ul>
     *
     * <p>If the viewer IS the buyer, they always see their own mobile.
     *
     * <p>This is the reverse of {@code ContactGate.visibilityFor(viewer, property, owner)}, which
     * answers "may this viewer see the <em>owner's</em> mobile". That port cannot answer this
     * question, so we implement it explicitly, reusing {@link MobileMask} via the mapper.
     */
    private ContactVisibility buyerMobileVisibility(UUID viewerId, UUID buyerUserId,
                                                     UUID propertyId, String offerStatus) {
        // The buyer always sees their own number.
        if (viewerId.equals(buyerUserId)) {
            return ContactVisibility.REVEALED;
        }
        // Owner sees the buyer's number once they've accepted.
        if (OfferStatuses.ACCEPTED.equals(offerStatus)) {
            return ContactVisibility.REVEALED;
        }
        // Or if an approved contact request exists for this buyer on this property.
        if (contactRequests.existsByRequesterIdAndPropertyIdAndStatus(
                buyerUserId, propertyId, ContactRequestStatuses.APPROVED)) {
            return ContactVisibility.REVEALED;
        }
        return ContactVisibility.MASKED;
    }

    private static String mapActionToStatus(String action, Long counterAmount) {
        return switch (action) {
            case OfferActions.ACCEPT -> OfferStatuses.ACCEPTED;
            case OfferActions.DECLINE -> OfferStatuses.DECLINED;
            case OfferActions.COUNTER -> OfferStatuses.COUNTERED;
            default -> throw new BadRequestException("Unknown action: " + action);
        };
    }
}
