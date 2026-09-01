package com.punenest.api.engagement.society;

import com.punenest.api.catalog.society.Society;
import com.punenest.api.catalog.society.SocietyRepository;
import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.ForbiddenException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Who belongs to a society, and who runs its page.
 *
 * <p><strong>This is the spine of the society hub.</strong> Every other community surface — the
 * notice board, Q&A, contributions — is gated on "is this person a verified resident here, or the
 * committee". Until this service existed, that question was answered by a {@code localStorage} array
 * that the person being asked about owned, which is to say it was not answered at all. It also meant
 * a resident who verified their flat on a laptop was a stranger on their phone, and that a committee
 * approving a neighbour approved them only in their own browser.
 *
 * <p><strong>Two deciders, chosen at request time.</strong> A claimed society reviews its own
 * residents; an unclaimed one is reviewed by ops. The queue is stamped onto the row when it is
 * created rather than derived on read — see {@link SocietyResidentQueues} for why moving a
 * half-worked queue out from under its reviewer is worse than the row being slightly stale.
 */
@Service
public class SocietyMembershipService {

    private final SocietyResidentRepository residents;
    private final SocietyClaimRepository claims;
    private final SocietyRepository societies;
    private final UserRepository users;

    public SocietyMembershipService(SocietyResidentRepository residents,
            SocietyClaimRepository claims, SocietyRepository societies, UserRepository users) {
        this.residents = residents;
        this.claims = claims;
        this.societies = societies;
        this.users = users;
    }

    /* ------------------------------------------------------------------ reads */

    /**
     * Everything the hub needs to decide which controls to render, in one call.
     *
     * <p>Answers for an anonymous reader too: no residency, not an admin, but the society's live
     * claim and its verified-resident count are public facts about the building and are what make a
     * logged-out visitor's "claim this society" button either appear or correctly not.
     */
    @Transactional(readOnly = true)
    public SocietyMembership membership(String slug, UUID viewerId) {
        Society society = society(slug);
        Optional<SocietyClaim> live = claims.findLiveClaim(society.getId());
        SocietyResident mine = viewerId == null ? null
                : residents.findBySocietyIdAndUserId(society.getId(), viewerId).orElse(null);
        boolean admin = live.map(c -> c.isApproved() && c.getClaimedBy().equals(viewerId))
                .orElse(false);
        return new SocietyMembership(
                society.getSlug(),
                mine == null ? null : toResponse(mine, society.getSlug(), users.findById(mine.getUserId()).orElse(null)),
                admin,
                // The claimant's mobile is withheld here and nowhere else. This read is public, and
                // "who claimed my society" must not be a way to get a committee member's number off
                // a page anybody can load. The ops queue below does publish it, because a reviewer
                // deciding a claim has to be able to ring the person who made it.
                live.map(c -> withoutClaimantMobile(toResponse(c, society))).orElse(null),
                residents.countBySocietyIdAndStatus(society.getId(), SocietyResidentStatuses.VERIFIED));
    }

    /**
     * The residency queue for one society — the committee's inbox, or ops looking at the same rows.
     *
     * <p>Guarded by {@link #requireReviewer}: a resident of a society is not entitled to read every
     * neighbour's name and mobile just for living there. The reviewer's own decision is the reason
     * that disclosure is acceptable, so the disclosure follows the decision.
     */
    @Transactional(readOnly = true)
    public Page<SocietyResidentResponse> queue(String slug, String status, UUID viewerId,
            boolean staff, Pageable pageable) {
        Society society = society(slug);
        requireReviewer(society, viewerId, staff);
        Page<SocietyResident> page = residents.queueFor(society.getId(), blankToNull(status),
                pageable);
        Map<UUID, User> byId = usersOf(page.getContent().stream().map(SocietyResident::getUserId)
                .toList());
        return page.map(r -> toResponse(r, society.getSlug(), byId.get(r.getUserId())));
    }

    /* ----------------------------------------------------------------- writes */

    /**
     * Ask to be recognised as a resident of one flat.
     *
     * <p>Re-applying amends the standing request rather than queueing a second — see
     * {@link SocietyResident#reapply}. Verified residency is deliberately <em>not</em> re-openable
     * this way: somebody who has been verified and then edits their flat number would otherwise
     * silently keep the old unit's exclusive hold while claiming a new one.
     */
    @Transactional
    public SocietyResidentResponse requestVerification(String slug, UUID userId,
            ResidentVerificationRequest body) {
        Society society = society(slug);
        String relation = relationOrDefault(body.relation());
        String unitKey = SocietyResident.normaliseUnit(body.wing(), body.flat());
        if (unitKey.isEmpty()) {
            throw new BadRequestException("flat must contain at least one letter or digit");
        }

        boolean conflicting = residents.verifiedHoldersOf(society.getId(), unitKey).stream()
                .anyMatch(r -> !r.getUserId().equals(userId));
        String queue = claims.findLiveClaim(society.getId()).filter(SocietyClaim::isApproved)
                .isPresent() ? SocietyResidentQueues.COMMITTEE : SocietyResidentQueues.OPS;

        SocietyResident row = residents.findBySocietyIdAndUserId(society.getId(), userId)
                .orElse(null);
        if (row == null) {
            row = new SocietyResident(society.getId(), userId, body.wing(), body.flat(), relation,
                    body.note(), queue, conflicting);
        } else {
            if (row.isVerified() && !row.getUnitKey().equals(unitKey)) {
                throw new ConflictException(
                        "You are already verified in " + row.getUnitKey()
                                + ". Ask the committee to move your verification to a different flat.");
            }
            row.reapply(body.wing(), body.flat(), relation, body.note(), queue, conflicting);
        }
        SocietyResident saved = residents.save(row);
        return toResponse(saved, society.getSlug(), users.findById(userId).orElse(null));
    }

    /**
     * Verify or reject one residency request.
     *
     * <p>The uniqueness of a verified unit is enforced by {@code ux_society_residents_unit_verified}
     * and only checked here to produce a readable message. The check cannot be the enforcement: two
     * reviewers deciding two claimants on the same flat in the same second would both pass it. So
     * the constraint violation is caught and translated rather than prevented.
     */
    @Transactional
    public SocietyResidentResponse decide(String slug, UUID residentId, UUID viewerId,
            boolean staff, ResidentDecisionRequest body) {
        Society society = society(slug);
        requireReviewer(society, viewerId, staff);
        if (!SocietyResidentStatuses.isDecision(body.status())) {
            throw new BadRequestException("status must be verified or rejected");
        }

        SocietyResident row = residents.findById(residentId)
                .filter(r -> r.getSocietyId().equals(society.getId()))
                .orElseThrow(() -> NotFoundException.of("Residency request"));

        if (SocietyResidentStatuses.VERIFIED.equals(body.status())) {
            boolean taken = residents.verifiedHoldersOf(society.getId(), row.getUnitKey()).stream()
                    .anyMatch(r -> !r.getUserId().equals(row.getUserId()));
            if (taken) {
                throw new ConflictException("Another resident is already verified in "
                        + row.getUnitKey() + ". Reject their claim first if the flat has changed hands.");
            }
        }
        row.decide(body.status(), viewerId);
        try {
            residents.saveAndFlush(row);
        } catch (DataIntegrityViolationException race) {
            throw new ConflictException("Another resident was verified in " + row.getUnitKey()
                    + " while this was being decided.");
        }
        return toResponse(row, society.getSlug(), users.findById(row.getUserId()).orElse(null));
    }

    /**
     * Claim a society on behalf of its committee.
     *
     * <p>A society that already has a live claim is refused rather than queued behind it — two
     * committees for one building is a data problem, not a backlog — except when the caller is
     * amending their own pending claim, which is a correction.
     */
    @Transactional
    public SocietyClaimResponse claim(String slug, UUID userId, SocietyClaimRequest body) {
        Society society = society(slug);
        Optional<SocietyClaim> live = claims.findLiveClaim(society.getId());
        if (live.isPresent()) {
            SocietyClaim existing = live.get();
            if (!existing.getClaimedBy().equals(userId)) {
                throw new ConflictException(existing.isApproved()
                        ? "This society is already managed by its committee."
                        : "Someone has already claimed this society and is waiting on review.");
            }
            if (existing.isApproved()) {
                throw new ConflictException("You already manage this society.");
            }
            existing.amend(body.name(), body.role(), body.email(), body.note());
            return toResponse(claims.save(existing), society);
        }
        SocietyClaim row = new SocietyClaim(society.getId(), userId, body.name(), body.role(),
                body.email(), body.note());
        try {
            SocietyClaim saved = claims.saveAndFlush(row);
            // The society's own claim_status moves in the same transaction. Two records of one fact
            // that can disagree is worse than one record in the wrong place: the hub reads the
            // society's badge, ops read the claim, and a society still showing "unclaimed" while a
            // committee waits on review is how a claim gets worked twice.
            societies.updateClaimStatus(society.getId(),
                    com.punenest.api.catalog.society.SocietyClaimStatus.PENDING);
            return toResponse(saved, society);
        } catch (DataIntegrityViolationException race) {
            throw new ConflictException("Someone claimed this society a moment ago.");
        }
    }

    /* ------------------------------------------------------------------- ops */

    /** The claim queue, oldest first. Staff-only; guarded at the controller. */
    @Transactional(readOnly = true)
    public Page<SocietyClaimResponse> claimQueue(String status, Pageable pageable) {
        Page<SocietyClaim> page = claims.queue(blankToNull(status), pageable);
        Map<UUID, Society> bySociety = societiesOf(page.getContent().stream()
                .map(SocietyClaim::getSocietyId).toList());
        return page.map(c -> toResponse(c, bySociety.get(c.getSocietyId())));
    }

    /**
     * Approve or reject a claim, and move the society's own {@code claim_status} with it.
     *
     * <p>The two writes are one transaction on purpose. A society whose claim says approved while
     * its own record still says unclaimed is a society whose committee holds a permission the hub
     * will not render a control for, and that state is unrecoverable without a manual fix.
     *
     * <p><strong>Approving also re-homes the residency queue.</strong> Requests filed while nobody
     * ran the society were assigned to ops; on approval the ones still pending move to the committee
     * that now exists, because ops reviewing a claimed society's residents is exactly the work the
     * claim was meant to hand over. Already-decided rows keep their queue — the record of who
     * decided must not be rewritten.
     */
    @Transactional
    public SocietyClaimResponse decideClaim(UUID claimId, UUID decidedBy,
            SocietyClaimDecisionRequest body) {
        if (!SocietyClaimStatuses.isDecision(body.status())) {
            throw new BadRequestException("status must be approved or rejected");
        }
        SocietyClaim row = claims.findForDecision(claimId)
                .orElseThrow(() -> NotFoundException.of("Society claim"));
        if (!SocietyClaimStatuses.PENDING.equals(row.getStatus())) {
            // Re-deciding rewrites decidedBy/decidedAt, so the record of who handed this society
            // over is lost. Worse, re-approving a rejected claim silently transfers the residency
            // register to someone an operator already turned down. The row lock above is what makes
            // this check hold under two simultaneous operators; without it both read `pending`.
            throw new ConflictException("This claim has already been decided.");
        }
        Society society = societies.findById(row.getSocietyId())
                .orElseThrow(() -> NotFoundException.of("Society"));

        row.decide(body.status(), decidedBy, body.note());
        claims.save(row);
        societies.updateClaimStatus(society.getId(), row.isApproved()
                ? com.punenest.api.catalog.society.SocietyClaimStatus.CLAIMED
                : com.punenest.api.catalog.society.SocietyClaimStatus.UNCLAIMED);
        if (row.isApproved()) {
            residents.reassignPendingQueue(society.getId(), SocietyResidentQueues.COMMITTEE);
        }
        return toResponse(row, society);
    }

    /* -------------------------------------------------------------- internals */
    /**
     * A reviewer is either platform staff or the society's approved claimant.
     *
     * <p>Staff first, and unconditionally: an unclaimed society has no committee, and ops are the
     * only people who can seed one. That is also why a rejected or pending claim grants nothing —
     * the claim being undecided is exactly the state in which nobody should be reviewing.
     */
    private void requireReviewer(Society society, UUID viewerId, boolean staff) {
        if (staff) {
            return;
        }
        boolean admin = viewerId != null && claims.findLiveClaim(society.getId())
                .map(c -> c.isApproved() && c.getClaimedBy().equals(viewerId)).orElse(false);
        if (!admin) {
            throw new ForbiddenException("Only this society's committee or our team can review residents.");
        }
    }

    private Society society(String slug) {
        return societies.findBySlug(slug).orElseThrow(() -> NotFoundException.of("Society"));
    }

    private String relationOrDefault(String relation) {
        if (relation == null || relation.isBlank()) {
            return SocietyResidentRelations.RESIDENT;
        }
        if (!SocietyResidentRelations.isValid(relation)) {
            throw new BadRequestException("relation must be one of owner, tenant, family, resident");
        }
        return relation;
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s;
    }

    /** One lookup for a whole page rather than one per row. */
    private Map<UUID, User> usersOf(List<UUID> ids) {
        Map<UUID, User> byId = new LinkedHashMap<>();
        if (!ids.isEmpty()) {
            users.findAllById(ids).forEach(u -> byId.put(u.getId(), u));
        }
        return byId;
    }

    /** Same idea for the societies a page of claims points at. */
    private Map<UUID, Society> societiesOf(List<UUID> ids) {
        Map<UUID, Society> byId = new LinkedHashMap<>();
        if (!ids.isEmpty()) {
            societies.findAllById(ids).forEach(s -> byId.put(s.getId(), s));
        }
        return byId;
    }

    private static SocietyResidentResponse toResponse(SocietyResident r, String slug, User u) {
        return new SocietyResidentResponse(r.getId(), slug,
                u == null ? null : u.getName(),
                u == null ? null : u.getMobile(),
                r.getWing(), r.getFlat(), r.getUnitKey(), r.getRelation(), r.getStatus(),
                r.getAssignedTo(), r.getFlagged(), r.getNote(), r.getCreatedAt(), r.getDecidedAt());
    }

    private SocietyClaimResponse toResponse(SocietyClaim c, Society society) {
        User claimant = users.findById(c.getClaimedBy()).orElse(null);
        return new SocietyClaimResponse(c.getId(), society.getSlug(), society.getName(),
                c.getName(), claimant == null ? null : claimant.getMobile(), c.getRole(),
                c.getEmail(), c.getNote(), c.getStatus(), c.getCreatedAt(), c.getDecidedAt());
    }

    /** The same claim minus the two contact fields, for the surface anybody can read. */
    private static SocietyClaimResponse withoutClaimantMobile(SocietyClaimResponse c) {
        return new SocietyClaimResponse(c.id(), c.societySlug(), c.societyName(), c.claimantName(),
                null, c.role(), null, c.note(), c.status(), c.createdAt(), c.decidedAt());
    }
}
