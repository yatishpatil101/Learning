package com.draazy.api.leads.contact;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.audit.AuditService;
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
import com.draazy.api.security.AuthPrincipal;
import java.time.Instant;
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
    private final AuditService audit;

    public ContactService(ContactRequestRepository contactRequests, PropertyRepository properties,
            UserRepository users, ContactMapper contactMapper, Notifier notifier,
            VerifiedTenantLookup verifiedTenants, ContactAllowanceLookup allowances,
            AuditService audit) {
        this.contactRequests = contactRequests;
        this.properties = properties;
        this.users = users;
        this.contactMapper = contactMapper;
        this.notifier = notifier;
        this.verifiedTenants = verifiedTenants;
        this.allowances = allowances;
        this.audit = audit;
    }

    @Transactional(readOnly = true)
    public ContactStatusResponse status(UUID viewerId, String propertyId) {
        return describe(viewerId, resolve(propertyId));
    }

    // Idempotent.
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

        Instant now = Instant.now();
        return rows.map(row -> withDerivedStatus(contactMapper.toResponse(
                row, requesters.get(row.getRequesterId()), visibilityOf(row.getStatus()),
                verifiedIds), row, now));
    }

    @Transactional(readOnly = true)
    public long myPendingCount(UUID ownerId) {
        List<UUID> ownedPropertyIds = properties.findIdsByOwnerId(ownerId);
        if (ownedPropertyIds.isEmpty()) {
            return 0L;
        }
        return contactRequests.countByPropertyIdInAndStatusAndCreatedAtAfter(
                ownedPropertyIds, ContactRequestStatuses.PENDING,
                Instant.now().minus(ContactRequestStatuses.PENDING_TTL));
    }

    @Transactional
    public void respond(AuthPrincipal owner, String reqId, StatusUpdate body) {
        ContactRequest row = Ids.parseUuid(reqId)
                .flatMap(contactRequests::findById)
                .filter(r -> properties.findByIdAndOwner_Id(
                        r.getPropertyId(), owner.userId()).isPresent())
                .orElseThrow(() -> NotFoundException.of("Contact request"));

        String before = row.getStatus();
        if (ContactRequestStatuses.isExpiredPending(before, row.getCreatedAt(), Instant.now())) {
            throw new ConflictException("This contact request has expired");
        }
        if (body.status().equals(before)) {
            return;
        }
        if (!ContactRequestStatuses.canTransition(row.getStatus(), body.status())) {
            throw new ConflictException("This contact request has already been answered");
        }
        if (contactRequests.updateStatusIfCurrent(
                row.getId(), ContactRequestStatuses.PENDING, body.status()) == 0) {
            ContactRequest current = contactRequests.findById(row.getId())
                    .orElseThrow(() -> NotFoundException.of("Contact request"));
            if (body.status().equals(current.getStatus())) {
                return;
            }
            throw new ConflictException("This contact request has already been answered");
        }
        audit.record(owner, "contact.request." + body.status(), "contactRequest",
                row.getId().toString(), "fromStatus", before, "toStatus", body.status());

        if (ContactRequestStatuses.APPROVED.equals(body.status())) {
            notifier.notify(
                    row.getRequesterId(),
                    "contact.approved",
                    "Your contact request was approved",
                    "You can now message the owner and see their number unless they keep it hidden \u2014 open the listing.",
                    "/property/" + row.getPropertyId());
        }
    }

    // An owner is never blocked from their own contact by their own opt-in.
    private ContactStatusResponse describe(UUID viewerId, Property property) {
        User owner = property.getOwner();
        boolean verifiedContactOnly = owner != null && owner.isVerifiedContactOnly();

        if (owner != null && owner.getId().equals(viewerId)) {
            return new ContactStatusResponse(ContactStatuses.OWNER, verifiedContactOnly, false, false);
        }
        String status = contactRequests.findByRequesterIdAndPropertyId(viewerId, property.getId())
                .map(ContactRequest::getStatus)
                .orElse(ContactStatuses.NONE);
        return new ContactStatusResponse(
                status, verifiedContactOnly, verifiedContactOnly && !hasBadge(viewerId),
                owner != null && owner.isHideNumber());
    }

    // Read verification live so old tokens do not block newly verified users.
    private boolean hasBadge(UUID userId) {
        return users.findById(userId).map(User::isVerified).orElse(false);
    }

    private ContactVisibility visibilityOf(String status) {
        return ContactStatuses.revealsContact(status)
                ? ContactVisibility.REVEALED : ContactVisibility.MASKED;
    }

    private static ContactRequestResponse withDerivedStatus(
            ContactRequestResponse response, ContactRequest row, Instant now) {
        if (!ContactRequestStatuses.isExpiredPending(row.getStatus(), row.getCreatedAt(), now)) {
            return response;
        }
        return new ContactRequestResponse(response.id(), response.propertyId(), response.requester(),
                ContactRequestStatuses.EXPIRED, response.contact(), response.createdAt());
    }

    // Accept UUID or slug here because the property-detail contract accepts both.
    private Property resolve(String idOrSlug) {
        return Ids.parseUuid(idOrSlug)
                .flatMap(properties::findById)
                .or(() -> properties.findBySlug(idOrSlug))
                .orElseThrow(() -> NotFoundException.of("Property"));
    }
}
