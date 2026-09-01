package com.punenest.api.moderation.enquiry;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.trust.MobileMask;
import com.punenest.api.deals.deal.Deal;
import com.punenest.api.deals.deal.DealRepository;
import com.punenest.api.deals.visit.Visit;
import com.punenest.api.deals.visit.VisitRepository;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.leads.contact.ContactRequest;
import com.punenest.api.leads.contact.ContactRequestRepository;
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
 * two buttons are dropped; {@link com.punenest.api.security.BackOfficePermissions#ENQUIRIES_READ}
 * has no {@code write} counterpart for the same reason.
 *
 * <p><strong>No raw mobiles, on any of the three.</strong> Each of these rows has a DTO elsewhere
 * that reveals a number to somebody — the owner sees their requester's once approved, the deal
 * counterparty's was typed by the owner themselves. Those reveals are all justified by a
 * relationship an operator does not have, so this board masks unconditionally.
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

    public EnquiryBoardService(ContactRequestRepository contactRequests, VisitRepository visits,
            DealRepository deals, PropertyRepository properties, UserRepository users) {
        this.contactRequests = contactRequests;
        this.visits = visits;
        this.deals = deals;
        this.properties = properties;
        this.users = users;
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

    /**
     * The listings one page of rows points at, in one query.
     *
     * <p>A missing listing maps to a null title rather than dropping the row. A contact request
     * whose listing was hard-deleted is still evidence that demand arrived, and a demand board that
     * quietly omits rows it cannot fully describe is a board that undercounts without saying so.
     */
    private Map<UUID, Property> listingsFor(Page<UUID> propertyIds) {
        return byId(propertyIds.getContent(), properties::findAllById, Property::getId);
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
