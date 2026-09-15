package com.draazy.api.leads.contact;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ContactQuotaExhaustedException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.error.VerificationRequiredException;
import com.draazy.api.common.trust.ContactAllowanceLookup;
import com.draazy.api.common.trust.ContactVisibility;
import com.draazy.api.common.trust.Notifier;
import com.draazy.api.common.trust.VerifiedTenantLookup;
import com.draazy.api.common.web.Ids;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import java.util.List;
import java.util.Map;
import java.util.OptionalInt;
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
 * The contact gate: whether a signed-in buyer may see a listing owner's phone number, and the
 * owner-side inbox for granting it. Rationale: docs/flows/consumer/contact-gate-leads.md#service.
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
    private final ContactAllowanceLookup allowances;

    public ContactService(ContactRequestRepository contactRequests, PropertyRepository properties,
            UserRepository users, ContactMapper contactMapper, Notifier notifier,
            VerifiedTenantLookup verifiedTenants, ContactAllowanceLookup allowances) {
        this.contactRequests = contactRequests;
        this.properties = properties;
        this.users = users;
        this.contactMapper = contactMapper;
        this.notifier = notifier;
        this.verifiedTenants = verifiedTenants;
        this.allowances = allowances;
    }

    /**
     * Contract {@code contactStatus} — the caller's gate state for one listing, read-only. The
     * listing may be addressed by id or slug.
     */
    @Transactional(readOnly = true)
    public ContactStatusResponse status(UUID viewerId, String propertyId) {
        return describe(viewerId, resolve(propertyId));
    }

    /**
     * Contract {@code requestContact} — open (or re-read) this caller's request against a listing.
     * Idempotent. Rationale: docs/flows/consumer/contact-gate-leads.md#service.
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
            requireContactAllowance(viewerId);
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
     * Refuse when the caller has spent every owner contact they are entitled to. Counts rows rather
     * than a stored balance. Rationale: docs/flows/consumer/contact-gate-leads.md#service.
     */
    private void requireContactAllowance(UUID viewerId) {
        OptionalInt allowance = allowances.contactAllowance(viewerId);
        if (allowance.isEmpty()) {
            return;
        }
        if (contactRequests.countByRequesterId(viewerId) >= allowance.getAsInt()) {
            throw new ContactQuotaExhaustedException(
                    "You have used all " + allowance.getAsInt() + " of your owner contacts. "
                            + "Subscribe for unlimited contacts, or refer a friend to earn more.");
        }
    }

    /**
     * Contract {@code myContactRequests} — every request against listings the caller owns, newest
     * first. Strictly owner-scoped, and N+1-safe at three queries regardless of inbox size.
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

        // One extra query for the whole page, not one per row. The badge rides on the party because
        // the mobile the owner receives is masked, so the client cannot derive this answer itself.
        Set<UUID> verifiedIds = verifiedTenants.verifiedAmong(requesters.keySet());

        return rows.map(row -> contactMapper.toResponse(row, requesters.get(row.getRequesterId()),
                visibilityOf(row.getStatus()), verifiedIds));
    }

    /**
     * Contract {@code myPendingContactCount} — how many requests are waiting on this owner. Counted
     * in the database so it stays right at any inbox size, and owner-scoped like the inbox itself.
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
     * Contract {@code respondContactRequest} — the owner approves or declines one request. Owner
     * scope is enforced by the lookup itself, so a foreign lead is a 404 and never a 403.
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

        // Tell the buyer the moment the owner grants contact; a decline stays silent on purpose.
        // Inside this transaction, so a rollback takes the notification with the approval it reports.
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
     * vocabulary is assembled. An owner is never blocked from their own contact by their own opt-in.
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
        // Global policy: an owner's raw number is never revealed to another viewer, whatever their
        // hide-number preference. Constant-true for non-owners, routing the client to messaging.
        return new ContactStatusResponse(
                status, verifiedContactOnly, verifiedContactOnly && !hasBadge(viewerId),
                true);
    }

    /**
     * Does this caller hold the L2 badge? Read live from {@code users.verified}, since a token minted
     * before the badge was earned would 403 someone who is in fact verified.
     */
    private boolean hasBadge(UUID userId) {
        return users.findById(userId).map(User::isVerified).orElse(false);
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
