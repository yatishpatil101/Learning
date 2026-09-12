package com.draazy.api.engagement.society;

import com.draazy.api.catalog.society.Society;
import com.draazy.api.catalog.society.SocietyRepository;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.NotFoundException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The society hub's community tab: tips, trusted picks, photos, helpful votes and replies.
 *
 * <p><strong>What was actually broken.</strong> All of it lived in {@code dzSocietyContributions} in
 * the author's own browser, so the "community" tab showed every visitor a community of one. The
 * single most useful thing on the page — a neighbour's number for an electrician who actually turns
 * up — was known only to the person who already had it, and a photo of the place as it really looks
 * was invisible on the photographer's own phone, because it was base64 in one device's
 * {@code localStorage}.
 *
 * <p><strong>Why contributing is not resident-gated, when posting a notice is.</strong> Somebody
 * who lived here for six years and moved out last month is exactly the person whose tip is worth
 * reading, and they lose their verified badge the moment the register is updated. So residency is
 * published on the card rather than enforced in front of it. A noticeboard item is the opposite
 * case — it asserts something about the building rather than reporting an experience of it — and
 * {@link SocietyCommunityService} gates that accordingly.
 *
 * <p><strong>A vote is a row, not a counter.</strong> "One helpful per person" is a fact the
 * primary key keeps rather than a rule this class tries to; see {@link SocietyContributionHelpful}.
 * The two vote endpoints are {@code PUT} and {@code DELETE} rather than one toggle, because a
 * toggle retried on a flaky connection undoes itself and the caller cannot tell.
 */
@Service
public class SocietyContributionService {

    private final SocietyContributionRepository contributions;
    private final SocietyContributionReplyRepository replies;
    private final SocietyContributionHelpfulRepository helpful;
    private final SocietyClaimRepository claims;
    private final SocietyRepository societies;
    private final SocietyAuthors authors;

    public SocietyContributionService(SocietyContributionRepository contributions,
            SocietyContributionReplyRepository replies,
            SocietyContributionHelpfulRepository helpful, SocietyClaimRepository claims,
            SocietyRepository societies, SocietyAuthors authors) {
        this.contributions = contributions;
        this.replies = replies;
        this.helpful = helpful;
        this.claims = claims;
        this.societies = societies;
        this.authors = authors;
    }

    /**
     * One page of contributions, most-helpful first, every reply attached.
     *
     * <p>Unfiltered by kind on purpose. The tab's filter chips carry a count for every bucket
     * including the ones you are not looking at, so a filtered read could not draw the page anyway;
     * fetching the list and the counts separately would be two answers free to disagree.
     *
     * @param viewerId null for a signed-out reader, who gets {@code helpfulByMe: false},
     *     {@code canRemove: false} and no referral phone numbers
     */
    @Transactional(readOnly = true)
    public Page<SocietyContributionResponse> list(String slug, UUID viewerId, boolean staff,
            Pageable pageable) {
        Society society = society(slug);
        Page<SocietyContribution> page = contributions.contributionsFor(society.getId(), pageable);
        if (page.isEmpty()) {
            // `repliesFor` and the vote aggregates are all `in :ids`; an empty IN list is invalid
            // SQL rather than an empty result.
            return Page.empty(pageable);
        }

        List<UUID> ids = page.getContent().stream().map(SocietyContribution::getId).toList();
        List<SocietyContributionReply> allReplies = contributions.repliesFor(ids);

        List<UUID> authorIds = new ArrayList<>(
                page.getContent().stream().map(SocietyContribution::getAuthorId).toList());
        allReplies.forEach(r -> authorIds.add(r.getAuthorId()));
        SocietyAuthors.Directory directory = authors.of(society.getId(), authorIds);

        Map<UUID, Long> counts = countsOf(ids);
        Set<UUID> mine = viewerId == null ? Set.of() : helpful.votedBy(viewerId, ids);
        boolean committee = isCommittee(society.getId(), viewerId);

        Map<UUID, List<SocietyContributionReplyResponse>> repliesByParent = allReplies.stream()
                .collect(Collectors.groupingBy(SocietyContributionReply::getContributionId,
                        LinkedHashMap::new,
                        Collectors.mapping(r -> toResponse(r, directory,
                                mayRemove(r.getAuthorId(), viewerId, committee, staff)),
                                Collectors.toList())));

        return page.map(c -> toResponse(c, slug, directory,
                counts.getOrDefault(c.getId(), 0L), mine.contains(c.getId()),
                mayRemove(c.getAuthorId(), viewerId, committee, staff),
                viewerId != null,
                repliesByParent.getOrDefault(c.getId(), List.of())));
    }

    /** Post a tip, a pick or a photo. Any signed-in caller. */
    @Transactional
    public SocietyContributionResponse add(String slug, UUID authorId,
            SocietyContributionRequest request) {
        Society society = society(slug);
        String kind = blankToNull(request.kind());
        if (!SocietyContributionKinds.isValid(kind)) {
            throw new BadRequestException(
                    "A contribution is a tip, a pick or a photo.");
        }

        String body = blankToNull(request.body());
        String referralName = blankToNull(request.referralName());
        String referralContact = blankToNull(request.referralContact());
        String photoUrl = blankToNull(request.photoUrl());

        // Each kind's own minimum. An empty card is worse than no card: it takes up the space a
        // real contribution would have and tells the reader nothing.
        switch (kind) {
            case SocietyContributionKinds.TIP -> {
                if (body == null) {
                    throw new BadRequestException("Write your tip first.");
                }
                // A tip has no person attached, so anything that arrived in those fields is
                // somebody's phone number on a row no screen will ever show it on, or offer to
                // delete it from. Dropped rather than refused: the composer does not draw them for
                // this kind, so a 400 would point at a field the author cannot see.
                referralName = null;
                referralContact = null;
                photoUrl = null;
            }
            case SocietyContributionKinds.PICK -> {
                if (referralName == null) {
                    throw new BadRequestException("Add the person or service name.");
                }
                photoUrl = null;
            }
            case SocietyContributionKinds.PHOTO -> {
                if (photoUrl == null) {
                    throw new BadRequestException("Add a photo to share.");
                }
                referralName = null;
                referralContact = null;
            }
            default -> throw new BadRequestException("A contribution is a tip, a pick or a photo.");
        }

        SocietyContribution saved = contributions.save(new SocietyContribution(society.getId(),
                authorId, kind, blankToNull(request.category()), body, referralName,
                referralContact, photoUrl));

        SocietyAuthors.Directory directory = authors.of(society.getId(), List.of(authorId));
        return toResponse(saved, slug, directory, 0L, false, true, true, List.of());
    }

    /**
     * Take a contribution down.
     *
     * <p>The author, the committee, or platform staff. A neighbour — equally verified, equally
     * resident — may not: residency buys the right to contribute, not the right to moderate.
     */
    @Transactional
    public void remove(String slug, UUID contributionId, UUID viewerId, boolean staff) {
        Society society = society(slug);
        SocietyContribution row = contribution(society, contributionId);
        if (!mayRemove(row.getAuthorId(), viewerId, isCommittee(society.getId(), viewerId), staff)) {
            throw new ForbiddenException("You can only remove your own contribution.");
        }
        // Votes and replies cascade in the database — a thread under a removed tip answers a
        // question the reader cannot see.
        contributions.delete(row);
    }

    /**
     * Mark or unmark a contribution as helpful, idempotently.
     *
     * <p>Two verbs rather than one toggle. A toggle is not idempotent, so a request retried after a
     * timeout on a train silently undoes the vote it just cast, and neither the caller nor the
     * server can tell the difference between that and a deliberate second tap.
     */
    @Transactional
    public SocietyHelpfulResponse setHelpful(String slug, UUID contributionId, UUID viewerId,
            boolean value) {
        Society society = society(slug);
        SocietyContribution row = contribution(society, contributionId);
        SocietyContributionHelpful.Id id =
                new SocietyContributionHelpful.Id(row.getId(), viewerId);
        if (value) {
            if (!helpful.existsById(id)) {
                helpful.save(new SocietyContributionHelpful(row.getId(), viewerId));
            }
        } else {
            helpful.deleteById(id);
        }
        return new SocietyHelpfulResponse(helpful.countByIdContributionId(row.getId()), value);
    }

    /** Reply in the thread under a contribution. Any signed-in caller. */
    @Transactional
    public SocietyContributionReplyResponse reply(String slug, UUID contributionId, UUID authorId,
            SocietyPostRequest request) {
        Society society = society(slug);
        SocietyContribution parent = contribution(society, contributionId);
        String body = blankToNull(request.body());
        if (body == null) {
            throw new BadRequestException("Write something first.");
        }
        SocietyContributionReply saved =
                replies.save(new SocietyContributionReply(parent.getId(), authorId, body));
        return toResponse(saved, authors.of(society.getId(), List.of(authorId)), true);
    }

    /**
     * Remove one reply.
     *
     * <p>Its own author, the committee, or staff — deliberately not the author of the contribution
     * it sits under. Owning a tip does not make you the moderator of the conversation about it.
     */
    @Transactional
    public void removeReply(String slug, UUID contributionId, UUID replyId, UUID viewerId,
            boolean staff) {
        Society society = society(slug);
        SocietyContribution parent = contribution(society, contributionId);
        SocietyContributionReply reply = replies.findById(replyId)
                .filter(r -> r.getContributionId().equals(parent.getId()))
                .orElseThrow(() -> new NotFoundException("Reply not found."));
        if (!mayRemove(reply.getAuthorId(), viewerId, isCommittee(society.getId(), viewerId), staff)) {
            throw new ForbiddenException("You can only remove your own reply.");
        }
        replies.delete(reply);
    }

    /* -------------------------------------------------------------- internals */

    private Society society(String slug) {
        return societies.findBySlug(slug)
                .orElseThrow(() -> new NotFoundException("Society not found."));
    }

    /**
     * The contribution, re-checked against the society in the path.
     *
     * <p>Without this a card could be deleted, voted on or replied to through another society's
     * URL, where the result would be invisible — the hub only ever reads a society's own list.
     */
    private SocietyContribution contribution(Society society, UUID contributionId) {
        return contributions.findById(contributionId)
                .filter(c -> c.getSocietyId().equals(society.getId()))
                .orElseThrow(() -> new NotFoundException("Contribution not found."));
    }

    /** The approved claimant of this society, and nobody else — see {@link SocietyClaim}. */
    private boolean isCommittee(UUID societyId, UUID viewerId) {
        return viewerId != null && claims.findLiveClaim(societyId)
                .filter(SocietyClaim::isApproved)
                .map(c -> c.getClaimedBy().equals(viewerId))
                .orElse(false);
    }

    private static boolean mayRemove(UUID authorId, UUID viewerId, boolean committee,
            boolean staff) {
        return viewerId != null && (staff || committee || authorId.equals(viewerId));
    }

    private Map<UUID, Long> countsOf(List<UUID> ids) {
        Map<UUID, Long> counts = new HashMap<>();
        for (Object[] row : helpful.countsFor(ids)) {
            counts.put((UUID) row[0], ((Number) row[1]).longValue());
        }
        return counts;
    }

    private static String blankToNull(String s) {
        if (s == null) {
            return null;
        }
        String trimmed = s.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static SocietyContributionResponse toResponse(SocietyContribution c, String slug,
            SocietyAuthors.Directory directory, long helpfulCount, boolean helpfulByMe,
            boolean canRemove, boolean signedIn,
            List<SocietyContributionReplyResponse> replies) {
        return new SocietyContributionResponse(c.getId(), slug, c.getKind(), c.getCategory(),
                c.getBody(), c.getReferralName(),
                // The recommended person never agreed to appear on the open web. A sign-in wall
                // costs a genuine neighbour one tap and costs bulk harvesting the whole exercise.
                signedIn ? c.getReferralContact() : null,
                c.getPhotoUrl(), directory.name(c.getAuthorId()),
                directory.isResident(c.getAuthorId()), helpfulCount, helpfulByMe, canRemove,
                c.getCreatedAt(), replies);
    }

    private static SocietyContributionReplyResponse toResponse(SocietyContributionReply r,
            SocietyAuthors.Directory directory, boolean canRemove) {
        return new SocietyContributionReplyResponse(r.getId(), r.getContributionId(),
                directory.name(r.getAuthorId()), directory.isResident(r.getAuthorId()), r.getBody(),
                canRemove, r.getCreatedAt());
    }
}
