package com.punenest.api.leads.contact;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.error.VerificationRequiredException;
import com.punenest.api.common.trust.ContactVisibility;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The contact gate: the rules that decide whether a signed-in buyer may see a listing owner's phone
 * number, and the owner-side inbox for granting it.
 *
 * <p><strong>Badge-not-gate (ADR-019) — the invariant this class exists to protect.</strong> Asking
 * for contact requires only L1 (a mobile-OTP account). The L2 Aadhaar badge is a trust <em>signal</em>
 * and never a wall, with exactly one exception: an owner may opt into
 * {@code users.verified_contact_only}, and only then does a badge-less caller get
 * {@code 403 verification_required}. No other code path in this slice may 403 on a missing badge.
 *
 * <p><strong>Cross-context reads.</strong> This service reads {@code catalog.property} and
 * {@code identity.user} repositories directly. {@code package-structure.md} §5 asks features not to
 * import each other; {@code leads} is inherently a <em>join</em> context (it relates a listing to a
 * user), so inverting these two reads would cost three interfaces and two adapters for no behavioural
 * change today. Recorded as a deliberate, reviewed exception in the slice-3 plan, alongside the
 * existing {@code security.JwtService → identity.user.User} precedent. The one direction that
 * <em>is</em> inverted is the security-critical one — {@code catalog} reaches this feature only
 * through the {@code common.trust.ContactGate} port.
 */
@Service
public class ContactService {

    private static final Logger LOG = LoggerFactory.getLogger(ContactService.class);

    private final ContactRequestRepository contactRequests;
    private final PropertyRepository properties;
    private final UserRepository users;
    private final ContactMapper contactMapper;

    public ContactService(ContactRequestRepository contactRequests, PropertyRepository properties,
            UserRepository users, ContactMapper contactMapper) {
        this.contactRequests = contactRequests;
        this.properties = properties;
        this.users = users;
        this.contactMapper = contactMapper;
    }

    /**
     * Contract {@code contactStatus} — the caller's gate state for one listing, read-only.
     *
     * @param viewerId   the authenticated caller (never {@code null}; the route is authenticated)
     * @param propertyId a listing id or slug
     * @throws NotFoundException when no such listing exists
     */
    @Transactional(readOnly = true)
    public ContactStatusResponse status(UUID viewerId, String propertyId) {
        return describe(viewerId, resolve(propertyId));
    }

    /**
     * Contract {@code requestContact} — open (or re-read) this caller's request against a listing.
     *
     * <p>Three outcomes, in the order they are decided:
     * <ol>
     *   <li>the caller owns the listing → {@link ContactStatuses#OWNER}, and <em>no row is written</em>
     *       (asking yourself for your own number is not a lead);</li>
     *   <li>the owner accepts verified contacts only and the caller has no badge →
     *       {@code 403 verification_required}, the single legitimate badge 403;</li>
     *   <li>otherwise the existing request is returned unchanged, or a new {@code pending} one is
     *       created.</li>
     * </ol>
     *
     * <p><strong>Idempotent by design.</strong> Re-requesting returns the current state rather than
     * inserting a second row, so a double-tap cannot flood an owner's inbox and — more importantly —
     * cannot reset a {@code declined} request back to {@code pending}, which would turn "no" into a
     * retry loop. Two genuinely concurrent taps can both miss the read, so the
     * {@code uq_contact_requests_requester_property} constraint (V9) is the real guarantee and the
     * loser of the race simply re-reads the winner's row.
     *
     * @throws NotFoundException             when no such listing exists
     * @throws VerificationRequiredException when the owner opted in and the caller lacks the L2 badge
     */
    @Transactional
    public ContactStatusResponse request(UUID viewerId, ContactRequestCreate body) {
        Property property = resolve(body.propertyId());
        User owner = property.getOwner();

        if (owner != null && owner.getId().equals(viewerId)) {
            return describe(viewerId, property);
        }
        if (owner != null && owner.isVerifiedContactOnly() && !hasBadge(viewerId)) {
            throw new VerificationRequiredException("This owner only accepts verified contacts");
        }

        if (contactRequests.findByRequesterIdAndPropertyId(viewerId, property.getId()).isEmpty()) {
            try {
                contactRequests.saveAndFlush(
                        new ContactRequest(property.getId(), viewerId, body.message()));
            } catch (DataIntegrityViolationException concurrentDuplicate) {
                // A parallel tap won the race; its row is the one true request, so this call is
                // simply a re-read. Nothing to repair, nothing worth telling the user about.
                LOG.debug("Concurrent contact request for property {}", property.getId());
            }
        }

        return describe(viewerId, property);
    }

    /**
     * Contract {@code myContactRequests} — every request against listings the caller owns, newest
     * first.
     *
     * <p>Strictly owner-scoped: the id set comes from {@code properties.owner_id}, so a caller can
     * never see a request against someone else's listing, and an owner with no listings gets an empty
     * array without a second query.
     *
     * <p>N+1-safe: one query for the owner's listing ids, one for the requests, one for all the
     * requesters — regardless of inbox size.
     */
    @Transactional(readOnly = true)
    public List<ContactRequestResponse> myRequests(UUID ownerId) {
        List<UUID> ownedPropertyIds = properties.findIdsByOwnerId(ownerId);
        if (ownedPropertyIds.isEmpty()) {
            return List.of();
        }
        List<ContactRequest> rows = contactRequests.findByPropertyIdInOrderByCreatedAtDesc(ownedPropertyIds);
        Map<UUID, User> requesters = users.findAllById(
                        rows.stream().map(ContactRequest::getRequesterId).distinct().toList())
                .stream()
                .collect(Collectors.toMap(User::getId, Function.identity()));

        return rows.stream()
                .map(row -> contactMapper.toResponse(row, requesters.get(row.getRequesterId()),
                        visibilityOf(row.getStatus())))
                .toList();
    }

    /**
     * Contract {@code respondContactRequest} — the owner approves or declines one request.
     *
     * <p><strong>Owner-scoping is enforced by lookup, not by a check after the fact:</strong> the row
     * is only accepted once {@code properties.findByIdAndOwner_Id} confirms the caller owns the
     * listing it points at. A request belonging to another owner is a {@code 404}, never a
     * {@code 403} — we do not confirm that someone else's lead exists.
     *
     * @throws NotFoundException when the id is unknown, malformed, or belongs to a foreign listing
     * @throws ConflictException when the request has already been answered (both end states are
     *                           terminal, so an owner cannot revoke a reveal the buyer has already
     *                           seen, and the trail cannot be rewritten)
     */
    @Transactional
    public void respond(UUID ownerId, String reqId, StatusUpdate body) {
        ContactRequest row = parseUuid(reqId)
                .flatMap(contactRequests::findById)
                .filter(r -> properties.findByIdAndOwner_Id(r.getPropertyId(), ownerId).isPresent())
                .orElseThrow(() -> new NotFoundException("Contact request not found"));

        if (!ContactRequestStatuses.canTransition(row.getStatus(), body.status())) {
            throw new ConflictException("This contact request has already been answered");
        }
        row.setStatus(body.status());
        contactRequests.save(row);
    }

    /**
     * Build the {@code ContactStatus} shape for one viewer/listing pair — the one place the five-value
     * vocabulary is assembled, so {@code contactStatus} and {@code requestContact} can never disagree.
     *
     * <p>{@code verificationRequired} is false for the owner of the listing: an owner is never blocked
     * from their own contact, whatever their own preference says.
     */
    private ContactStatusResponse describe(UUID viewerId, Property property) {
        User owner = property.getOwner();
        boolean verifiedContactOnly = owner != null && owner.isVerifiedContactOnly();

        if (owner != null && owner.getId().equals(viewerId)) {
            return new ContactStatusResponse(ContactStatuses.OWNER, verifiedContactOnly, false);
        }
        String status = contactRequests.findByRequesterIdAndPropertyId(viewerId, property.getId())
                .map(ContactRequest::getStatus)
                .orElse(ContactStatuses.NONE);
        return new ContactStatusResponse(
                status, verifiedContactOnly, verifiedContactOnly && !hasBadge(viewerId));
    }

    /**
     * Does this caller hold the L2 badge?
     *
     * <p>Read live from {@code users.aadhaar_verified} rather than from the JWT's
     * {@code aadhaarVerified} claim: a user who earns the badge mid-session still holds a token minted
     * before it, and a stale claim here would 403 someone who is in fact verified — the worst possible
     * failure mode for a rule that is supposed to be an opt-in courtesy.
     */
    private boolean hasBadge(UUID userId) {
        return users.findById(userId).map(User::isAadhaarVerified).orElse(false);
    }

    /** One reveal rule, shared with {@link ContactStatuses#revealsContact}, expressed for the mapper. */
    private ContactVisibility visibilityOf(String status) {
        return ContactStatuses.revealsContact(status)
                ? ContactVisibility.REVEALED : ContactVisibility.MASKED;
    }

    /**
     * Resolve the contract's {@code propertyId} token, which may be a UUID or a slug — the same
     * either/or the property-detail endpoint accepts, so the client can pass whatever it holds.
     */
    private Property resolve(String idOrSlug) {
        return parseUuid(idOrSlug)
                .flatMap(properties::findById)
                .or(() -> properties.findBySlug(idOrSlug))
                .orElseThrow(() -> new NotFoundException("Property not found"));
    }

    /** {@link Optional#empty()} when the token is not a UUID — a lookup miss, not a 400. */
    private static Optional<UUID> parseUuid(String token) {
        try {
            return Optional.of(UUID.fromString(token));
        } catch (IllegalArgumentException | NullPointerException notUuid) {
            return Optional.empty();
        }
    }
}
