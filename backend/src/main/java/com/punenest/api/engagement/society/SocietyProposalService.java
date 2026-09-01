package com.punenest.api.engagement.society;

import com.punenest.api.catalog.society.Society;
import com.punenest.api.catalog.society.SocietyRepository;
import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.ForbiddenException;
import com.punenest.api.common.error.NotFoundException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/**
 * Community proposals about a society: its missing details, its resident WhatsApp group, its pin.
 *
 * <p><strong>What was actually broken.</strong> All three lived in {@code localStorage}. A resident
 * who spent ten minutes filling in their society's builder, year, tower count and amenity list sent
 * that work to their own browser and nowhere else; the ops queue that was supposed to review it
 * read the reviewer's browser, so it was permanently empty. The same is true of the WhatsApp invite
 * — the one thing on the page that connects a new neighbour to the people already there — and of a
 * corrected map pin, which meant every society imported with a bad coordinate stayed wrong for
 * everybody no matter how many residents fixed it on their own screen.
 *
 * <p><strong>Why one service and one table for three features.</strong> They are one lifecycle
 * wearing three names: propose, screen, apply. They share a queue, they share the rule that a
 * decided proposal cannot be re-decided, and they share the question of who may propose. Written
 * three times, that rule drifts, and the drift shows up as an operator's decision being silently
 * reverted months later.
 *
 * <p><strong>Who may propose differs by kind, deliberately.</strong> A detail suggestion is open to
 * anyone signed in: the point of it is to enrich a thin, bulk-imported society without first
 * demanding that somebody verify a flat, which is how a community society becomes a verified one.
 * The invite and the pin are resident-gated, because both are assertions about the building that
 * only somebody inside it can make — and an unscreened invite link is a scam vector rather than a
 * wrong number.
 */
@Service
public class SocietyProposalService {

    /**
     * A real WhatsApp group invite and nothing else.
     *
     * <p>Anchored at both ends. An unanchored pattern accepts
     * {@code https://evil.example/?x=https://chat.whatsapp.com/AAAAAAAA}, which is precisely the
     * link an ops reviewer glancing at a list would approve.
     */
    private static final Pattern INVITE =
            Pattern.compile("^https://chat\\.whatsapp\\.com/[A-Za-z0-9]{6,32}$");

    /**
     * The coverage box the pin has to land in.
     *
     * <p>Pune's, because Pune is the only city with inventory. This is a floor, not a policy: it
     * exists so a stray map drag cannot relocate a society to another state, which is a correction
     * nobody would notice until a buyer drove there.
     */
    private static final double MIN_LAT = 18.38;
    private static final double MAX_LAT = 18.72;
    private static final double MIN_LNG = 73.68;
    private static final double MAX_LNG = 74.02;

    private final SocietyProposalRepository proposals;
    private final SocietyResidentRepository residents;
    private final SocietyClaimRepository claims;
    private final SocietyRepository societies;
    private final SocietyAuthors authors;
    private final ObjectMapper objectMapper;

    public SocietyProposalService(SocietyProposalRepository proposals,
            SocietyResidentRepository residents, SocietyClaimRepository claims,
            SocietyRepository societies, SocietyAuthors authors, ObjectMapper objectMapper) {
        this.proposals = proposals;
        this.residents = residents;
        this.claims = claims;
        this.societies = societies;
        this.authors = authors;
        this.objectMapper = objectMapper;
    }

    /**
     * Everything the hub needs about proposals for one society, in one read.
     *
     * @param viewerId null for a signed-out reader, who learns that a resident group exists and
     *     nothing that would let them join it
     */
    @Transactional(readOnly = true)
    public SocietyProposalsView view(String slug, UUID viewerId, boolean staff) {
        Society society = society(slug);
        boolean insider = staff || isResidentOrCommittee(society.getId(), viewerId);

        List<SocietyProposal> pending = proposals.pendingFor(society.getId());
        SocietyAuthors.Directory directory = authors.of(society.getId(),
                pending.stream().map(SocietyProposal::getAuthorId).toList());

        List<SocietyProposal> live = proposals.approved(society.getId(),
                SocietyProposalKinds.WHATSAPP);
        String joinUrl = live.isEmpty() ? null : live.get(0).getInviteUrl();

        return new SocietyProposalsView(
                pending.stream().map(p -> toResponse(p, slug, directory, null, insider)).toList(),
                joinUrl != null,
                insider ? joinUrl : null);
    }

    /**
     * Propose something. Replaces this author's own pending proposal of the same kind.
     *
     * <p>Replaces rather than queues a second one: somebody re-submitting is correcting their own
     * submission, and two pending rows for the same fact is a reconciliation an operator should
     * never have been handed. The partial unique index is what makes that safe under a double
     * submit.
     */
    @Transactional
    public SocietyProposalResponse propose(String slug, UUID authorId,
            SocietyProposalRequest request) {
        Society society = society(slug);
        String kind = blankToNull(request.kind());
        if (!SocietyProposalKinds.isValid(kind)) {
            throw new BadRequestException(
                    "A proposal is about this society's details, its group link or its location.");
        }

        boolean insider = isResidentOrCommittee(society.getId(), authorId);
        SocietyProposal existing = proposals.pending(society.getId(), kind).orElse(null);
        if (existing != null && !existing.getAuthorId().equals(authorId)) {
            // Somebody else is already waiting on a decision about the same fact. Overwriting it
            // would silently discard their submission; a second row cannot exist. Telling the
            // caller is the only honest option left.
            throw new ConflictException(
                    "Someone has already proposed this and it is waiting for review.");
        }

        SocietyProposal proposal = existing != null
                ? existing
                : new SocietyProposal(society.getId(), authorId, kind);

        switch (kind) {
            case SocietyProposalKinds.DETAILS -> applyDetails(proposal, request);
            case SocietyProposalKinds.WHATSAPP -> {
                requireInsider(insider,
                        "Only verified residents or the committee can add the group link.");
                applyInvite(proposal, request);
            }
            case SocietyProposalKinds.LOCATION -> {
                requireInsider(insider,
                        "Only verified residents or the committee can suggest the location.");
                applyLocation(proposal, request);
            }
            default -> throw new BadRequestException("Unknown proposal kind.");
        }

        SocietyProposal saved = proposals.save(proposal);
        SocietyAuthors.Directory directory =
                authors.of(society.getId(), List.of(saved.getAuthorId()));
        // The author is shown their own invite back regardless of the residency gate, because they
        // just typed it — and because the gate exists to stop non-residents *learning* it.
        return toResponse(saved, slug, directory, null, true);
    }

    /**
     * The ops queue. Both filters are optional; the default is everything still pending.
     *
     * <p>Oldest first, which is the opposite of every other feed in this product and is right here:
     * a proposal that has waited longest is the one somebody is still waiting on.
     */
    @Transactional(readOnly = true)
    public Page<SocietyProposalResponse> queue(String status, String kind, Pageable pageable) {
        String wantStatus = blankToNull(status);
        String wantKind = blankToNull(kind);
        if (wantStatus != null && !SocietyProposalStatuses.PENDING.equals(wantStatus)
                && !SocietyProposalStatuses.isDecision(wantStatus)) {
            throw new BadRequestException("Unknown proposal status.");
        }
        if (wantKind != null && !SocietyProposalKinds.isValid(wantKind)) {
            throw new BadRequestException("Unknown proposal kind.");
        }

        Page<SocietyProposal> page = proposals.queue(wantStatus, wantKind, pageable);
        if (page.isEmpty()) {
            return Page.empty(pageable);
        }
        // The queue spans societies, so one directory cannot answer residency for all of them; it
        // is built per row. The decider is looked up alongside the author because an operator is
        // almost never a resident of the society they are moderating, and `name` answers
        // "A resident" for anyone it was not asked about — which would put that phrase in the
        // column headed by the operator's own name.
        return page.map(p -> toResponse(p, slugOf(p.getSocietyId()),
                authors.of(p.getSocietyId(), idsOf(p)),
                p.getDecidedBy(), true));
    }

    /**
     * Approve or reject, and on approval write the value onto the society in the same transaction.
     *
     * <p>There is no separate "applied" state: a window between deciding and applying is a window
     * something can fail in, and a proposal marked approved whose value never reached the catalogue
     * is indistinguishable from one that did.
     */
    @Transactional
    public SocietyProposalResponse decide(UUID proposalId, UUID operatorId,
            SocietyProposalDecisionRequest request) {
        SocietyProposal proposal = proposals.findForDecision(proposalId)
                .orElseThrow(() -> new NotFoundException("Proposal not found."));
        String status = blankToNull(request.status());
        if (!SocietyProposalStatuses.isDecision(status)) {
            throw new BadRequestException("A decision is either approved or rejected.");
        }
        if (!SocietyProposalStatuses.PENDING.equals(proposal.getStatus())) {
            // Re-deciding would either double-apply a detail suggestion or silently revert the
            // decision an operator already made and told the author about. The row lock above is
            // what makes this check hold under two simultaneous operators.
            throw new ConflictException("This proposal has already been decided.");
        }

        proposal.decide(status, operatorId, Instant.now());
        SocietyProposal saved = proposals.save(proposal);

        if (SocietyProposalStatuses.APPROVED.equals(status)) {
            apply(saved);
        }

        String slug = slugOf(saved.getSocietyId());
        SocietyAuthors.Directory directory = authors.of(saved.getSocietyId(), idsOf(saved));
        return toResponse(saved, slug, directory, operatorId, true);
    }

    /* -------------------------------------------------------------- internals */

    /** Write an approved proposal's value where the hub actually reads it. */
    private void apply(SocietyProposal p) {
        switch (p.getKind()) {
            case SocietyProposalKinds.DETAILS -> societies.applyDetailSuggestion(p.getSocietyId(),
                    p.getBuilder(), p.getBuildYear(), p.getTowers(), p.getUnits(),
                    p.getMaintenancePerSqft(), amenitiesJson(p.getAmenities()));
            case SocietyProposalKinds.LOCATION -> societies.applyLocationFix(p.getSocietyId(),
                    p.getLat(), p.getLng(), p.getPlaceId());
            // An approved invite needs no write: the join read finds it here, and a column on the
            // society would put a private resident URL on the public detail endpoint's row.
            default -> { }
        }
    }

    private void applyDetails(SocietyProposal proposal, SocietyProposalRequest request) {
        String builder = blankToNull(request.builder());
        List<String> amenities = request.amenities() == null
                ? null
                : request.amenities().stream()
                        .map(SocietyProposalService::blankToNull)
                        .filter(a -> a != null)
                        .distinct()
                        .limit(24)
                        .toList();
        if (builder == null && request.buildYear() == null && request.towers() == null
                && request.units() == null && request.maintenancePerSqft() == null
                && (amenities == null || amenities.isEmpty())) {
            throw new BadRequestException("Add at least one detail to suggest.");
        }
        proposal.details(builder, request.buildYear(), request.towers(), request.units(),
                request.maintenancePerSqft(), amenities);
        // Fields belonging to another kind are dropped rather than refused: the composer does not
        // draw them for this kind, so a 422 would name something the author cannot see. Same rule
        // as the contributions composer.
        proposal.invite(null);
        proposal.location(null, null, null, null);
    }

    private void applyInvite(SocietyProposal proposal, SocietyProposalRequest request) {
        String url = blankToNull(request.inviteUrl());
        if (url == null || !INVITE.matcher(url).matches()) {
            throw new BadRequestException(
                    "Enter a valid WhatsApp invite link (https://chat.whatsapp.com/...).");
        }
        proposal.invite(url);
        proposal.details(null, null, null, null, null, null);
        proposal.location(null, null, null, null);
    }

    private void applyLocation(SocietyProposal proposal, SocietyProposalRequest request) {
        Double lat = request.lat();
        Double lng = request.lng();
        if (lat == null || lng == null) {
            // Half a point is not a point: a latitude with no longitude puts the map in the sea,
            // which is worse than the wrong pin it was meant to correct.
            throw new BadRequestException("Drop a pin on the society.");
        }
        if (lat < MIN_LAT || lat > MAX_LAT || lng < MIN_LNG || lng > MAX_LNG) {
            throw new BadRequestException("That pin looks outside the city.");
        }
        proposal.location(lat, lng, blankToNull(request.placeId()), blankToNull(request.label()));
        proposal.details(null, null, null, null, null, null);
        proposal.invite(null);
    }

    private static void requireInsider(boolean insider, String message) {
        if (!insider) {
            throw new ForbiddenException(message);
        }
    }

    private Society society(String slug) {
        return societies.findBySlug(slug)
                .orElseThrow(() -> new NotFoundException("Society not found."));
    }

    private String slugOf(UUID societyId) {
        return societies.findById(societyId).map(Society::getSlug).orElse(null);
    }

    /** The author, plus the operator who decided if there is one. */
    private static List<UUID> idsOf(SocietyProposal p) {
        return p.getDecidedBy() == null
                ? List.of(p.getAuthorId())
                : List.of(p.getAuthorId(), p.getDecidedBy());
    }

    /** A verified resident of this society, or its approved claimant. */
    private boolean isResidentOrCommittee(UUID societyId, UUID viewerId) {
        if (viewerId == null) {
            return false;
        }
        Set<UUID> verified = residents.verifiedAmong(societyId, List.of(viewerId));
        if (verified.contains(viewerId)) {
            return true;
        }
        return claims.findLiveClaim(societyId)
                .filter(SocietyClaim::isApproved)
                .map(c -> c.getClaimedBy().equals(viewerId))
                .orElse(false);
    }

    /**
     * The amenity list as a JSON string for the native update, or null to leave the catalogue's
     * list alone.
     *
     * <p>Null and empty stay different all the way down: null means the author did not propose a
     * list, empty means they say this society has none. Collapsing them here would make every
     * builder-only suggestion silently wipe the amenities somebody else contributed.
     */
    private String amenitiesJson(List<String> amenities) {
        if (amenities == null) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(amenities);
        } catch (RuntimeException e) {
            throw new BadRequestException("Those amenities could not be read.");
        }
    }

    private static String blankToNull(String s) {
        if (s == null) {
            return null;
        }
        String trimmed = s.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    /**
     * @param insider whether the reader may see a WhatsApp invite URL at all
     */
    private SocietyProposalResponse toResponse(SocietyProposal p, String slug,
            SocietyAuthors.Directory directory, UUID operatorId, boolean insider) {
        List<String> amenities = p.getAmenities() == null ? null : new ArrayList<>(p.getAmenities());
        return new SocietyProposalResponse(
                p.getId(), slug, p.getKind(), p.getStatus(),
                p.getBuilder(), p.getBuildYear(), p.getTowers(), p.getUnits(),
                p.getMaintenancePerSqft(), amenities,
                insider ? p.getInviteUrl() : null,
                p.getLat(), p.getLng(), p.getPlaceId(), p.getLabel(),
                directory.name(p.getAuthorId()), directory.isResident(p.getAuthorId()),
                operatorId == null ? null : directory.name(operatorId),
                p.getDecidedAt(), p.getCreatedAt());
    }
}
