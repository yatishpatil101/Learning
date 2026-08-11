package com.punenest.api.deals.offer;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.ForbiddenException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.trust.ContactVisibility;
import com.punenest.api.common.trust.Notifier;
import com.punenest.api.common.web.Ids;
import com.punenest.api.deals.deal.DealRepository;
import com.punenest.api.finance.tenancy.TenantProfileService;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import java.util.List;
import java.util.Map;
import java.util.Set;
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
    private final Notifier notifier;
    private final TenantProfileService tenantProfiles;

    public OfferService(OfferRepository offers, OfferHistoryRepository history,
                        PropertyRepository properties, UserRepository users,
                        DealRepository deals, Notifier notifier,
                        TenantProfileService tenantProfiles) {
        this.offers = offers;
        this.history = history;
        this.properties = properties;
        this.users = users;
        this.deals = deals;
        this.notifier = notifier;
        this.tenantProfiles = tenantProfiles;
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
        // The property is loaded rather than merely existence-checked because the notification
        // below needs its owner and title. Same query, one fewer round trip than fetching it twice.
        Property property = Ids.parseUuid(body.propertyId())
                .flatMap(properties::findById)
                .orElseThrow(() -> NotFoundException.of("Property"));
        UUID propertyId = property.getId();

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
            offer = new Offer(propertyId, callerId, body.amount(), body.message(), body.moveIn());
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

        // Tell the owner an offer landed (tech-debt D92). The owner is the one party who cannot
        // already know: submitting is the buyer's own action, and nothing else on the platform
        // announced it — an owner who did not happen to reopen the listing never saw the price.
        // Only the submit is announced here; a counter is answered inside a negotiation both sides
        // are already looking at, and accept/decline are the owner's own decision.
        //
        // The amount and the buyer's name go in the body; the buyer's mobile does not. D5/Q2 is a
        // global policy and a notification body is a surface — the number stays behind the contact
        // gate exactly as OfferMapper's ContactVisibility keeps it out of the offer DTO.
        //
        // Nothing here forbids an owner offering on their own listing, so the self-notify guard is
        // real rather than defensive — the same check ConversationService makes before announcing a
        // message. Telling someone their own news is the one way this writer could be worse than
        // the silence it replaces.
        UUID ownerId = property.getOwner().getId();
        if (!ownerId.equals(callerId)) {
            notifier.notify(ownerId, "offer.received",
                    "New offer on " + property.getTitle(),
                    (buyer == null || buyer.getName() == null || buyer.getName().isBlank()
                            ? "Someone" : buyer.getName())
                            + " offered \u20b9" + offer.getAmount() + ". Open the listing to respond.",
                    "/property/" + propertyId);
        }

        // Route the created-resource response through the same visibility rule as the list reads
        // rather than hardcoding a value here. The answer happens to be "revealed" -- the caller
        // is the buyer, so it is their own number -- but a second, hand-picked visibility at this
        // callsite is how the two drift apart the moment the rule changes.
        ContactVisibility visibility = buyerMobileVisibility(callerId, callerId);
        // Same reason the badge is resolved by user id everywhere else (D114): the caller's own
        // number is revealed on this one response, so a mobile lookup would happen to work here and
        // fail on every list read. Asking the identity question of the identity keeps the two paths
        // answering the same way.
        boolean verified = tenantProfiles.verifiedAmong(List.of(callerId)).contains(callerId);
        return OfferMapper.toDto(offer, buyer, List.of(entry), visibility, verified);
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
     * Contract {@code myOffers} — one page of the offers the caller MADE, newest first.
     *
     * <p><strong>Paged (D77).</strong> A buyer's own offer book grows with their own activity, but
     * it is the mirror image of {@code offersOnMine} over the same table and the same projection;
     * paging one side and not the other would leave a call site guessing which shape it gets back.
     *
     * <p>N+1-safe: one query for the page of offers, one for the users, one for the history entries
     * — of that page only, which is the point: the history join used to be over the whole book.
     */
    @Transactional(readOnly = true)
    public Page<OfferDto> myOffers(UUID callerId, Pageable pageable) {
        Page<Offer> rows = offers.findByFromUserIdOrderByCreatedAtDesc(callerId, pageable);
        return projectPage(rows, callerId);
    }

    /**
     * Contract {@code offersOnMine} — one page of the offers on the caller's own listings, newest
     * first.
     *
     * <p>Strictly owner-scoped: the property-id set comes from {@code properties.owner_id}, so a
     * caller can never see offers against someone else's listing.
     *
     * <p><strong>Paged (D77).</strong> Every row here is written by <em>somebody else</em>, so the
     * collection grows with how well the listing is doing — the owner an unpaged read punishes is
     * exactly the successful one. §5.1's "one user's own actions" test does not reach it.
     *
     * <p>N+1-safe: one query for the owner's listing ids, one for the page of offers, one for the
     * buyers on that page, one for their history entries.
     */
    @Transactional(readOnly = true)
    public Page<OfferDto> offersOnMine(UUID callerId, Pageable pageable) {
        List<UUID> ownedPropertyIds = properties.findIdsByOwnerId(callerId);
        if (ownedPropertyIds.isEmpty()) {
            return Page.empty(pageable);
        }
        Page<Offer> rows = offers.findByPropertyIdInOrderByCreatedAtDesc(ownedPropertyIds, pageable);
        return projectPage(rows, callerId);
    }

    /**
     * Project one page of offers, keeping the batch loads batched.
     *
     * <p>Deliberately not {@code Page.map}: that projects one element at a time, which would put
     * the buyer lookup and the history lookup back inside the loop this method exists to hoist out
     * of it.
     */
    private Page<OfferDto> projectPage(Page<Offer> rows, UUID viewerId) {
        return new PageImpl<>(projectOffers(rows.getContent(), viewerId),
                rows.getPageable(), rows.getTotalElements());
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

        // Batch load: which of those buyers carry the Verified Tenant badge (D114). Asked by user
        // id, not by mobile -- the mobile on the way out is masked for every viewer but the buyer
        // themselves, and a mask cannot be turned back into the number the badge is stored against.
        // Deriving the badge from what the projection emits would answer "unverified" for the whole
        // page, which is exactly the live bug this replaces.
        Set<UUID> verifiedBuyers = tenantProfiles.verifiedAmong(buyerMap.keySet());

        return rows.stream().map(offer -> {
            User buyer = buyerMap.get(offer.getFromUserId());
            List<OfferHistory> trail = historyMap.getOrDefault(offer.getId(), List.of());
            ContactVisibility visibility = buyerMobileVisibility(viewerId, offer.getFromUserId());
            return OfferMapper.toDto(offer, buyer, trail, visibility,
                    verifiedBuyers.contains(offer.getFromUserId()));
        }).toList();
    }

    /**
     * The reverse contact-gate question (D5 global policy): may the viewer see the <em>buyer's</em>
     * mobile? Only if the viewer is the buyer themselves — each party sees only their own number.
     * The counterparty's mobile stays masked at every offer status; an accepted offer unlocks the
     * in-app conversation, not the digits, and no raw number is exchanged before a signed deal.
     */
    private ContactVisibility buyerMobileVisibility(UUID viewerId, UUID buyerUserId) {
        return viewerId.equals(buyerUserId) ? ContactVisibility.REVEALED : ContactVisibility.MASKED;
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
