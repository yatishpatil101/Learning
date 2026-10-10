package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** The save stores the key only and the card is joined on read, so a shortlist never shows stale rent or a
 * withdrawn room; rows are anonymous because shortlisting is not an introduction. */
@Service
public class FlatmateSaveService {

    /** The three tables a save may point at, as they are spelled in the path and the check constraint. */
    static final String KIND_ROOM = "room";
    static final String KIND_GROUP = "group";
    static final String KIND_POST = "post";
    private static final Set<String> KINDS = Set.of(KIND_ROOM, KIND_GROUP, KIND_POST);

    private final FlatmateSaveRepository saves;
    private final FlatmateRoomRepository rooms;
    private final FlatmateGroupRepository groups;
    private final FlatmateSeekerPostRepository posts;
    private final FlatmateMapper mapper;
    private final FlatmateRoomCards cards;
    private final FlatmateReviewStatuses reviewStatuses;
    private final UserRepository users;

    public FlatmateSaveService(FlatmateSaveRepository saves, FlatmateRoomRepository rooms,
            FlatmateGroupRepository groups, FlatmateSeekerPostRepository posts, FlatmateMapper mapper,
            FlatmateRoomCards cards, FlatmateReviewStatuses reviewStatuses, UserRepository users) {
        this.saves = saves;
        this.rooms = rooms;
        this.groups = groups;
        this.posts = posts;
        this.mapper = mapper;
        this.cards = cards;
        this.reviewStatuses = reviewStatuses;
        this.users = users;
    }

    /** Saved order is restored because {@code findAllById} does not guarantee it; a save whose target is gone
     * drops from content but still counts in {@code totalElements}. */
    @Transactional(readOnly = true)
    public Page<Object> listSaved(UUID userId, Pageable pageable) {
        Page<FlatmateSaveRepository.SaveRow> page = saves.findSaves(userId, pageable);
        if (page.isEmpty()) {
            return new PageImpl<>(List.of(), page.getPageable(), page.getTotalElements());
        }
        List<Object> content = render(page.getContent());
        return new PageImpl<>(content, page.getPageable(), page.getTotalElements());
    }

    /** Keys rather than cards: the board already holds the cards and only asks a yes/no question about each. */
    @Transactional(readOnly = true)
    public List<FlatmateSaveKeyDto> listKeys(UUID userId) {
        return saves.findAllSaves(userId).stream()
                .map(row -> new FlatmateSaveKeyDto(row.getKind(), row.getPostId()))
                .toList();
    }

    /** Existence is checked first: {@code post_id} has no foreign key, so a typo would be stored and
     * reappear forever as a row that renders nothing. */
    @Transactional
    public void save(UUID userId, String kind, UUID postId) {
        String resolved = requireKind(kind);
        if (!exists(resolved, postId)) {
            throw NotFoundException.of(label(resolved));
        }
        saves.insertIfAbsent(userId, resolved, postId);
    }

    /** Idempotently un-shortlist. 204 whether or not a row existed. */
    @Transactional
    public void unsave(UUID userId, String kind, UUID postId) {
        saves.delete(userId, requireKind(kind), postId);
    }

    /* ─── internals ────────────────────────────────────────────────────────────────────────── */

    private static String requireKind(String kind) {
        String resolved = kind == null ? "" : kind.trim().toLowerCase(java.util.Locale.ROOT);
        if (!KINDS.contains(resolved)) {
            /* BadRequest rather than Validation: {@code kind} is a contract path enum, so a value outside it
               makes the request malformed in itself. */
            throw new BadRequestException("kind must be one of room, group, post");
        }
        return resolved;
    }

    private static String label(String kind) {
        return switch (kind) {
            case KIND_ROOM -> "Room";
            case KIND_GROUP -> "Group";
            default -> "Post";
        };
    }

    /** Uses {@code archived}, not {@code isVisible()}: a post in a re-moderation window should stay shortlisted,
     * a withdrawn one should not. */
    private boolean exists(String kind, UUID postId) {
        return switch (kind) {
            case KIND_ROOM -> rooms.findById(postId).filter(row -> !row.isArchived()).isPresent();
            case KIND_GROUP -> groups.findById(postId).filter(row -> !row.isArchived()).isPresent();
            default -> posts.findById(postId).filter(row -> !row.isArchived()).isPresent();
        };
    }

    /** Room cards go through {@link FlatmateRoomCards} so {@code flatCommitted} has exactly one definition. */
    private List<Object> render(List<FlatmateSaveRepository.SaveRow> window) {
        Map<UUID, FlatmateRoom> roomById = byId(
                live(rooms.findAllById(idsOf(window, KIND_ROOM)), FlatmateRoom::isArchived),
                FlatmateRoom::getId);
        Map<UUID, FlatmateGroup> groupById = byId(
                live(groups.findAllById(idsOf(window, KIND_GROUP)), FlatmateGroup::isArchived),
                FlatmateGroup::getId);
        Map<UUID, FlatmateSeekerPost> postById = byId(
                live(posts.findAllById(idsOf(window, KIND_POST)), FlatmateSeekerPost::isArchived),
                FlatmateSeekerPost::getId);

        List<UUID> hostIds = java.util.stream.Stream.of(
                        roomById.values().stream().map(FlatmateRoom::getHostId),
                        groupById.values().stream().map(FlatmateGroup::getHostId),
                        postById.values().stream().map(FlatmateSeekerPost::getUserId))
                .flatMap(Function.identity())
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        Map<UUID, String> names = users.findAllById(hostIds).stream()
                .filter(user -> user.getName() != null)
                .collect(Collectors.toMap(User::getId, User::getName));

        Map<UUID, FlatmateMapper.RoomView> roomViews = cards.anonymousViews(roomById.values(), names);
        Map<UUID, String> verdicts = reviewStatuses.forGroups(groupById.values());

        return window.stream()
                .map(row -> card(row, roomById, groupById, postById, roomViews, names, verdicts))
                .filter(Objects::nonNull)
                .toList();
    }

    private Object card(FlatmateSaveRepository.SaveRow row, Map<UUID, FlatmateRoom> roomById,
            Map<UUID, FlatmateGroup> groupById, Map<UUID, FlatmateSeekerPost> postById,
            Map<UUID, FlatmateMapper.RoomView> roomViews, Map<UUID, String> names,
            Map<UUID, String> verdicts) {
        UUID id = row.getPostId();
        return switch (row.getKind()) {
            case KIND_ROOM -> {
                FlatmateRoom room = roomById.get(id);
                yield room == null ? null : mapper.toFeedDto(room, roomViews.get(id));
            }
            case KIND_GROUP -> {
                FlatmateGroup group = groupById.get(id);
                yield group == null ? null : mapper.toFeedDto(group,
                        FlatmateMapper.PartyView.anonymous(names.get(group.getHostId()), verdicts.get(id)));
            }
            default -> {
                FlatmateSeekerPost post = postById.get(id);
                yield post == null ? null : mapper.toFeedDto(post);
            }
        };
    }

    private static List<UUID> idsOf(List<FlatmateSaveRepository.SaveRow> window, String kind) {
        return window.stream()
                .filter(row -> kind.equals(row.getKind()))
                .map(FlatmateSaveRepository.SaveRow::getPostId)
                .distinct()
                .toList();
    }

    private static <T> Map<UUID, T> byId(List<T> rows, Function<T, UUID> key) {
        return rows.stream().collect(Collectors.toMap(key, Function.identity(),
                (first, duplicate) -> first));
    }

    /** Withdrawn rows leave {@code content} but not {@code totalElements}: a shortlist may be a card short,
     * never a card that renders nothing. */
    private static <T> List<T> live(List<T> rows, java.util.function.Predicate<T> archived) {
        return rows.stream().filter(archived.negate()).toList();
    }
}
