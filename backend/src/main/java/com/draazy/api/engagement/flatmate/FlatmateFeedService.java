package com.draazy.api.engagement.flatmate;

import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The tab-aware mixed feed, keyed on seeker intent rather than our storage model. Why the database
 * sorts, counts and pages it rather than an in-memory merge: docs/flows/consumer/flatmates.md §5.
 */
@Service
public class FlatmateFeedService {

    private final FlatmateSeekerPostRepository posts;
    private final FlatmateRoomRepository rooms;
    private final FlatmateGroupRepository groups;
    private final FlatmateSearchQueries search;
    private final FlatmateMapper mapper;
    private final UserRepository users;
    /** The room card's own joins — host name and flat ledger — batched across the window. */
    private final FlatmateRoomCards cards;
    /** The Ops verdict behind a group's tier badge, batched across the window. */
    private final FlatmateReviewStatuses reviewStatuses;

    public FlatmateFeedService(FlatmateSeekerPostRepository posts, FlatmateRoomRepository rooms,
            FlatmateGroupRepository groups, FlatmateSearchQueries search, FlatmateMapper mapper,
            UserRepository users, FlatmateRoomCards cards, FlatmateReviewStatuses reviewStatuses) {
        this.posts = posts;
        this.rooms = rooms;
        this.groups = groups;
        this.search = search;
        this.mapper = mapper;
        this.users = users;
        this.cards = cards;
        this.reviewStatuses = reviewStatuses;
    }

    /**
     * A page of the board plus {@code verifiedTotal} across every match — once the server pages,
     * the browser cannot see enough rows to compute it.
     */
    public record FeedResult(Page<Object> page, long verifiedTotal) {
    }

    /** {@code GET /flatmates/feed} — public. One feed per tab, sorted newest first. */
    @Transactional(readOnly = true)
    public FeedResult feed(FlatmateSearchQuery facets, Pageable pageable) {
        FlatmateSearchQueries.Result result = search.search(facets, pageable);
        List<Object> window = load(result.refs());
        return new FeedResult(
                new PageImpl<>(render(window), pageable, result.total()), result.verifiedTotal());
    }

    /**
     * Turn the union's {@code (kind, id)} window back into entities. One read per supply type, with
     * the sort re-imposed from the refs: {@code findAllById} makes no promise about order.
     */
    private List<Object> load(List<FlatmateSearchQueries.Ref> refs) {
        Map<UUID, FlatmateRoom> roomsById = index(rooms.findAllById(idsOf(refs, "room")),
                FlatmateRoom::getId);
        Map<UUID, FlatmateGroup> groupsById = index(groups.findAllById(idsOf(refs, "group")),
                FlatmateGroup::getId);
        Map<UUID, FlatmateSeekerPost> postsById = index(posts.findAllById(idsOf(refs, "post")),
                FlatmateSeekerPost::getId);

        return refs.stream()
                .map(ref -> (Object) switch (ref.kind()) {
                    case "room" -> roomsById.get(ref.id());
                    case "group" -> groupsById.get(ref.id());
                    default -> postsById.get(ref.id());
                })
                .filter(java.util.Objects::nonNull)
                .toList();
    }

    private static List<UUID> idsOf(List<FlatmateSearchQueries.Ref> refs, String kind) {
        return refs.stream()
                .filter(ref -> kind.equals(ref.kind()))
                .map(FlatmateSearchQueries.Ref::id)
                .toList();
    }

    private static <T> Map<UUID, T> index(List<T> rows, java.util.function.Function<T, UUID> key) {
        return rows.stream().collect(Collectors.toMap(key, row -> row));
    }

    /**
     * Map the merged window to wire DTOs. Host names and room-card joins are batched across the
     * window; hardcoding occupancy would price a full flat differently on two feeds from one row.
     */
    private List<Object> render(List<Object> window) {
        List<UUID> hostIds = window.stream()
                .map(FlatmateFeedService::hostIdOf)
                .filter(java.util.Objects::nonNull)
                .distinct()
                .toList();
        Map<UUID, String> names = users.findAllById(hostIds).stream()
                .filter(user -> user.getName() != null)
                .collect(Collectors.toMap(User::getId, User::getName));
        Map<UUID, FlatmateMapper.RoomView> roomViews = cards.anonymousViews(
                window.stream()
                        .filter(FlatmateRoom.class::isInstance)
                        .map(FlatmateRoom.class::cast)
                        .toList(),
                names);
        Map<UUID, String> groupVerdicts = reviewStatuses.forGroups(window.stream()
                .filter(FlatmateGroup.class::isInstance)
                .map(FlatmateGroup.class::cast)
                .toList());

        return window.stream().map(source -> switch (source) {
            case FlatmateRoom r -> (Object) mapper.toFeedDto(r, roomViews.get(r.getId()));
            case FlatmateGroup g -> (Object) mapper.toFeedDto(g,
                    FlatmateMapper.PartyView.anonymous(
                            names.get(g.getHostId()), groupVerdicts.get(g.getId())));
            case FlatmateSeekerPost p -> (Object) mapper.toDto(p,
                    FlatmateMapper.SeekerView.ANONYMOUS);
            default -> throw new IllegalStateException("Unmappable feed entry: " + source.getClass());
        }).toList();
    }

    private static UUID hostIdOf(Object source) {
        return switch (source) {
            case FlatmateRoom r -> r.getHostId();
            case FlatmateGroup g -> g.getHostId();
            case FlatmateSeekerPost p -> p.getUserId();
            default -> null;
        };
    }
}
