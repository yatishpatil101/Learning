package com.draazy.api.deals.visit;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.trust.ContactVisibility;
import com.draazy.api.common.trust.Notifier;
import com.draazy.api.common.web.Ids;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.AuthPrincipal;
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
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class VisitService {

    private static final Logger LOG = LoggerFactory.getLogger(VisitService.class);

    private final VisitRepository visits;
    private final PropertyRepository properties;
    private final UserRepository users;
    private final Notifier notifier;
    private final AuditService audit;

    public VisitService(VisitRepository visits, PropertyRepository properties,
                        UserRepository users, Notifier notifier, AuditService audit) {
        this.visits = visits;
        this.properties = properties;
        this.users = users;
        this.notifier = notifier;
        this.audit = audit;
    }

    // The caller must be either the visitor or the listing owner.
    // Who may do what (the security-critical rule).
    @Transactional
    public VisitDto schedule(UUID callerId, VisitCreateRequest body) {
        UUID propertyId = Ids.parseUuid(body.propertyId()).orElse(null);
        Property property = propertyId == null ? null : properties.findById(propertyId).orElse(null);
        if (property == null) {
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

            LOG.debug("Concurrent duplicate visit for user {} on property {}", callerId, propertyId);
            throw new ConflictException("You already have a live visit on this property");
        }

        User visitor = users.findById(callerId).orElse(null);
        UUID ownerId = property.getOwner().getId();
        if (!ownerId.equals(callerId)) {
            notifier.notify(ownerId, "visit.requested",
                    "New visit request",
                    displayName(visitor) + " wants to visit " + property.getTitle()
                            + ". Confirm it or suggest another time.",
                    "/dashboard#visits");
        }
        return VisitMapper.toDto(visit, visitor, ContactVisibility.REVEALED);
    }

    // The caller must be either the visitor or the listing owner.
    // Who may do what (the security-critical rule).
    @Transactional
    public void updateStatus(AuthPrincipal caller, UUID visitId, VisitStatusUpdateRequest body) {
        Visit visit = visits.findById(visitId)
                .orElseThrow(() -> NotFoundException.of("Visit"));

        Property property = properties.findById(visit.getPropertyId())
                .orElseThrow(() -> NotFoundException.of("Visit"));
        UUID ownerId = property.getOwner().getId();

        boolean isVisitor = caller.userId().equals(visit.getVisitorId());
        boolean isOwner = caller.userId().equals(ownerId);
        if (!isVisitor && !isOwner) {
            throw NotFoundException.of("Visit");
        }

        // Role-split: the visitor may ONLY cancel. Any other transition from a visitor is 403.
        // why: a visitor marking 'completed' would forge the anti-fake-review signal (item f).
        if (isVisitor && !VisitStatuses.CANCELLED.equals(body.status())) {
            throw new ForbiddenException(
                    "Only the listing owner can set status '" + body.status() + "'");
        }

        String before = visit.getStatus();
        if (body.status().equals(before)) {
            return;
        }
        if (!VisitStatuses.canTransition(visit.getStatus(), body.status())) {
            throw new ConflictException(
                    "Cannot transition from '" + visit.getStatus() + "' to '" + body.status() + "'");
        }

        visit.setStatus(body.status());
        visits.saveAndFlush(visit);
        audit.record(caller, "visit.status", "visit", visit.getId().toString(),
                "fromStatus", before, "toStatus", body.status());

        if (VisitStatuses.CONFIRMED.equals(body.status())
                && !visit.getVisitorId().equals(caller.userId())) {
            // `completed` and `no-show` are bookkeeping after the fact and change nothing either party has to act on.
            notifier.notify(visit.getVisitorId(), "visit.confirmed",
                    "Your visit is confirmed",
                    "The owner confirmed your visit to " + property.getTitle()
                            + ". Open your visits to see the slot.",
                    "/dashboard#visits");
        }
        UUID other = isOwner ? visit.getVisitorId() : ownerId;
        if (VisitStatuses.CANCELLED.equals(body.status()) && !other.equals(caller.userId())) {
            notifier.notify(other, "visit.cancelled",
                    "A visit was cancelled",
                    (isOwner ? "The owner" : "The visitor") + " cancelled the visit to "
                            + property.getTitle() + ".",
                    "/dashboard#visits");
        }
    }

    private static String displayName(User user) {
        return user == null || user.getName() == null || user.getName().isBlank()
                ? "Someone" : user.getName();
    }

    @Transactional
    public void reschedule(UUID callerId, UUID visitId, VisitSlotUpdateRequest body) {
        Visit visit = visits.findById(visitId)
                .orElseThrow(() -> NotFoundException.of("Visit"));

        Property property = properties.findById(visit.getPropertyId())
                .orElseThrow(() -> NotFoundException.of("Visit"));
        UUID ownerId = property.getOwner().getId();

        boolean isVisitor = callerId.equals(visit.getVisitorId());
        boolean isOwner = callerId.equals(ownerId);
        if (!isVisitor && !isOwner) {
            throw NotFoundException.of("Visit");
        }

        if (!VisitStatuses.canReschedule(visit.getStatus())) {
            throw new ConflictException(
                    "Cannot reschedule a '" + visit.getStatus() + "' visit");
        }

        visit.reschedule(body.slot());
        visits.saveAndFlush(visit);

        // An owner can book their own listing, so both roles may point to one user.
        // Reschedule is two-sided, so the recipient is derived from who called rather than fixed.
        UUID other = isOwner ? visit.getVisitorId() : ownerId;
        if (!other.equals(callerId)) {
            String mover = isOwner ? "The owner" : "The visitor";
            notifier.notify(other, "visit.rescheduled",
                    "A visit was moved to a new time",
                    mover + " proposed a new slot for " + property.getTitle()
                            + ". It is back to scheduled until you confirm it.",
                    "/dashboard#visits");
        }
    }

    @Transactional(readOnly = true)
    public Page<VisitDto> myVisits(UUID callerId, UUID propertyId, Pageable pageable) {
        Page<Visit> rows = propertyId == null
                ? visits.findByVisitorIdOrderByCreatedAtDesc(callerId, pageable)
                : visits.findByVisitorIdAndPropertyIdOrderByCreatedAtDesc(callerId, propertyId, pageable);

        return projectPage(rows, callerId, Set.of());
    }

    @Transactional(readOnly = true)
    public Page<VisitDto> visitRequestsOnMine(UUID callerId, Pageable pageable) {
        List<UUID> ownedPropertyIds = properties.findIdsByOwnerId(callerId);
        if (ownedPropertyIds.isEmpty()) {
            return Page.empty(pageable);
        }
        Page<Visit> rows = visits.findByPropertyIdInOrderByCreatedAtDesc(ownedPropertyIds, pageable);
        return projectPage(rows, callerId, Set.copyOf(ownedPropertyIds));
    }

    private Page<VisitDto> projectPage(Page<Visit> rows, UUID viewerId, Set<UUID> viewerOwnedPropertyIds) {
        return new PageImpl<>(projectVisits(rows.getContent(), viewerId, viewerOwnedPropertyIds),
                rows.getPageable(), rows.getTotalElements());
    }

    private List<VisitDto> projectVisits(List<Visit> rows, UUID viewerId, Set<UUID> viewerOwnedPropertyIds) {
        if (rows.isEmpty()) {
            return List.of();
        }

        Map<UUID, User> visitorMap = users.findAllById(
                        rows.stream().map(Visit::getVisitorId).distinct().toList())
                .stream().collect(Collectors.toMap(User::getId, Function.identity()));

        return rows.stream().map(visit -> {
            User visitor = visitorMap.get(visit.getVisitorId());
            ContactVisibility visibility = visitorMobileVisibility(viewerId, visit, viewerOwnedPropertyIds);
            return VisitMapper.toDto(visit, visitor, visibility);
        }).toList();
    }

    // Scheduled visits are excluded so booking cannot harvest a phone number.
    private static final Set<String> OWNER_MAY_SEE_VISITOR_MOBILE =
            Set.of(VisitStatuses.CONFIRMED, VisitStatuses.COMPLETED, VisitStatuses.NO_SHOW);

    // Rescheduling re-masks the number until the owner confirms the new slot.
    // Anyone who is neither party sees `MASKED`.
    private ContactVisibility visitorMobileVisibility(UUID viewerId, Visit visit,
                                                      Set<UUID> viewerOwnedPropertyIds) {
        if (viewerId.equals(visit.getVisitorId())) {
            return ContactVisibility.REVEALED;
        }
        boolean viewerOwnsListing = viewerOwnedPropertyIds.contains(visit.getPropertyId());
        return viewerOwnsListing && OWNER_MAY_SEE_VISITOR_MOBILE.contains(visit.getStatus())
                ? ContactVisibility.REVEALED : ContactVisibility.MASKED;
    }
}
