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

/**
 * The caller's flatmate shortlist — the three-table sibling of {@code SavedPropertyService}.
 *
 * <p><strong>Why the projection is rebuilt rather than stored.</strong> Until this existed the
 * shortlist lived in {@code draazyFlatmateSaved}, and it stored the card as well as the key: the
 * title, locality, price and photo were copied into localStorage at the moment of the tap. That made
 * the Saved page cheap to render and permanently capable of lying — a room whose rent changed, or
 * whose host took it down, went on showing the numbers it had when it was saved. Here the save is
 * the key alone and the card is joined on read, so the shortlist can be wrong about what exists but
 * never about what it says.
 *
 * <p><strong>The rows are anonymous, deliberately.</strong> A shortlist is a browsing aid, and these
 * cards are the same cards the public feed renders — so the host's number is masked here exactly as
 * it is there. Shortlisting somebody is not a way to be introduced to them; the interest flow is.
 */
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

    /**
     * The caller's shortlist as full cards, newest save first, paged.
     *
     * <p>Four queries at most whatever the page holds: the save rows, then one batch fetch per kind
     * present. Saved order is restored afterwards because {@code findAllById} does not guarantee it.
     *
     * <p>A save whose target has since been deleted drops out of the content while
     * {@code totalElements} still counts the save row — the same contract {@code SavedPropertyService}
     * states, and for the same reason: the alternative is a page with holes in it. The stale row is
     * left in place rather than cleaned up here, because a read is not the right place to write and a
     * row that costs nothing is not worth a transaction.
     */
    @Transactional(readOnly = true)
    public Page<Object> listSaved(UUID userId, Pageable pageable) {
        Page<FlatmateSaveRepository.SaveRow> page = saves.findSaves(userId, pageable);
        if (page.isEmpty()) {
            return new PageImpl<>(List.of(), page.getPageable(), page.getTotalElements());
        }
        List<Object> content = render(page.getContent());
        return new PageImpl<>(content, page.getPageable(), page.getTotalElements());
    }

    /**
     * Every key the caller has saved, unpaged — what the flatmates board needs to draw its bookmarks.
     *
     * <p>Keys rather than cards: the board already holds the cards, and it is asking a yes/no
     * question about each one. Returning projections here would re-fetch rows it is currently
     * rendering.
     */
    @Transactional(readOnly = true)
    public List<FlatmateSaveKeyDto> listKeys(UUID userId) {
        return saves.findAllSaves(userId).stream()
                .map(row -> new FlatmateSaveKeyDto(row.getKind(), row.getPostId()))
                .toList();
    }

    /**
     * Idempotently shortlist one post. Existence is checked first: {@code post_id} carries no foreign
     * key (Postgres has no polymorphic reference), so without this a typo would be stored happily and
     * reappear forever as a row that renders nothing.
     *
     * @throws BadRequestException if {@code kind} is not one of the three tables
     * @throws NotFoundException if no live row of that kind has that id
     */
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
            /* BadRequest rather than Validation: the contract declares `kind` as a path enum, so a
               value outside it makes the request malformed in itself rather than wrong for this
               caller — the line `ValidationException`'s own javadoc draws. */
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

    /**
     * Does a live row of this kind exist?
     *
     * <p><strong>{@code archived}, not {@code isVisible()}, deliberately</strong> — the same width
     * {@code FlatmateRoomRepository.findByPropertyIdAndArchivedFalse} documents. A shortlist is the
     * caller's private list rather than a second rendering of the public feed, so a post passing
     * through a re-moderation window should stay on it; a post its host withdrew should not, because
     * there is nothing left to go back to.
     */
    private boolean exists(String kind, UUID postId) {
        return switch (kind) {
            case KIND_ROOM -> rooms.findById(postId).filter(row -> !row.isArchived()).isPresent();
            case KIND_GROUP -> groups.findById(postId).filter(row -> !row.isArchived()).isPresent();
            default -> posts.findById(postId).filter(row -> !row.isArchived()).isPresent();
        };
    }

    /**
     * Turn a page of save keys into a page of cards, in saved order.
     *
     * <p>The three fetches are batched by kind and the host names across all of them, which is the
     * pattern {@code FlatmateFeedService.render} established — a page of twenty cards would otherwise
     * be twenty lookups of a table whose keys are already in hand. The room half then goes through
     * {@link FlatmateRoomCards} so {@code flatCommitted} keeps having exactly one definition: a
     * shortlisted room reporting a different occupancy from the same room on the feed would be the
     * fourth answer to a question that is supposed to have one.
     */
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
                yield post == null ? null : mapper.toDto(post, FlatmateMapper.SeekerView.ANONYMOUS);
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

    /**
     * Drop the rows whose author has since withdrawn them.
     *
     * <p>They fall out of {@code content} but not out of {@code totalElements}, because the save row
     * they came from is still there. That asymmetry is the documented contract of this endpoint and
     * of {@code SavedPropertyService}: a shortlist may be one card shorter than its count, and must
     * never be a card that renders nothing.
     */
    private static <T> List<T> live(List<T> rows, java.util.function.Predicate<T> archived) {
        return rows.stream().filter(archived.negate()).toList();
    }
}
