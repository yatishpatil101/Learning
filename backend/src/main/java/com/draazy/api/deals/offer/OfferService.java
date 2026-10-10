package com.draazy.api.deals.offer;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.trust.ContactVisibility;
import com.draazy.api.common.trust.Notifier;
import com.draazy.api.common.web.Ids;
import com.draazy.api.deals.deal.DealRepository;
import com.draazy.api.finance.tenancy.TenantProfileService;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
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

/** Caller side (buyer or owner) is inferred from the JWT and stored rows, never client-declared;
 * strangers get 404, not 403. */
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

        // The body carries amount and buyer name but never the mobile: a notification is a surface,
        // and the number stays behind the contact gate.
        UUID ownerId = property.getOwner().getId();
        if (!ownerId.equals(callerId)) {
            notifier.notify(ownerId, "offer.received",
                    "New offer on " + property.getTitle(),
                    (buyer == null || buyer.getName() == null || buyer.getName().isBlank()
                            ? "Someone" : buyer.getName())
                            + " offered " + Notifier.rupees(offer.getAmount()) + ". Open the listing to respond.",
                    "/property/" + propertyId);
        }

        // Visibility goes through the same rule as the list reads; a hand-picked value drifts if the rule changes.
        ContactVisibility visibility = buyerMobileVisibility(callerId, callerId);
        // Badge is resolved by user id, not mobile: the caller's own number is revealed only on this response,
        // so a mobile lookup would work here and fail on every list read.
        boolean verified = tenantProfiles.verifiedAmong(List.of(callerId)).contains(callerId);
        return OfferMapper.toDto(offer, buyer, List.of(entry), visibility, verified);
    }

    /** Accept/decline are owner-only; counter is two-sided. Strangers get 404 so existence is not confirmed. */
    @Transactional
    public void respond(UUID callerId, UUID offerId, OfferRespondRequest body) {
        Offer offer = offers.findById(offerId)
                .orElseThrow(() -> NotFoundException.of("Offer"));

        Property property = properties.findById(offer.getPropertyId())
                .orElseThrow(() -> NotFoundException.of("Offer"));
        UUID ownerId = property.getOwner().getId();

        boolean isBuyer = callerId.equals(offer.getFromUserId());
        boolean isOwner = callerId.equals(ownerId);
        if (!isBuyer && !isOwner) {
            throw NotFoundException.of("Offer");
        }

        // Accept/decline are owner-only: otherwise a buyer could accept their own offer and unmask a mobile the
        // owner never chose to reveal. 403 not 404: the buyer is a legitimate participant, so hiding it would lie.
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

        UUID other = isOwner ? offer.getFromUserId() : ownerId;
        if (!other.equals(callerId)) {
            String title = property.getTitle();
            String[] note = switch (targetStatus) {
                case OfferStatuses.ACCEPTED -> new String[] {"Your offer was accepted",
                        "The owner accepted " + Notifier.rupees(offer.getAmount()) + " for " + title + "."};
                case OfferStatuses.DECLINED -> new String[] {"Your offer was declined",
                        "The owner declined your offer on " + title + "."};
                default -> new String[] {"New counter-offer on " + title,
                        (isOwner ? "The owner" : "The buyer") + " countered at "
                                + Notifier.rupees(offer.getAmount()) + ". Open the listing to respond."};
            };
            notifier.notify(other, "offer." + targetStatus, note[0], note[1], "/property/" + property.getId());
        }
    }

    /** Paged like {@code offersOnMine} so both sides of the offer book return the same shape. */
    @Transactional(readOnly = true)
    public Page<OfferDto> myOffers(UUID callerId, Pageable pageable) {
        Page<Offer> rows = offers.findByFromUserIdOrderByCreatedAtDesc(callerId, pageable);
        return projectPage(rows, callerId);
    }

    /** Paged because every row is written by someone else, so a successful listing's offer count is unbounded. */
    @Transactional(readOnly = true)
    public Page<OfferDto> offersOnMine(UUID callerId, Pageable pageable) {
        List<UUID> ownedPropertyIds = properties.findIdsByOwnerId(callerId);
        if (ownedPropertyIds.isEmpty()) {
            return Page.empty(pageable);
        }
        Page<Offer> rows = offers.findByPropertyIdInOrderByCreatedAtDesc(ownedPropertyIds, pageable);
        return projectPage(rows, callerId);
    }

    /** Not {@code Page.map}: it projects per element, which would put the batch loads back inside a loop. */
    private Page<OfferDto> projectPage(Page<Offer> rows, UUID viewerId) {
        return new PageImpl<>(projectOffers(rows.getContent(), viewerId),
                rows.getPageable(), rows.getTotalElements());
    }

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

        // Badge is asked by user id, not mobile: the projected mobile is masked for every viewer but the buyer,
        // and a mask cannot be turned back into the number the badge is stored against.
        Set<UUID> verifiedBuyers = tenantProfiles.verifiedAmong(buyerMap.keySet());

        return rows.stream().map(offer -> {
            User buyer = buyerMap.get(offer.getFromUserId());
            List<OfferHistory> trail = historyMap.getOrDefault(offer.getId(), List.of());
            ContactVisibility visibility = buyerMobileVisibility(viewerId, offer.getFromUserId());
            return OfferMapper.toDto(offer, buyer, trail, visibility,
                    verifiedBuyers.contains(offer.getFromUserId()));
        }).toList();
    }

    /** Each party sees only their own number; an accepted offer unlocks the conversation, not the digits. */
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
