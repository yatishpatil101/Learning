package com.draazy.api.engagement.flatmate;

import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

/**
 * Turns {@link FlatmateRequest} rows into {@link FlatmateRequestDto}s.
 *
 * <p>A request row holds a kind, a target id, a requester id, a status and two timestamps. Nothing
 * a screen renders — who asked, what they asked about, where it is — is on the row. It is
 * <strong>read</strong> rather than denormalised so that a room renamed after the ask still shows
 * its current name, and so that the requester's number has exactly one source of truth.
 *
 * <p>Its own class, and named after {@link GroupApplicationHydrator} because it is the same job on
 * the neighbouring table: two reads now need it — the host inbox
 * ({@link FlatmateSeekerService#inbox}) and the seeker outbox
 * ({@link FlatmateSeekerService#outbox}) — and they resolve the identical join from opposite ends.
 *
 * <p><strong>All three kinds are resolved, not just seeker posts.</strong> The inbox this join was
 * originally written for is nearly always {@code kind = "flatmate"}, so resolving only that looked
 * complete, and the null title on a room or group row read as "this target is gone" rather than as
 * a gap. The outbox makes the omission obvious — a seeker's own list is mostly rooms — but it was
 * always a latent defect on the inbox too, because a host with a room ad receives {@code kind =
 * "room"} rows and was being shown a nameless one.
 *
 * <p>Batching is the point. One query per <em>kind present on the page</em>, not two per row: an
 * inbox of thirty would otherwise be sixty queries to paint one screen.
 *
 * <p><strong>A missing target is not an error.</strong> A room can be taken down and a post deleted
 * while a request still points at it, and that request is still a true record of something this
 * person did. Those fields come back null rather than throwing, because the row has to remain
 * readable for the person who owns it.
 */
@Component
class FlatmateRequestHydrator {

    private final FlatmateSeekerPostRepository posts;
    private final FlatmateRoomRepository rooms;
    private final FlatmateGroupRepository groups;
    private final UserRepository users;

    FlatmateRequestHydrator(FlatmateSeekerPostRepository posts, FlatmateRoomRepository rooms,
            FlatmateGroupRepository groups, UserRepository users) {
        this.posts = posts;
        this.rooms = rooms;
        this.groups = groups;
        this.users = users;
    }

    /** Fill in the names, titles and numbers a request list renders, batched rather than per row. */
    List<FlatmateRequestDto> hydrate(List<FlatmateRequest> rows) {
        if (rows.isEmpty()) {
            return List.of();
        }
        Map<UUID, User> requesters = users.findAllById(
                        rows.stream().map(FlatmateRequest::getRequesterId).distinct().toList())
                .stream().collect(Collectors.toMap(User::getId, u -> u));
        Map<UUID, FlatmateSeekerPost> byPost = posts.findAllById(targetsOfKind(rows, "flatmate"))
                .stream().collect(Collectors.toMap(FlatmateSeekerPost::getId, p -> p));
        Map<UUID, FlatmateRoom> byRoom = rooms.findAllById(targetsOfKind(rows, "room"))
                .stream().collect(Collectors.toMap(FlatmateRoom::getId, r -> r));
        Map<UUID, FlatmateGroup> byGroup = groups.findAllById(targetsOfKind(rows, "group"))
                .stream().collect(Collectors.toMap(FlatmateGroup::getId, g -> g));

        return rows.stream().map(row -> {
            User requester = requesters.get(row.getRequesterId());
            Target target = switch (row.getKind()) {
                case "room" -> Target.of(byRoom.get(row.getTargetId()));
                case "group" -> Target.of(byGroup.get(row.getTargetId()));
                default -> Target.of(byPost.get(row.getTargetId()));
            };
            return FlatmateRequestDto.of(row,
                    target.title(),
                    target.locality(),
                    requester == null ? null : requester.getName(),
                    requester == null ? null : requester.getMobile());
        }).toList();
    }

    /** One row, for the write path that returns the thing it just created. */
    FlatmateRequestDto hydrateOne(FlatmateRequest row) {
        return hydrate(List.of(row)).getFirst();
    }

    /** The distinct target ids on this page for one kind, so each kind costs one query. */
    private static List<UUID> targetsOfKind(List<FlatmateRequest> rows, String kind) {
        return rows.stream()
                .filter(row -> kind.equals(row.getKind()))
                .map(FlatmateRequest::getTargetId)
                .distinct()
                .toList();
    }

    /**
     * What a request row points at, reduced to the two things the DTO shows.
     *
     * <p>Three unrelated entities answer "what was this about" with differently named fields, and a
     * missing row has to answer it too. Collapsing them here keeps the null handling in one place
     * instead of six ternaries inside the mapping lambda.
     */
    private record Target(String title, String locality) {

        private static final Target MISSING = new Target(null, null);

        static Target of(FlatmateSeekerPost post) {
            if (post == null) {
                return MISSING;
            }
            return new Target(post.getName(),
                    post.getLocalities().isEmpty() ? null : post.getLocalities().getFirst());
        }

        static Target of(FlatmateRoom room) {
            if (room == null) {
                return MISSING;
            }
            // The society is what the seeker was looking at; the room type is the fallback for a
            // post that never named one, which is legal.
            return new Target(
                    FlatmateVocabulary.blankToNull(room.getSociety()) == null
                            ? room.getRoomType() : room.getSociety(),
                    room.getLocality());
        }

        static Target of(FlatmateGroup group) {
            return group == null ? MISSING : new Target(group.getTitle(), group.getLocality());
        }
    }
}
