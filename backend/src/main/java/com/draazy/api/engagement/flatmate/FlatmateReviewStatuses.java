package com.draazy.api.engagement.flatmate;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

/**
 * The Ops verification verdict for a window of cards, batched — the join behind the host trust
 * badges.
 *
 * <p><strong>What the verdict is for.</strong> A tenant-tier host claims to hold the flat; the claim
 * is backed by a rent agreement they upload, and it is worth nothing until Ops has looked at it. So
 * the badge on a tenant-tier card is not a property of the card — it is the state of a review in
 * another table. Three states reach the board: no row at all (nothing was ever submitted),
 * {@code pending} (submitted, undecided — the card says so and withholds the badge), and
 * {@code approved} / {@code rejected}.
 *
 * <p><strong>Why the browser cannot answer this.</strong> It used to. {@code useFlatmates.jsx}
 * built the same map from {@code localStorage}, which meant the verdict existed only on the machine
 * that happened to have run the Ops desk — every other visitor saw an empty map, so an approved
 * host's badge never appeared and {@code hostVerifiedFor} could never return true for the tenant
 * tier. That is the defect {@link FlatmateGroupRepository#feed} was written around: its
 * {@code verifiedOnly} clause deliberately omitted the tenant branch, because reproducing a branch
 * the board could not reach would have made the server and the board disagree. With the verdict on
 * the wire both halves can finally say the same thing, and that clause is now whole.
 *
 * <p><strong>One read per window, and one owner for the reduction.</strong> Three producers render
 * these cards — {@code GET /flatmates/groups}, {@code GET /flatmates/rooms} and the mixed
 * {@code GET /flatmates/feed} — for the same reason {@link FlatmateRoomCards} exists: a fact that
 * three callers each derive their own way is a fact with three definitions.
 */
@Component
class FlatmateReviewStatuses {

    private final FlatmateReviewRepository reviews;

    FlatmateReviewStatuses(FlatmateReviewRepository reviews) {
        this.reviews = reviews;
    }

    /** Verdict per group id. Groups with no review are absent, not mapped to a status. */
    Map<UUID, String> forGroups(Collection<FlatmateGroup> window) {
        List<UUID> ids = idsOf(window, FlatmateGroup::getId);
        if (ids.isEmpty()) {
            return Map.of();
        }
        return statuses(reviews.findByGroupIdIn(ids), FlatmateReview::getGroupId);
    }

    /** Verdict per room id — see {@link #forGroups}. */
    Map<UUID, String> forRooms(Collection<FlatmateRoom> window) {
        List<UUID> ids = idsOf(window, FlatmateRoom::getId);
        if (ids.isEmpty()) {
            return Map.of();
        }
        return statuses(reviews.findByRoomIdIn(ids), FlatmateReview::getRoomId);
    }

    private static <T> List<UUID> idsOf(Collection<T> window, java.util.function.Function<T, UUID> id) {
        return window.stream().map(id).filter(Objects::nonNull).distinct().toList();
    }

    /**
     * Reviews → a status per subject id.
     *
     * <p>A subject holds at most one review — {@code findByGroupId} and {@code findByRoomId} both
     * answer {@link java.util.Optional}, which is the schema's own statement of that. The merge
     * function is therefore unreachable rather than a policy; it keeps the first so that a
     * constraint violation degrades to a stale badge instead of throwing on a public read.
     */
    private static Map<UUID, String> statuses(
            List<FlatmateReview> rows, java.util.function.Function<FlatmateReview, UUID> subject) {
        return rows.stream()
                .filter(review -> subject.apply(review) != null && review.getStatus() != null)
                .collect(Collectors.toMap(subject, FlatmateReview::getStatus, (first, duplicate) -> first));
    }
}
