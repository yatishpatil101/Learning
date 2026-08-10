package com.punenest.api.deals.finalization;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.ForbiddenException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.trust.MobileMask;
import com.punenest.api.common.web.Ids;
import com.punenest.api.deals.deal.DealService;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The finalization maker/checker lifecycle: request, cancel, accept, decline, and the two
 * status reads.
 *
 * <p><strong>Who may do what.</strong> The <em>initiator</em> (buyer/maker) may cancel their own
 * request. The <em>counterparty</em> (listing owner/checker) may accept or decline. The listing
 * <em>owner</em> may read the property's finalization status. Anyone else gets 404, never 403 —
 * do not confirm existence. Where a legitimate participant is not authorised for an action,
 * return 403 (e.g. the initiator attempting to accept their own request).
 *
 * <p><strong>The load-bearing invariant: accepting auto-declines siblings, transactionally.</strong>
 * {@link #accept} must, in one transaction: set this request to {@code accepted}, set every other
 * pending request on the same property to {@code declined}, and close the property's deal via
 * {@link DealService#closeForFinalization}. If the deal close fails, nothing commits — rollback
 * proves the maker/checker guarantee.
 *
 * <p><strong>Counterparty must be registered (NOT NULL, V11).</strong> Unlike {@code closeDeal},
 * which accepts an off-platform mobile (the buyer there never has to log in), finalization is a
 * two-sided flow where the counterparty must sign in and accept. A {@code counterpartyMobile} that
 * resolves to no registered user is genuinely invalid → 422. This asymmetry is the deliberate
 * opposite of the close-deal path and is the kind of contrast a future reader will otherwise "fix"
 * into a bug.
 */
@Service
public class FinalizationService {

    private static final Logger LOG = LoggerFactory.getLogger(FinalizationService.class);

    private final FinalizationRequestRepository finalizationRequests;
    private final PropertyRepository properties;
    private final UserRepository users;
    private final DealService dealService;

    public FinalizationService(FinalizationRequestRepository finalizationRequests,
                               PropertyRepository properties,
                               UserRepository users,
                               DealService dealService) {
        this.finalizationRequests = finalizationRequests;
        this.properties = properties;
        this.users = users;
        this.dealService = dealService;
    }

    /**
     * Contract {@code requestFinalization} — buyer requests finalization for a listing.
     *
     * <p>Invariants:
     * <ul>
     *   <li>Property must exist (404).</li>
     *   <li>Body {@code propertyId}, if present, must match the path (422 — S4).</li>
     *   <li>{@code counterpartyMobile} must resolve to a registered user (422 — see class Javadoc).</li>
     *   <li>No existing live request by this initiator on this property (409 — duplicate).</li>
     * </ul>
     *
     * @throws NotFoundException when the property does not exist
     * @throws BadRequestException when body propertyId mismatches the path
     * @throws ConflictException when a live request already exists (duplicate)
     */
    @Transactional
    public FinalizationRequestDto request(UUID callerId, UUID propertyId,
                                           FinalizationCreateRequest body) {
        // S4: if body carries a propertyId, it must equal the path.
        if (body.propertyId() != null && !body.propertyId().isBlank()) {
            UUID bodyPropId = Ids.parseUuid(body.propertyId()).orElse(null);
            if (bodyPropId == null || !bodyPropId.equals(propertyId)) {
                throw new BadRequestException(
                        "Body propertyId must match the path parameter or be omitted");
            }
        }

        // Property must exist. The owner is the only legitimate counterparty, so resolve them here.
        Property property = properties.findById(propertyId)
                .orElseThrow(() -> NotFoundException.of("Property"));
        User counterparty = property.getOwner();

        // The counterparty is derived from the listing, never from the request body. The body's
        // mobile is validated against it rather than trusted.
        //
        // Two things go wrong if the body picks the counterparty. First, a buyer could aim a
        // finalization request at any registered user, filling a stranger's inbox with proposals
        // about a listing that is nothing to do with them and leaking the initiator's name to
        // them. Second, the "is this mobile registered?" answer becomes an account-enumeration
        // oracle -- and on this platform a registered mobile is precisely the thing worth
        // harvesting. Comparing against the owner's number answers neither question: the caller
        // learns only whether they already knew who owns this listing, which they did.
        String normalised = MobileMask.normalise(body.counterpartyMobile());
        if (normalised == null || !normalised.equals(MobileMask.normalise(counterparty.getMobile()))) {
            throw new BadRequestException(
                    "counterpartyMobile must be the listing owner's mobile number");
        }

        // Duplicate prevention: service pre-check for a clean message.
        if (finalizationRequests.findLiveByInitiatorAndProperty(callerId, propertyId).isPresent()) {
            throw new ConflictException(
                    "You already have a pending finalization request on this property");
        }

        FinalizationRequest request;
        try {
            request = new FinalizationRequest(
                    propertyId, callerId, counterparty.getId(), body.agreedPrice());
            request = finalizationRequests.saveAndFlush(request);
        } catch (DataIntegrityViolationException constraintViolation) {
            // The partial unique index uq_finalization_live_per_user_property caught a concurrent
            // double-tap that slipped past the service-level check.
            LOG.debug("Concurrent duplicate finalization request for user {} on property {}",
                    callerId, propertyId);
            throw new ConflictException(
                    "You already have a pending finalization request on this property");
        }

        User initiator = users.findById(callerId).orElse(null);
        return FinalizationMapper.toDto(request, initiator, counterparty, callerId);
    }

    /**
     * Contract {@code finalizationStatus} — the caller-relevant request for this property.
     *
     * <p><strong>Caller-relevant definition:</strong> the caller's <em>most recent</em> request on
     * this property, whatever its status, where the caller is either the initiator or the
     * counterparty. Returning terminal rows (declined/cancelled/accepted) and not only the pending
     * one is deliberate (D111): a turned-down buyer must be distinguishable from a buyer who never
     * asked, so the property panel can explain the refusal and offer to ask again. A caller who was
     * never a participant on this property gets 404 — the honest "nothing here, and nothing that
     * concerns you" answer.
     *
     * @throws NotFoundException when the caller has never had a request on this property
     */
    @Transactional(readOnly = true)
    public FinalizationRequestDto status(UUID callerId, UUID propertyId) {
        FinalizationRequest request = finalizationRequests
                .findRecentByPropertyAndParticipant(propertyId, callerId, PageRequest.of(0, 1))
                .stream().findFirst()
                .orElseThrow(() -> NotFoundException.of("Finalization request"));

        Map<UUID, User> userMap = batchLoadUsers(
                request.getInitiatorId(), request.getCounterpartyId());
        return FinalizationMapper.toDto(request,
                userMap.get(request.getInitiatorId()),
                userMap.get(request.getCounterpartyId()),
                callerId);
    }

    /**
     * Contract {@code cancelFinalization} — the initiator soft-cancels their own request.
     * Returns nothing (204).
     *
     * <p>Only the initiator may cancel. The counterparty is a legitimate participant but may not
     * cancel (they can decline instead) → 403. A complete stranger → 404.
     *
     * @throws NotFoundException when no live request exists on this property for the caller
     * @throws ForbiddenException when the caller is the counterparty (wrong action for them)
     * @throws ConflictException on an illegal transition (not pending)
     */
    @Transactional
    public void cancel(UUID callerId, UUID propertyId) {
        FinalizationRequest request = finalizationRequests
                .findLiveByPropertyAndParticipant(propertyId, callerId)
                .orElseThrow(() -> NotFoundException.of("Finalization request"));

        // Only the initiator may cancel.
        if (!callerId.equals(request.getInitiatorId())) {
            throw new ForbiddenException("Only the initiator may cancel a finalization request");
        }

        if (!FinalizationStatuses.canTransition(request.getStatus(), FinalizationStatuses.CANCELLED)) {
            throw new ConflictException("Cannot cancel a request in status " + request.getStatus());
        }

        request.setStatus(FinalizationStatuses.CANCELLED);
        finalizationRequests.saveAndFlush(request);
    }

    /**
     * Contract {@code myFinalizationRequests} — one page of the requests awaiting the caller's
     * decision, newest first. Strictly counterparty-scoped: returns only requests where the caller
     * is the counterparty and the status is pending.
     *
     * <p><strong>Paged (D77).</strong> Every row is a proposal somebody else aimed at the caller,
     * so the collection grows with inbound demand rather than with anything the caller did.
     *
     * <p>N+1-safe: one query for the page of requests, one batch load for that page's participant
     * users.
     */
    @Transactional(readOnly = true)
    public Page<FinalizationRequestDto> myRequests(UUID callerId, Pageable pageable) {
        Page<FinalizationRequest> rows =
                finalizationRequests.findPendingByCounterparty(callerId, pageable);
        if (rows.isEmpty()) {
            return new PageImpl<>(List.of(), rows.getPageable(), rows.getTotalElements());
        }

        // Batch load all participant users.
        List<UUID> userIds = rows.getContent().stream()
                .flatMap(r -> Stream.of(r.getInitiatorId(), r.getCounterpartyId()))
                .distinct()
                .toList();
        Map<UUID, User> userMap = users.findAllById(userIds).stream()
                .collect(Collectors.toMap(User::getId, Function.identity()));

        List<FinalizationRequestDto> content = rows.getContent().stream()
                .map(r -> FinalizationMapper.toDto(r,
                        userMap.get(r.getInitiatorId()),
                        userMap.get(r.getCounterpartyId()),
                        callerId))
                .toList();
        return new PageImpl<>(content, rows.getPageable(), rows.getTotalElements());
    }

    /**
     * Contract {@code acceptFinalization} — the counterparty (owner/checker) accepts.
     *
     * <p><strong>The load-bearing invariant, all in one transaction:</strong>
     * <ol>
     *   <li>Set this request to {@code accepted}.</li>
     *   <li>Auto-decline every other pending request on the same property.</li>
     *   <li>Close the property's deal via {@link DealService#closeForFinalization}.</li>
     * </ol>
     *
     * <p>If any step fails (e.g. the deal is already closed), the whole transaction rolls back —
     * no request is left accepted while siblings remain pending.
     *
     * @throws NotFoundException when the request does not exist or the caller is not a participant
     * @throws ForbiddenException when the caller is the initiator (cannot accept own request)
     * @throws ConflictException on an illegal transition
     */
    @Transactional
    public void accept(UUID callerId, UUID requestId) {
        FinalizationRequest request = finalizationRequests.findById(requestId)
                .orElseThrow(() -> NotFoundException.of("Finalization request"));

        // Scoping: caller must be a participant.
        if (!callerId.equals(request.getInitiatorId())
                && !callerId.equals(request.getCounterpartyId())) {
            throw NotFoundException.of("Finalization request");
        }

        // The initiator must NOT be able to accept their own request.
        if (callerId.equals(request.getInitiatorId())) {
            throw new ForbiddenException(
                    "The initiator cannot accept their own finalization request");
        }

        if (!FinalizationStatuses.canTransition(request.getStatus(), FinalizationStatuses.ACCEPTED)) {
            throw new ConflictException("Cannot accept a request in status " + request.getStatus());
        }

        // 1. Close the property's deal FIRST. If this throws (e.g. deal already closed), nothing
        //    else in this method has mutated state — the atomicity guarantee holds without needing
        //    an explicit rollback of finalization request statuses.
        User initiator = users.findById(request.getInitiatorId()).orElse(null);
        String initiatorMobile = initiator != null ? initiator.getMobile() : null;
        dealService.closeForFinalization(
                request.getCounterpartyId(),
                request.getPropertyId(),
                request.getAgreedPrice(),
                initiatorMobile,
                request.getInitiatorId());

        // 2. Accept this request.
        request.setStatus(FinalizationStatuses.ACCEPTED);
        finalizationRequests.saveAndFlush(request);

        // 3. Auto-decline all other pending requests on the same property.
        finalizationRequests.declineSiblings(request.getPropertyId(), request.getId());
    }

    /**
     * Contract {@code declineFinalization} — the counterparty (owner/checker) declines.
     *
     * @throws NotFoundException when the request does not exist or the caller is not a participant
     * @throws ForbiddenException when the caller is the initiator (cannot decline own request)
     * @throws ConflictException on an illegal transition
     */
    @Transactional
    public void decline(UUID callerId, UUID requestId) {
        FinalizationRequest request = finalizationRequests.findById(requestId)
                .orElseThrow(() -> NotFoundException.of("Finalization request"));

        // Scoping: caller must be a participant.
        if (!callerId.equals(request.getInitiatorId())
                && !callerId.equals(request.getCounterpartyId())) {
            throw NotFoundException.of("Finalization request");
        }

        // The initiator must NOT be able to decline (they should cancel instead).
        if (callerId.equals(request.getInitiatorId())) {
            throw new ForbiddenException(
                    "The initiator cannot decline their own request; use cancel instead");
        }

        if (!FinalizationStatuses.canTransition(request.getStatus(), FinalizationStatuses.DECLINED)) {
            throw new ConflictException(
                    "Cannot decline a request in status " + request.getStatus());
        }

        request.setStatus(FinalizationStatuses.DECLINED);
        finalizationRequests.save(request);
    }

    // ---- internal helpers ----

    private Map<UUID, User> batchLoadUsers(UUID... ids) {
        return users.findAllById(List.of(ids)).stream()
                .collect(Collectors.toMap(User::getId, Function.identity()));
    }
}
