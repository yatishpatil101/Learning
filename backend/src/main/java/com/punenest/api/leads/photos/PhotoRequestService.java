package com.punenest.api.leads.photos;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.trust.Notifier;
import com.punenest.api.common.web.Ids;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The "request more photos" demand signal: a buyer asks, the owner sees who asked and how many.
 *
 * <p><strong>The lightest gate on the platform, deliberately.</strong> Sign-in only — no L2 badge, no
 * owner consent, no quota. All three exist on the contact gate because that one hands over a phone
 * number; this one hands over nothing, in either direction (see {@link PhotoRequestResponse}). Adding
 * a quota here would be actively wrong: the value of the signal is precisely that it is cheap enough
 * for every interested buyer to send, and a rationed demand signal measures the ration.
 */
@Service
public class PhotoRequestService {

    private final PhotoRequestRepository photoRequests;
    private final PropertyRepository properties;
    private final UserRepository users;
    private final PhotoRequestMapper mapper;
    private final Notifier notifier;

    public PhotoRequestService(PhotoRequestRepository photoRequests, PropertyRepository properties,
            UserRepository users, PhotoRequestMapper mapper, Notifier notifier) {
        this.photoRequests = photoRequests;
        this.properties = properties;
        this.users = users;
        this.mapper = mapper;
        this.notifier = notifier;
    }

    /**
     * Ask for more photos of a listing.
     *
     * <p><strong>Idempotent.</strong> A repeat from the same caller returns the original row with
     * {@code created=false} rather than inserting a second one, so a double-tap cannot inflate an
     * owner's demand count — which would make the one number this feature produces a measure of how
     * twitchy the buyer's thumb is. Two genuinely concurrent taps can both miss the probe, so
     * {@code uq_photo_requests_requester_property} (V117) is the real guarantee.
     *
     * <p><strong>Not filtered by status</strong>, matching that index: an answered request still
     * blocks a re-ask, whether the owner resolved it or declined it (V118).
     *
     * @param propertyIdOrSlug a UUID or a slug, the same either/or the detail endpoint accepts
     * @throws NotFoundException   when no such listing exists
     * @throws BadRequestException when the caller owns the listing
     */
    @Transactional
    public PhotoRequestCreateResponse request(UUID requesterId, String propertyIdOrSlug) {
        Property property = resolve(propertyIdOrSlug);

        /* Asking yourself for your own photos is not a demand signal, and letting it through would
           let an owner manufacture interest in their own listing. The UI does not offer the button
           to an owner, so this is a guard against the API being called directly, not a path a user
           can reach — hence a plain 400 rather than a modelled state. */
        User owner = property.getOwner();
        if (owner != null && owner.getId().equals(requesterId)) {
            throw new BadRequestException("You cannot request more photos of your own listing.");
        }

        return photoRequests.findByRequesterIdAndPropertyId(requesterId, property.getId())
                .map(existing -> new PhotoRequestCreateResponse(false, project(existing, property)))
                .orElseGet(() -> {
                    PhotoRequest saved =
                            photoRequests.save(new PhotoRequest(property.getId(), requesterId));
                    return new PhotoRequestCreateResponse(true, project(saved, property));
                });
    }

    /**
     * The owner's inbox: who asked for more photos of their listings, newest first, paged.
     *
     * <p>Paged from the start rather than as a later correction (the D78 lesson): this collection
     * grows with <em>demand</em> rather than with the owner's own actions, so the owner whose listing
     * is doing well is exactly the one an unpaged read would punish.
     */
    @Transactional(readOnly = true)
    public Page<PhotoRequestResponse> myRequests(UUID ownerId, Pageable pageable) {
        List<UUID> ownedPropertyIds = properties.findIdsByOwnerId(ownerId);
        if (ownedPropertyIds.isEmpty()) {
            return Page.empty(pageable);
        }
        Page<PhotoRequest> rows =
                photoRequests.findByPropertyIdInOrderByCreatedAtDesc(ownedPropertyIds, pageable);
        return rows.map(projector(rows.getContent()));
    }

    /**
     * The owner's "add photos" badge — counted in the database, for the same reason as the contact
     * gate's pending count: deriving it by filtering one page of the inbox under-counts silently the
     * moment there is a second page.
     */
    @Transactional(readOnly = true)
    public long myPendingCount(UUID ownerId) {
        List<UUID> ownedPropertyIds = properties.findIdsByOwnerId(ownerId);
        if (ownedPropertyIds.isEmpty()) {
            return 0L;
        }
        return photoRequests.countByPropertyIdInAndStatus(
                ownedPropertyIds, PhotoRequestStatuses.PENDING);
    }

    /**
     * Record the owner's answer to one request — {@code resolved} (photos added) or {@code declined}
     * (there are none coming).
     *
     * <p><strong>Owner-scoped through the listing</strong>, like the contact inbox: a request against
     * someone else's listing is a {@code 404}, never a {@code 403}, because a 403 would confirm that
     * a particular request id exists.
     *
     * <p>The decision is validated <em>here</em> rather than left to the V118 CHECK. Both are real
     * guards, but they fail differently: an unknown value reaching the database is a 500 with a
     * constraint name in it, whereas this is a 400 naming the two words that work. {@code pending}
     * is rejected too — un-answering a request is not a transition this domain offers, and the
     * entity would silently ignore it, so accepting the word would return a 200 that did nothing.
     *
     * <p>Answering also tells the buyer — see {@link #announce}. Until it did, this endpoint moved a
     * badge on the owner's screen and nothing else: the person who asked the question was the one
     * party to it who could not observe the answer.
     *
     * @throws NotFoundException   when the id is unknown, or belongs to a listing the caller does not own
     * @throws BadRequestException when {@code decision} is not a terminal status
     */
    @Transactional
    public PhotoRequestResponse decide(UUID ownerId, UUID requestId, String decision) {
        if (!PhotoRequestStatuses.isTerminal(decision)) {
            throw new BadRequestException("decision must be one of: %s, %s."
                    .formatted(PhotoRequestStatuses.RESOLVED, PhotoRequestStatuses.DECLINED));
        }
        PhotoRequest row = photoRequests.findById(requestId)
                .orElseThrow(() -> NotFoundException.of("Photo request"));
        Property property = properties.findById(row.getPropertyId())
                .orElseThrow(() -> NotFoundException.of("Photo request"));
        User owner = property.getOwner();
        if (owner == null || !owner.getId().equals(ownerId)) {
            throw NotFoundException.of("Photo request");
        }
        row.decide(decision, Instant.now());
        PhotoRequestResponse answer = project(photoRequests.save(row), property);
        announce(row.getRequesterId(), decision, answer);
        return answer;
    }

    /**
     * Tell the buyer what the owner decided.
     *
     * <p><strong>Both outcomes are announced, unlike the contact gate</strong>, which notifies on
     * approve and stays deliberately silent on decline because "a terminal no is not news the buyer
     * needs pushed at them". That reasoning does not carry across. A buyer refused a phone number
     * can read the answer off the listing — the number is still hidden, so the refusal is visible.
     * A buyer whose photo request is declined has nowhere to look at all: the gallery simply never
     * grows, which is indistinguishable from an owner who has not got round to it yet. Silence
     * would leave them waiting on photos that are never coming, and would reduce {@code declined}
     * to badge hygiene for the owner — the one thing it was added to be more than.
     *
     * <p><strong>The link points at the listing, not at the request</strong>, because the photos are
     * a property of the listing rather than a reply addressed to this buyer: everyone browsing sees
     * the same gallery. Preferring the slug over the id lands the buyer on the same URL they would
     * have reached from search, rather than a second address for the same page.
     *
     * <p>Runs inside the caller's transaction — the port demands {@code MANDATORY} — so a rollback
     * takes the announcement with the decision it reports. There is no ordering in which the buyer
     * is told about an answer the database does not hold.
     */
    private void announce(UUID requesterId, String decision, PhotoRequestResponse answer) {
        String link = "/property/"
                + (answer.propertySlug() != null ? answer.propertySlug() : answer.propertyId());
        String listing = answer.propertyTitle() != null ? answer.propertyTitle() : "the listing";
        if (PhotoRequestStatuses.RESOLVED.equals(decision)) {
            notifier.notify(requesterId, "photo.added",
                    "More photos added",
                    "The owner added more photos of %s — take a look.".formatted(listing),
                    link);
        } else {
            notifier.notify(requesterId, "photo.declined",
                    "No more photos available",
                    "The owner has shared everything they have of %s.".formatted(listing),
                    link);
        }
    }

    /*
     * Deliberately absent: auto-resolving every pending request when an owner uploads photos.
     *
     * It is the right eventual behaviour — until it exists, an owner who adds photos still has to
     * clear the badge by hand, so the count reads as "unread" rather than "unmet". But it belongs to
     * the listing-update path, not here, and writing the method now with no caller would be dead code
     * asserting a design for a slice nobody has scoped. The mock this domain replaces had no
     * auto-resolve either, so shipping without it is parity, not a regression.
     */

    /** Single-row projection, when the property is already in hand. */
    private PhotoRequestResponse project(PhotoRequest row, Property property) {
        return mapper.toResponse(row, property, users.findById(row.getRequesterId()).orElse(null));
    }

    /**
     * Page projection with both sides batch-loaded — two queries for the whole page rather than two
     * per row. The entity holds ids rather than associations precisely so this stays a choice the
     * caller makes; making it per-row is the N+1 that choice exists to avoid.
     */
    private Function<PhotoRequest, PhotoRequestResponse> projector(List<PhotoRequest> rows) {
        Set<UUID> propertyIds =
                rows.stream().map(PhotoRequest::getPropertyId).collect(Collectors.toSet());
        Set<UUID> requesterIds =
                rows.stream().map(PhotoRequest::getRequesterId).collect(Collectors.toSet());
        Map<UUID, Property> propertiesById = properties.findAllById(propertyIds).stream()
                .collect(Collectors.toMap(Property::getId, Function.identity()));
        Map<UUID, User> usersById = users.findAllById(requesterIds).stream()
                .collect(Collectors.toMap(User::getId, Function.identity()));
        return row -> mapper.toResponse(row,
                propertiesById.get(row.getPropertyId()), usersById.get(row.getRequesterId()));
    }

    /** Resolve a path token that may be a UUID or a slug — the same either/or the detail endpoint accepts. */
    private Property resolve(String idOrSlug) {
        return Ids.parseUuid(idOrSlug)
                .flatMap(properties::findById)
                .or(() -> properties.findBySlug(idOrSlug))
                .orElseThrow(() -> NotFoundException.of("Property"));
    }
}
