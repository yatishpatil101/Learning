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

/**
 * The demand board — contact requests, site visits and deals across the whole marketplace.
 *
 * <p><strong>There is no {@code enquiries} table, and this class is what that fact looks like once
 * it is admitted.</strong> The console's Enquiries page ran on a mock collection that was a
 * client-side union of four things: contact requests, chat threads, visits and deals, flattened into
 * rows with a {@code kind} discriminator. Three of the four are real tables owned by two different
 * contexts, the fourth ({@code call}) never existed anywhere but in the mock. Reproducing the union
 * server-side would have meant either a new table that duplicates three others, or a native
 * {@code UNION ALL} whose paging no index can serve. So the board is three reads, one per real
 * table, and the console renders them as three tabs — which is how it already renders them.
 *
 * <p><strong>Read-only, and that is a product decision rather than a first instalment.</strong> The
 * mock offered "mark responded" and "close" on an enquiry row. Every row here belongs to two other
 * people: a contact request is the owner's to approve or decline, a visit is the participants' to
 * confirm or move, a deal is the owner's to close. There is no column anywhere for "an operator
 * considers this handled", and adding one would mean either inventing a parallel status that no
 * other surface reads, or letting ops write the owner's decision field with their own opinion. The
 * two buttons are dropped; {@link com.draazy.api.security.BackOfficePermissions#ENQUIRIES_READ}
 * has no {@code write} counterpart for the same reason. What the console shows instead of a status
 * change is an internal note against the row, which is an operator's opinion recorded as an
 * operator's opinion rather than laundered into somebody else's decision field.
 *
 * <p><strong>No raw mobiles on the list — and exactly one way to get one, on the record.</strong>
 * Each of these rows has a DTO elsewhere that reveals a number to somebody: the owner sees their
 * requester's once approved, the deal counterparty's was typed by the owner themselves. Those
 * reveals are justified by a relationship an operator does not have, so the <em>list</em> masks
 * unconditionally and no parameter changes that.
 *
 * <p>This class used to say that was the end of it — that there was no status at which a number
 * became visible here and no route that unmasked one. D25 reversed that, and the reasoning is worth
 * recording because the original was not wrong so much as incomplete. "Party to the conversation"
 * is the right test for a <em>user</em> and the wrong test for the platform's own support desk: an
 * agent working "a visit was booked and nobody turned up" is doing the job the product asked them
 * to do, and a masked number does not let them do it. The answer is not to widen the list but to
 * add a narrower door — {@link #enquiry(AuthPrincipal, String)} and its two siblings, one row at a
 * time, admin-only, and never without an {@code audit_log} row written first. A reveal that leaves
 * a trace is a support action; the same reveal without one is indistinguishable from an insider
 * reading strangers' contact details, and the trace is the entire difference.
 *
 * <p>Each read is three queries whatever the page size: the page, one batch load of the listings it
 * points at, one batch load of the people. Resolving either per row would be an N+1 on a board whose
 * whole purpose is to be scrolled.
 */
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

    /** {@code GET /admin/enquiries} — contact requests, optionally one status. */
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

    /** {@code GET /admin/visits} — site visits, optionally one status. */
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

    /** {@code GET /admin/deals} — the funnel's floor, optionally one status. */
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
            /* The mobile comes from the deal row rather than the user, and falls back to it only
             * when there is no account: an off-platform close records a number the owner typed,
             * which may belong to nobody on the platform at all. Masked either way. */
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

    // --- the audited reveals (D25) ---------------------------------------------------------------

    /*
     * Three near-identical methods rather than one generic one, and that is deliberate. What varies
     * between them is not a type parameter but the thing being revealed: whose number it is, where
     * it is stored, and therefore what the audit row should be able to say about it afterwards. A
     * shared helper parameterised over "the repository and the field" would make the deals case —
     * where the number may belong to somebody with no account at all — read like an incidental
     * variation instead of the one that most needs a reader's attention.
     *
     * Each writes its audit row before composing the response, so a reveal cannot succeed unlogged,
     * and each stores the *masked* number in the row. The log's job is to record that a reveal
     * happened and against whom; storing the raw number there would make the audit trail a second
     * copy of the thing it exists to protect, in a table more people can read.
     */

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

    /**
     * {@code GET /admin/deals/{id}} — one deal, counterparty's mobile revealed.
     *
     * <p>The same two sources as the list, in the same order of preference, and the reason to
     * prefer the typed one is the reason this reveal is worth auditing at all: an off-platform close
     * records a number the owner entered by hand, which may belong to somebody who never held an
     * account here and never agreed to anything. Revealing it is the most consequential of the
     * three, so the audit row names which source it came from — a log entry that cannot distinguish
     * "we showed an agent a registered user's number" from "we showed them a stranger's" is not much
     * of a log.
     */
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

    /**
     * The listings one page of rows points at, in one query.
     *
     * <p>A missing listing maps to a null title rather than dropping the row. A contact request
     * whose listing was hard-deleted is still evidence that demand arrived, and a demand board that
     * quietly omits rows it cannot fully describe is a board that undercounts without saying so.
     */
    private Map<UUID, Property> listingsFor(Page<UUID> propertyIds) {        return byId(propertyIds.getContent(), properties::findAllById, Property::getId);
    }

    /** The users one page of rows points at, in one query. */
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
