package com.punenest.api.deals.visit;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.ForbiddenException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.trust.ContactVisibility;
import com.punenest.api.common.trust.Notifier;
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
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
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
    private final Notifier notifier;

    public VisitService(VisitRepository visits, PropertyRepository properties,
                        UserRepository users, Notifier notifier) {
        this.visits = visits;
        this.properties = properties;
        this.users = users;
        this.notifier = notifier;
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

        Property property = properties.findById(visit.getPropertyId())
                .orElseThrow(() -> NotFoundException.of("Visit"));
        UUID ownerId = property.getOwner().getId();

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
        visits.saveAndFlush(visit);

        // Tell the visitor their slot is now real (tech-debt D92). Only `confirmed` is announced,
        // and only ever to the visitor: the role-split above means the owner is the one who set it,
        // so they already know. `completed` and `no-show` are bookkeeping after the fact and change
        // nothing either party has to act on. `cancelled` is the one arguable omission — it is
        // two-sided, so it would need the computed recipient reschedule uses below — but it is not
        // on D92's list and is left flagged rather than quietly added.
        //
        // No slot time in the body. Rendering an Instant as a local time needs a timezone this
        // service does not have, and a notification is a summons to the thing rather than a copy of
        // it (see Notifier) — the visits tab it links to shows the slot correctly.
        if (VisitStatuses.CONFIRMED.equals(body.status()) && !visit.getVisitorId().equals(callerId)) {
            notifier.notify(visit.getVisitorId(), "visit.confirmed",
                    "Your visit is confirmed",
                    "The owner confirmed your visit to " + property.getTitle()
                            + ". Open your visits to see the slot.",
                    "/dashboard#visits");
        }
    }

    /**
     * Contract {@code rescheduleVisit} — move a live visit to a new slot (D87).
     *
     * <p><strong>Scoping.</strong> The caller must be either the visitor or the listing owner.
     * Anyone else → 404 (not 403 — do not confirm existence).
     *
     * <p><strong>Who may reschedule.</strong> Unlike {@link #updateStatus} (where the visitor may
     * only cancel), <em>either</em> participant may reschedule: proposing a new time is not a
     * privileged transition. The visit returns to {@code scheduled} so the other party re-confirms.
     *
     * <p><strong>What can be rescheduled.</strong> Only a live visit ({@code scheduled} or
     * {@code confirmed}). A terminal visit ({@code completed}, {@code cancelled}, {@code no-show})
     * is done — moving its slot would resurrect it, so it is a 409.
     *
     * @throws NotFoundException when the visit is unknown or the caller is not a participant
     * @throws ConflictException when the visit is in a terminal state
     */
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

        // Tell whichever side did not move the slot (tech-debt D92). Reschedule is the one
        // two-sided transition here, so the recipient is derived from who called rather than fixed:
        // notifying by role would have told half of all reschedulers about their own action. The
        // visit has just dropped back to `scheduled` and needs the other party to re-confirm, which
        // is exactly the thing they would otherwise never learn.
        //
        // schedule() does not stop an owner booking a visit on their own listing, so both roles can
        // land on the same person; the guard is for that case, not for tidiness.
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

    /**
     * Contract {@code listVisits} — one page of the visits the caller BOOKED (visitor surface),
     * newest first.
     *
     * <p>Strictly caller-scoped: returns only visits where the caller is the visitor. The
     * pre-spec-fix-S3 version leaked every visit on the platform.
     *
     * <p><strong>Paged (D77)</strong>, as the owner surface below is: the two are the same table
     * and the same projection seen from the two ends of a visit, and one paged / one not would make
     * the response shape depend on which side you are.
     *
     * <p>N+1-safe: one query for the page of visits, one batch load for visitor users (trivially
     * just the caller in practice, but the structure is correct for future expansion).
     */
    @Transactional(readOnly = true)
    public Page<VisitDto> myVisits(UUID callerId, Pageable pageable) {
        Page<Visit> rows = visits.findByVisitorIdOrderByCreatedAtDesc(callerId, pageable);
        // Every row on this surface has the caller as its visitor, so the owner branch of the
        // contact gate is unreachable here and needs no listing-ownership lookup.
        return projectPage(rows, callerId, Set.of());
    }

    /**
     * Contract {@code myVisitRequests} — one page of the visits on the caller's own listings
     * (owner surface), newest first.
     *
     * <p>Strictly owner-scoped: the property-id set comes from {@code properties.owner_id}, so a
     * caller can never see visits against someone else's listing.
     *
     * <p><strong>Paged (D77).</strong> A visit booking is written by somebody else against the
     * caller's listing, so the collection grows with inbound demand — the owner whose listing is
     * doing well is the one an unpaged read punishes.
     *
     * <p>N+1-safe: one query for the owner's listing ids, one for the page of visits, one for the
     * visitors on that page.
     */
    @Transactional(readOnly = true)
    public Page<VisitDto> visitRequestsOnMine(UUID callerId, Pageable pageable) {
        List<UUID> ownedPropertyIds = properties.findIdsByOwnerId(callerId);
        if (ownedPropertyIds.isEmpty()) {
            return Page.empty(pageable);
        }
        Page<Visit> rows = visits.findByPropertyIdInOrderByCreatedAtDesc(ownedPropertyIds, pageable);
        return projectPage(rows, callerId, Set.copyOf(ownedPropertyIds));
    }

    /**
     * Project one page of visits, keeping the visitor lookup a single batch load.
     *
     * <p>Deliberately not {@code Page.map}, which would run the projection per element and put that
     * lookup back inside the loop.
     *
     * @param viewerOwnedPropertyIds the listings the viewer owns, among those on this page. Passed
     *     in rather than re-queried because {@link #visitRequestsOnMine} has already fetched exactly
     *     this set to scope its own read. Supplying too FEW ids can only mask a number that could
     *     have been shown, so the safe value for a caller that does not know is the empty set.
     */
    private Page<VisitDto> projectPage(Page<Visit> rows, UUID viewerId, Set<UUID> viewerOwnedPropertyIds) {
        return new PageImpl<>(projectVisits(rows.getContent(), viewerId, viewerOwnedPropertyIds),
                rows.getPageable(), rows.getTotalElements());
    }

    /**
     * Project a list of visits into DTOs with N+1-safe batch loading.
     */
    private List<VisitDto> projectVisits(List<Visit> rows, UUID viewerId, Set<UUID> viewerOwnedPropertyIds) {
        if (rows.isEmpty()) {
            return List.of();
        }

        // Batch load all distinct visitor ids.
        Map<UUID, User> visitorMap = users.findAllById(
                        rows.stream().map(Visit::getVisitorId).distinct().toList())
                .stream().collect(Collectors.toMap(User::getId, Function.identity()));

        return rows.stream().map(visit -> {
            User visitor = visitorMap.get(visit.getVisitorId());
            ContactVisibility visibility = visitorMobileVisibility(viewerId, visit, viewerOwnedPropertyIds);
            return VisitMapper.toDto(visit, visitor, visibility);
        }).toList();
    }

    /**
     * The visit statuses at which the listing owner may see the visitor's mobile.
     *
     * <p>Excludes {@code scheduled}: a booking nobody has agreed to yet must not hand out a phone
     * number, or booking would become a way to harvest one. Includes {@code no-show} and
     * {@code completed} deliberately — the owner who waited at the flat has the strongest reason of
     * all to call, and both are reachable only from {@code confirmed}, so the number was already
     * disclosed by the time either is set.
     *
     * <p>Excludes {@code cancelled}, which is reachable from BOTH {@code scheduled} and
     * {@code confirmed}. The status column records only where a visit is now, not where it has
     * been, so the two cannot be told apart here; masking is the answer that is right on the
     * {@code scheduled → cancelled} path, where nothing was ever disclosed. On the
     * {@code confirmed → cancelled} path it re-masks digits the owner has already seen, which
     * changes nothing in the real world — it is chosen because the alternative gets the first path
     * wrong, and that is the one an abuser would use.
     */
    private static final Set<String> OWNER_MAY_SEE_VISITOR_MOBILE =
            Set.of(VisitStatuses.CONFIRMED, VisitStatuses.COMPLETED, VisitStatuses.NO_SHOW);

    /**
     * The contact-gate question for visits (D5 global policy): may the viewer see the visitor's
     * mobile?
     *
     * <p>Two ways to earn it, and no third:
     * <ul>
     *   <li>the viewer IS the visitor — everyone sees their own number, at every status;</li>
     *   <li>the viewer owns the listing AND the visit has been confirmed
     *       ({@link #OWNER_MAY_SEE_VISITOR_MOBILE}).</li>
     * </ul>
     *
     * <p>Confirming is the act that makes a visit real: someone is coming to the owner's home at a
     * stated hour, and a number to call when they are late is operationally necessary rather than a
     * marketing convenience. That is the whole justification for the reveal, and it is why the gate
     * is the owner's own confirmation and not, say, the visitor merely asking.
     *
     * <p>Note that a reschedule resets the status to {@code scheduled} (D87), which re-masks the
     * number until the owner confirms the new slot. That falls out of the rule rather than being
     * special-cased, and it is the correct reading: the agreement is to a slot, not to a person.
     *
     * <p>Anyone who is neither party sees {@code MASKED}. In practice they see nothing at all —
     * both list reads are scoped so a stranger's page is empty — but this method does not rely on
     * that, because a gate that is only correct while its callers stay correct is not a gate.
     */
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
