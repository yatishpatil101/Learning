package com.punenest.api.deals.visit;

import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.ForbiddenException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.trust.ContactVisibility;
import com.punenest.api.common.web.Ids;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.leads.contact.ContactRequestRepository;
import com.punenest.api.leads.contact.ContactRequestStatuses;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The visit lifecycle: schedule (create), update status, and the two list reads (my visits,
 * visit requests on my listings).
 *
 * <p><strong>D3 — two projections of ONE entity, not two resources.</strong> {@code POST /visits}
 * (scheduleVisit) and {@code POST /visit-requests} (requestVisit) both create a visit and are
 * served by the single {@link #schedule} method. They differ only in which client calls them:
 * the mock's {@code ScheduleVisitModal} uses the former. This is not a redundant endpoint —
 * it is the same entity exposed on two surfaces so neither the visitor-centric nor the
 * owner-centric frontend page needs to know the other's routes.
 *
 * <p><strong>Role-split transitions (security-critical).</strong> The owner may set
 * {@code confirmed}, {@code completed}, {@code no-show}, {@code cancelled}. The visitor may ONLY
 * set {@code cancelled}. A visitor marking their own visit {@code completed} would forge the
 * anti-fake-review signal — where a legitimate participant is not authorised for an action,
 * return 403 (not 404). A non-participant gets 404.
 *
 * <p><strong>Past-slot decision.</strong> Slots in the past are ALLOWED at create time. Rationale:
 * an owner may legitimately record a visit that already happened (e.g. a walk-in they want on
 * record for the "Visited" badge flow). The system's value is the audit trail, not the calendar
 * gate. Enforcing future-only would force owners to lie about the slot, which is worse.
 *
 * <p><strong>Cross-context reads.</strong> This service reads {@code catalog.property} and
 * {@code identity.user} repositories directly — same documented exception as offers/finalization.
 */
@Service
public class VisitService {

    private static final Logger LOG = LoggerFactory.getLogger(VisitService.class);

    private final VisitRepository visits;
    private final PropertyRepository properties;
    private final UserRepository users;
    private final ContactRequestRepository contactRequests;

    public VisitService(VisitRepository visits, PropertyRepository properties,
                        UserRepository users, ContactRequestRepository contactRequests) {
        this.visits = visits;
        this.properties = properties;
        this.users = users;
        this.contactRequests = contactRequests;
    }

    /**
     * Contract {@code scheduleVisit} / {@code requestVisit} — create a visit.
     *
     * <p>Both {@code POST /visits} and {@code POST /visit-requests} delegate here (D3): one
     * service method, one stored shape. The caller is always the visitor.
     *
     * <p>Invariants enforced:
     * <ul>
     *   <li>Property must exist (404).</li>
     *   <li>No existing live visit by this user on this property (409 — duplicate).</li>
     * </ul>
     *
     * <p><strong>Past slots are allowed</strong> — see class Javadoc for the rationale.
     *
     * @throws NotFoundException when the property does not exist
     * @throws ConflictException when a live visit already exists (duplicate)
     */
    @Transactional
    public VisitDto schedule(UUID callerId, VisitCreateRequest body) {
        UUID propertyId = Ids.parseUuid(body.propertyId()).orElse(null);
        if (propertyId == null || properties.findById(propertyId).isEmpty()) {
            throw NotFoundException.of("Property");
        }

        // Duplicate prevention: service pre-check for a clean error message.
        if (visits.findLiveByVisitorAndProperty(callerId, propertyId).isPresent()) {
            throw new ConflictException("You already have a live visit on this property");
        }

        Visit visit;
        try {
            visit = new Visit(propertyId, callerId, body.slot(), body.mode(), body.note());
            visit = visits.saveAndFlush(visit);
        } catch (DataIntegrityViolationException constraintViolation) {
            // The partial unique index uq_visits_live_per_user_property caught a concurrent
            // double-tap that slipped past the service-level check.
            LOG.debug("Concurrent duplicate visit for user {} on property {}", callerId, propertyId);
            throw new ConflictException("You already have a live visit on this property");
        }

        User visitor = users.findById(callerId).orElse(null);
        return VisitMapper.toDto(visit, visitor, ContactVisibility.REVEALED);
    }

    /**
     * Contract {@code updateVisitStatus} — confirm, complete, no-show, or cancel a visit.
     *
     * <p><strong>Scoping.</strong> The caller must be either the visitor or the listing owner.
     * Anyone else → 404 (not 403 — do not confirm existence).
     *
     * <p><strong>Who may do what (the security-critical rule).</strong>
     * <ul>
     *   <li>Owner: may set {@code confirmed}, {@code completed}, {@code no-show}, {@code cancelled}.</li>
     *   <li>Visitor: may ONLY set {@code cancelled} (403 for anything else).</li>
     * </ul>
     *
     * @throws NotFoundException when the visit is unknown or the caller is not a participant
     * @throws ForbiddenException when the caller is a participant but not authorised for this transition
     * @throws ConflictException on an illegal state transition
     */
    @Transactional
    public void updateStatus(UUID callerId, UUID visitId, VisitStatusUpdateRequest body) {
        Visit visit = visits.findById(visitId)
                .orElseThrow(() -> NotFoundException.of("Visit"));

        UUID ownerId = properties.findById(visit.getPropertyId())
                .map(p -> p.getOwner().getId())
                .orElseThrow(() -> NotFoundException.of("Visit"));

        boolean isVisitor = callerId.equals(visit.getVisitorId());
        boolean isOwner = callerId.equals(ownerId);
        if (!isVisitor && !isOwner) {
            throw NotFoundException.of("Visit");
        }

        // Role-split: the visitor may ONLY cancel. Any other transition from a visitor is 403.
        // why: a visitor marking 'completed' would forge the anti-fake-review signal (item f).
        if (isVisitor && !VisitStatuses.CANCELLED.equals(body.status())) {
            throw new ForbiddenException(
                    "Only the listing owner can set status '" + body.status() + "'");
        }

        if (!VisitStatuses.canTransition(visit.getStatus(), body.status())) {
            throw new ConflictException(
                    "Cannot transition from '" + visit.getStatus() + "' to '" + body.status() + "'");
        }

        visit.setStatus(body.status());
        visits.save(visit);
    }

    /**
     * Contract {@code listVisits} — visits the caller BOOKED (visitor surface), newest first.
     *
     * <p>Strictly caller-scoped: returns only visits where the caller is the visitor. The
     * pre-spec-fix-S3 version leaked every visit on the platform.
     *
     * <p>N+1-safe: one query for the visits, one batch load for visitor users (trivially just
     * the caller in practice, but the structure is correct for future expansion).
     */
    @Transactional(readOnly = true)
    public List<VisitDto> myVisits(UUID callerId) {
        List<Visit> rows = visits.findByVisitorIdOrderByCreatedAtDesc(callerId);
        return projectVisits(rows, callerId);
    }

    /**
     * Contract {@code myVisitRequests} — visits on the caller's own listings (owner surface).
     *
     * <p>Strictly owner-scoped: the property-id set comes from {@code properties.owner_id}, so a
     * caller can never see visits against someone else's listing.
     *
     * <p>N+1-safe: one query for the owner's listing ids, one for the visits, one for the
     * visitors.
     */
    @Transactional(readOnly = true)
    public List<VisitDto> visitRequestsOnMine(UUID callerId) {
        List<UUID> ownedPropertyIds = properties.findIdsByOwnerId(callerId);
        if (ownedPropertyIds.isEmpty()) {
            return List.of();
        }
        List<Visit> rows = visits.findByPropertyIdInOrderByCreatedAtDesc(ownedPropertyIds);
        return projectVisits(rows, callerId);
    }

    /**
     * Project a list of visits into DTOs with N+1-safe batch loading.
     */
    private List<VisitDto> projectVisits(List<Visit> rows, UUID viewerId) {
        if (rows.isEmpty()) {
            return List.of();
        }

        // Batch load all distinct visitor ids.
        Map<UUID, User> visitorMap = users.findAllById(
                        rows.stream().map(Visit::getVisitorId).distinct().toList())
                .stream().collect(Collectors.toMap(User::getId, Function.identity()));

        return rows.stream().map(visit -> {
            User visitor = visitorMap.get(visit.getVisitorId());
            ContactVisibility visibility = visitorMobileVisibility(
                    viewerId, visit.getVisitorId(), visit.getPropertyId(), visit.getStatus());
            return VisitMapper.toDto(visit, visitor, visibility);
        }).toList();
    }

    /**
     * The contact-gate question for visits (D5): may the viewer see the visitor's mobile?
     *
     * <p>A visit request is itself an approach. The visitor's mobile stays masked until:
     * <ul>
     *   <li>the visit status is {@code confirmed}, {@code completed}, or {@code no-show}
     *       (the owner has acted), <strong>or</strong></li>
     *   <li>an {@code approved} contact request exists for (visitor → property)</li>
     * </ul>
     *
     * <p>If the viewer IS the visitor, they always see their own mobile.
     */
    private ContactVisibility visitorMobileVisibility(UUID viewerId, UUID visitorUserId,
                                                      UUID propertyId, String visitStatus) {
        // The visitor always sees their own number.
        if (viewerId.equals(visitorUserId)) {
            return ContactVisibility.REVEALED;
        }
        // Owner sees the visitor's number once they've confirmed/completed/no-showed.
        if (VisitStatuses.CONFIRMED.equals(visitStatus)
                || VisitStatuses.COMPLETED.equals(visitStatus)
                || VisitStatuses.NO_SHOW.equals(visitStatus)) {
            return ContactVisibility.REVEALED;
        }
        // Or if an approved contact request exists for this visitor on this property.
        if (contactRequests.existsByRequesterIdAndPropertyIdAndStatus(
                visitorUserId, propertyId, ContactRequestStatuses.APPROVED)) {
            return ContactVisibility.REVEALED;
        }
        return ContactVisibility.MASKED;
    }
}
