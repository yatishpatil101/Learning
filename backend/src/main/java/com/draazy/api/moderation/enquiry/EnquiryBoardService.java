package com.draazy.api.moderation.enquiry;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.common.web.Ids;
import com.draazy.api.common.web.Pageables;
import com.draazy.api.deals.deal.Deal;
import com.draazy.api.deals.deal.DealRepository;
import com.draazy.api.deals.visit.Visit;
import com.draazy.api.deals.visit.VisitRepository;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.leads.contact.ContactRequest;
import com.draazy.api.leads.contact.ContactRequestRepository;
import com.draazy.api.security.AuthPrincipal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class EnquiryBoardService {

    private static final int LOCALITY_ROWS = 10;

    private final ContactRequestRepository contactRequests;
    private final VisitRepository visits;
    private final DealRepository deals;
    private final PropertyRepository properties;
    private final UserRepository users;
    private final AuditService audit;
    private final EnquiryBoardQueries queries;

    public EnquiryBoardService(ContactRequestRepository contactRequests, VisitRepository visits,
            DealRepository deals, PropertyRepository properties, UserRepository users,
            AuditService audit, EnquiryBoardQueries queries) {
        this.contactRequests = contactRequests;
        this.visits = visits;
        this.deals = deals;
        this.properties = properties;
        this.users = users;
        this.audit = audit;
        this.queries = queries;
    }

    @Transactional(readOnly = true)
    public Page<AdminEnquiryDto> enquiries(String status, String q, Integer days, Pageable pageable) {
        return queries.enquiries(filter(status, null, q, days), Pageables.unsorted(pageable)).map(r -> new AdminEnquiryDto(
                r[0].toString(), r[1].toString(), (String) r[2], (String) r[3], (String) r[4],
                MobileMask.mask((String) r[5]), (String) r[6], (Instant) r[7]));
    }

    @Transactional(readOnly = true)
    public Page<AdminVisitDto> visits(String status, String q, Integer days, Pageable pageable) {
        return queries.visits(filter(status, null, q, days), Pageables.unsorted(pageable)).map(r -> new AdminVisitDto(
                r[0].toString(), r[1].toString(), (String) r[2], (String) r[3], (String) r[4],
                MobileMask.mask((String) r[5]), (Instant) r[6], (String) r[7], (String) r[8], (Instant) r[9]));
    }

    @Transactional(readOnly = true)
    public Page<AdminDealDto> deals(String status, String deal, String q, Integer days, Pageable pageable) {
        return queries.deals(filter(status, deal, q, days), Pageables.unsorted(pageable)).map(r -> new AdminDealDto(
                r[0].toString(), r[1].toString(), (String) r[2], (String) r[3], (String) r[4], (String) r[5],
                MobileMask.mask(r[6] != null ? (String) r[6] : (String) r[7]), (Long) r[8], (String) r[9],
                (Instant) r[10], (Instant) r[11]));
    }

    /** Totals, per-status counts and the funnel in one read; {@code days} and {@code deal} narrow the funnel only. */
    @Transactional(readOnly = true)
    public AdminEnquirySummary summary(Integer days, String deal) {
        Map<String, Long> enquiryCounts = withTotal(queries.countsByStatus("ContactRequest"));
        Map<String, Long> visitCounts = withTotal(queries.countsByStatus("Visit"));
        Map<String, Long> dealCounts = withTotal(queries.countsByStatus("Deal"));
        Instant since = since(days);
        String dealType = deal == null ? "" : deal.trim();

        Map<String, long[]> byLocality = new HashMap<>();
        for (Object[] r : queries.enquiriesByLocality(since)) {
            byLocality.computeIfAbsent(localityOf(r[0]), k -> new long[4])[0] += (Long) r[1];
        }
        for (Object[] r : queries.visitsByLocality(since)) {
            byLocality.computeIfAbsent(localityOf(r[0]), k -> new long[4])[1] += (Long) r[1];
        }
        for (Object[] r : queries.closedDealsByLocality(since, dealType)) {
            long[] row = byLocality.computeIfAbsent(localityOf(r[0]), k -> new long[4]);
            row[2] += (Long) r[1];
            row[3] += ((Number) r[2]).longValue();
        }
        long enquiries = 0;
        long visits = 0;
        long closed = 0;
        long gmv = 0;
        for (long[] row : byLocality.values()) {
            enquiries += row[0];
            visits += row[1];
            closed += row[2];
            gmv += row[3];
        }
        List<AdminEnquirySummary.Locality> localities = byLocality.entrySet().stream()
                .map(e -> new AdminEnquirySummary.Locality(e.getKey(), e.getValue()[0], e.getValue()[1],
                        e.getValue()[2], e.getValue()[3]))
                .sorted(Comparator.comparingLong(AdminEnquirySummary.Locality::enquiries).reversed()
                        .thenComparing(AdminEnquirySummary.Locality::locality))
                .limit(LOCALITY_ROWS)
                .toList();
        return new AdminEnquirySummary(enquiryCounts, visitCounts, dealCounts, withTotal(queries.dealTypeCounts()),
                queries.dealValue(),
                new AdminEnquirySummary.Funnel(enquiries, visits, closed, gmv, localities));
    }

    private static String localityOf(Object slug) {
        return slug == null ? "Unknown" : slug.toString();
    }

    private static Map<String, Long> withTotal(Map<String, Long> byStatus) {
        Map<String, Long> out = new LinkedHashMap<>();
        out.put("all", byStatus.values().stream().mapToLong(Long::longValue).sum());
        out.putAll(byStatus);
        return out;
    }

    private static Instant since(Integer days) {
        return days == null || days < 1 ? Instant.EPOCH : Instant.now().minus(days, ChronoUnit.DAYS);
    }

    private static EnquiryBoardQueries.Filter filter(String status, String deal, String q, Integer days) {
        String term = q == null ? "" : q.trim().toLowerCase();
        // Whole number only: rows mask the mobile, so a prefix match would let a caller unmask it digit by digit.
        String mobile = MobileMask.normalise(term);
        return new EnquiryBoardQueries.Filter(
                status == null ? "" : status.trim(),
                deal == null ? "" : deal.trim(),
                term.isEmpty() ? "" : "%" + escapeLike(term) + "%",
                mobile == null ? "-" : mobile,
                since(days));
    }

    private static String escapeLike(String term) {
        return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }
    /** {@code GET /admin/enquiries/{id}} — one contact request; audited, as opening a row is. */
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

    /** {@code GET /admin/visits/{id}} — one site visit; audited. */
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

    // Same preferred typed number as the list; the audit names its source.
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
}
