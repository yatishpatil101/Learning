package com.draazy.api.moderation.enquiry;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.common.web.Ids;
import com.draazy.api.deals.deal.Deal;
import com.draazy.api.deals.deal.DealRepository;
import com.draazy.api.deals.visit.Visit;
import com.draazy.api.deals.visit.VisitRepository;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.leads.contact.ContactRequest;
import com.draazy.api.leads.contact.ContactRequestRepository;
import com.draazy.api.security.AuthPrincipal;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class EnquiryBoardService {

    private final ContactRequestRepository contactRequests;
    private final VisitRepository visits;
    private final DealRepository deals;
    private final PropertyRepository properties;
    private final UserRepository users;
    private final AuditService audit;

    public EnquiryBoardService(ContactRequestRepository contactRequests, VisitRepository visits,
            DealRepository deals, PropertyRepository properties, UserRepository users,
            AuditService audit) {
        this.contactRequests = contactRequests;
        this.visits = visits;
        this.deals = deals;
        this.properties = properties;
        this.users = users;
        this.audit = audit;
    }

    @Transactional(readOnly = true)
    public Page<AdminEnquiryDto> enquiries(String status, Pageable pageable) {
        Page<ContactRequest> page = status == null || status.isBlank()
                ? contactRequests.findAllByOrderByCreatedAtDesc(pageable)
                : contactRequests.findByStatusOrderByCreatedAtDesc(status, pageable);

        Map<UUID, Property> listings = listingsFor(page.map(ContactRequest::getPropertyId));
        Map<UUID, User> people = peopleFor(page.map(ContactRequest::getRequesterId));

        return page.map(row -> {
            Property listing = listings.get(row.getPropertyId());
            User requester = people.get(row.getRequesterId());
            return new AdminEnquiryDto(
                    row.getId().toString(),
                    row.getPropertyId().toString(),
                    listing == null ? null : listing.getTitle(),
                    listing == null ? null : listing.getLocalitySlug(),
                    requester == null ? null : requester.getName(),
                    requester == null ? null : MobileMask.mask(requester.getMobile()),
                    row.getStatus(),
                    row.getCreatedAt());
        });
    }

    @Transactional(readOnly = true)
    public Page<AdminVisitDto> visits(String status, Pageable pageable) {
        Page<Visit> page = status == null || status.isBlank()
                ? visits.findAllByOrderByCreatedAtDesc(pageable)
                : visits.findByStatusOrderByCreatedAtDesc(status, pageable);

        Map<UUID, Property> listings = listingsFor(page.map(Visit::getPropertyId));
        Map<UUID, User> people = peopleFor(page.map(Visit::getVisitorId));

        return page.map(row -> {
            Property listing = listings.get(row.getPropertyId());
            User visitor = people.get(row.getVisitorId());
            return new AdminVisitDto(
                    row.getId().toString(),
                    row.getPropertyId().toString(),
                    listing == null ? null : listing.getTitle(),
                    listing == null ? null : listing.getLocalitySlug(),
                    visitor == null ? null : visitor.getName(),
                    visitor == null ? null : MobileMask.mask(visitor.getMobile()),
                    row.getSlot(),
                    row.getMode(),
                    row.getStatus(),
                    row.getCreatedAt());
        });
    }

    @Transactional(readOnly = true)
    public Page<AdminDealDto> deals(String status, Pageable pageable) {
        Page<Deal> page = status == null || status.isBlank()
                ? deals.findAllByOrderByCreatedAtDesc(pageable)
                : deals.findByStatusOrderByCreatedAtDesc(status, pageable);

        Map<UUID, Property> listings = listingsFor(page.map(Deal::getPropertyId));
        Map<UUID, User> people = peopleFor(page.map(Deal::getCounterpartyId));

        return page.map(row -> {
            Property listing = listings.get(row.getPropertyId());
            User counterparty = row.getCounterpartyId() == null
                    ? null : people.get(row.getCounterpartyId());

            // Prefer the typed deal number: an off-platform close may involve no account.
            String mobile = row.getCounterpartyMobile() != null
                    ? row.getCounterpartyMobile()
                    : counterparty == null ? null : counterparty.getMobile();
            return new AdminDealDto(
                    row.getId().toString(),
                    row.getPropertyId().toString(),
                    listing == null ? null : listing.getTitle(),
                    listing == null ? null : listing.getLocalitySlug(),
                    row.getDeal(),
                    counterparty == null ? null : counterparty.getName(),
                    mobile == null ? null : MobileMask.mask(mobile),
                    row.getAgreedPrice(),
                    row.getStatus(),
                    row.getClosedAt(),
                    row.getCreatedAt());
        });
    }

    /** {@code GET /admin/enquiries/{id}} — one contact request, requester's mobile revealed. */
    @Transactional
    public AdminEnquiryDto enquiry(AuthPrincipal actor, String id) {
        ContactRequest row = Ids.parseUuid(id)
                .flatMap(contactRequests::findById)
                .orElseThrow(() -> NotFoundException.of("Enquiry"));
        User requester = row.getRequesterId() == null
                ? null : users.findById(row.getRequesterId()).orElse(null);
        String mobile = requester == null ? null : requester.getMobile();

        audit.record(actor, "enquiry.contact.reveal", "contactRequest", id,
                "mobile", MobileMask.mask(mobile));

        Property listing = row.getPropertyId() == null
                ? null : properties.findById(row.getPropertyId()).orElse(null);
        return new AdminEnquiryDto(
                row.getId().toString(),
                row.getPropertyId().toString(),
                listing == null ? null : listing.getTitle(),
                listing == null ? null : listing.getLocalitySlug(),
                requester == null ? null : requester.getName(),
                mobile,
                row.getStatus(),
                row.getCreatedAt());
    }

    /** {@code GET /admin/visits/{id}} — one site visit, visitor's mobile revealed. */
    @Transactional
    public AdminVisitDto visit(AuthPrincipal actor, String id) {
        Visit row = Ids.parseUuid(id)
                .flatMap(visits::findById)
                .orElseThrow(() -> NotFoundException.of("Visit"));
        User visitor = row.getVisitorId() == null
                ? null : users.findById(row.getVisitorId()).orElse(null);
        String mobile = visitor == null ? null : visitor.getMobile();

        audit.record(actor, "visit.contact.reveal", "visit", id,
                "mobile", MobileMask.mask(mobile));

        Property listing = row.getPropertyId() == null
                ? null : properties.findById(row.getPropertyId()).orElse(null);
        return new AdminVisitDto(
                row.getId().toString(),
                row.getPropertyId().toString(),
                listing == null ? null : listing.getTitle(),
                listing == null ? null : listing.getLocalitySlug(),
                visitor == null ? null : visitor.getName(),
                mobile,
                row.getSlot(),
                row.getMode(),
                row.getStatus(),
                row.getCreatedAt());
    }

    // Reveals the same preferred typed number as the list, so the audit names its source.
    @Transactional
    public AdminDealDto deal(AuthPrincipal actor, String id) {
        Deal row = Ids.parseUuid(id)
                .flatMap(deals::findById)
                .orElseThrow(() -> NotFoundException.of("Deal"));
        User counterparty = row.getCounterpartyId() == null
                ? null : users.findById(row.getCounterpartyId()).orElse(null);
        boolean typed = row.getCounterpartyMobile() != null;
        String mobile = typed
                ? row.getCounterpartyMobile()
                : counterparty == null ? null : counterparty.getMobile();

        audit.record(actor, "deal.contact.reveal", "deal", id,
                "mobile", MobileMask.mask(mobile),
                "source", typed ? "off-platform" : "account");

        Property listing = row.getPropertyId() == null
                ? null : properties.findById(row.getPropertyId()).orElse(null);
        return new AdminDealDto(
                row.getId().toString(),
                row.getPropertyId().toString(),
                listing == null ? null : listing.getTitle(),
                listing == null ? null : listing.getLocalitySlug(),
                row.getDeal(),
                counterparty == null ? null : counterparty.getName(),
                mobile,
                row.getAgreedPrice(),
                row.getStatus(),
                row.getClosedAt(),
                row.getCreatedAt());
    }

    private Map<UUID, Property> listingsFor(Page<UUID> propertyIds) {        return byId(propertyIds.getContent(), properties::findAllById, Property::getId);
    }

    private Map<UUID, User> peopleFor(Page<UUID> userIds) {
        return byId(userIds.getContent(), users::findAllById, User::getId);
    }

    private <T> Map<UUID, T> byId(List<UUID> ids, Function<Collection<UUID>, List<T>> load,
            Function<T, UUID> key) {
        List<UUID> wanted = ids.stream().filter(java.util.Objects::nonNull).distinct().toList();
        if (wanted.isEmpty()) {
            return Map.of();
        }
        return load.apply(wanted).stream().collect(Collectors.toMap(key, Function.identity()));
    }
}
