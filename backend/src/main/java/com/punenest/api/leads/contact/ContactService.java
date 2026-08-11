package com.punenest.api.leads.contact;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.error.VerificationRequiredException;
import com.punenest.api.common.trust.ContactVisibility;
import com.punenest.api.common.trust.Notifier;
import com.punenest.api.common.trust.VerifiedTenantLookup;
import com.punenest.api.common.web.Ids;
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
import org.springframework.data.domain.Pageable;
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
    private final Notifier notifier;
    private final VerifiedTenantLookup verifiedTenants;

    public ContactService(ContactRequestRepository contactRequests, PropertyRepository properties,
            UserRepository users, ContactMapper contactMapper, Notifier notifier,
            VerifiedTenantLookup verifiedTenants) {
        this.contactRequests = contactRequests;
        this.properties = properties;
        this.users = users;
        this.contactMapper = contactMapper;
        this.notifier = notifier;
        this.verifiedTenants = verifiedTenants;
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
    public Page<ContactRequestResponse> myRequests(UUID ownerId, Pageable pageable) {
        List<UUID> ownedPropertyIds = properties.findIdsByOwnerId(ownerId);
        if (ownedPropertyIds.isEmpty()) {
            return Page.empty(pageable);
        }
        Page<ContactRequest> rows =
                contactRequests.findByPropertyIdInOrderByCreatedAtDesc(ownedPropertyIds, pageable);
        Map<UUID, User> requesters = users.findAllById(
                        rows.getContent().stream()
                                .map(ContactRequest::getRequesterId).distinct().toList())
                .stream()
                .collect(Collectors.toMap(User::getId, Function.identity()));

        // One extra query for the whole page, not one per row — same batching discipline as the
        // requester fetch above. The badge has to be carried on the party because the mobile the
        // owner receives is masked, so the client holds the key to this answer but not one that
        // works (D114/D185).
        Set<UUID> verifiedIds = verifiedTenants.verifiedAmong(requesters.keySet());

        return rows.map(row -> contactMapper.toResponse(row, requesters.get(row.getRequesterId()),
                visibilityOf(row.getStatus()), verifiedIds));
    }

    /**
     * Contract {@code myPendingContactCount} — how many requests are waiting on this owner.
     *
     * <p><strong>Why this is an endpoint and not a client-side filter.</strong> It used to be one:
     * the owner's dashboard fetched the whole inbox and counted the pending rows. That is only
     * correct while the inbox is unpaged, and paging it (D78) would have quietly turned the badge
     * into "pending requests on page one" — a number that is wrong in exactly the situation the
     * badge exists for, an owner with a lot of leads. Counted in the database, it is right at any
     * inbox size and costs one integer instead of an inbox.
     *
     * <p>Owner-scoped by the same property-id set as the inbox itself; an owner with no listings
     * gets {@code 0} without a second query.
     */
    @Transactional(readOnly = true)
    public long myPendingCount(UUID ownerId) {
        List<UUID> ownedPropertyIds = properties.findIdsByOwnerId(ownerId);
        if (ownedPropertyIds.isEmpty()) {
            return 0L;
        }
        return contactRequests.countByPropertyIdInAndStatus(
                ownedPropertyIds, ContactRequestStatuses.PENDING);
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
        ContactRequest row = Ids.parseUuid(reqId)
                .flatMap(contactRequests::findById)
                .filter(r -> properties.findByIdAndOwner_Id(r.getPropertyId(), ownerId).isPresent())
                .orElseThrow(() -> NotFoundException.of("Contact request"));

        if (!ContactRequestStatuses.canTransition(row.getStatus(), body.status())) {
            throw new ConflictException("This contact request has already been answered");
        }
        row.setStatus(body.status());
        contactRequests.save(row);

        // Tell the buyer the moment the owner grants contact — the positive outcome they are
        // waiting on, and until now (tech-debt D92) one nothing announced. A decline is left
        // silent on purpose: it is a terminal "no", not news the buyer needs pushed at them. The
        // notify runs inside this transaction, so a rollback takes it with the approval it reports.
        if (ContactRequestStatuses.APPROVED.equals(body.status())) {
            notifier.notify(
                    row.getRequesterId(),
                    "contact.approved",
                    "Your contact request was approved",
                    "You can now message the owner \u2014 open the listing to start the conversation.",
                    "/property/" + row.getPropertyId());
        }
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
            return new ContactStatusResponse(ContactStatuses.OWNER, verifiedContactOnly, false, false);
        }
        String status = contactRequests.findByRequesterIdAndPropertyId(viewerId, property.getId())
                .map(ContactRequest::getStatus)
                .orElse(ContactStatuses.NONE);
        // D5 (global policy): the owner's raw number is never revealed to another viewer, whatever
        // their own hide-number preference — approval unlocks the in-app conversation, not the
        // digits. The signal is therefore constant-true for every non-owner viewer, which routes the
        // client to the message affordance instead of a tel:/wa.me link.
        return new ContactStatusResponse(
                status, verifiedContactOnly, verifiedContactOnly && !hasBadge(viewerId),
                true);
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
        return Ids.parseUuid(idOrSlug)
                .flatMap(properties::findById)
                .or(() -> properties.findBySlug(idOrSlug))
                .orElseThrow(() -> NotFoundException.of("Property"));
    }
}
