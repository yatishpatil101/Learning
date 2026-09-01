package com.punenest.api.engagement.flatmate;

import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.stereotype.Component;

/**
 * Room rows → room cards, with the two joins a card needs batched (D212).
 *
 * <p><strong>Why this is a class and not three lines in a service.</strong> A card is not a room:
 * it needs the host's display name, which lives in another table, and the flat's occupancy ledger,
 * which is a sum over sibling rows. Three producers render the same card —
 * {@code GET /flatmates/rooms}, {@code GET /flatmates/feed} and
 * {@code GET /properties/&#123;id&#125;/rooms} — and each of them had its own answer to "what is
 * {@code flatCommitted} here?". Two said "count the flat"; the third, the mixed feed, said
 * {@code 0}, because {@code RoomView.anonymous} took only a name. That is how a full flat came to
 * report {@code empty} on one endpoint and {@code occupied} on another from the same row: the
 * derivation was correct in the mapper all along, and it was the <em>input</em> that had three
 * definitions. Giving it one owner is the fix; putting that owner next to one of the three callers
 * would just have made it two.
 *
 * <p><strong>Two queries per page, never 2N.</strong> The host names and the ledgers are each
 * resolved in a single batched read for the whole window. Per-row lookups were not only N+1 — each
 * row would build its ledger from a separate snapshot, so two cards of the same flat could disagree
 * with each other within one response.
 */
@Component
class FlatmateRoomCards {

    private final FlatmateRoomRepository rooms;
    private final UserRepository users;
    private final FlatmateMapper mapper;
    /** The Ops verdict behind the tier badge, batched across the window. */
    private final FlatmateReviewStatuses reviewStatuses;

    FlatmateRoomCards(FlatmateRoomRepository rooms, UserRepository users, FlatmateMapper mapper,
            FlatmateReviewStatuses reviewStatuses) {
        this.rooms = rooms;
        this.users = users;
        this.mapper = mapper;
        this.reviewStatuses = reviewStatuses;
    }

    /** A page of rooms as a page of cards, preserving the paging metadata the query produced. */
    Page<FlatmateRoomFeedDto> render(Page<FlatmateRoom> page) {
        return new PageImpl<>(render(page.getContent()), page.getPageable(), page.getTotalElements());
    }

    /** A list of rooms as a list of cards, in the order given. */
    List<FlatmateRoomFeedDto> render(List<FlatmateRoom> window) {
        Map<UUID, FlatmateMapper.RoomView> views = anonymousViews(window, hostNames(window));
        return window.stream()
                .map(room -> mapper.toFeedDto(room, views.get(room.getId())))
                .toList();
    }

    /**
     * The anonymous view of every room in a window, keyed by room id.
     *
     * <p>Separate from {@link #render(List)} for the mixed feed, which interleaves rooms with groups
     * and seeker posts and so cannot hand its window over wholesale. It has already batched host
     * names across all three kinds, so it passes that map in rather than paying for a second read of
     * the same rows.
     */
    Map<UUID, FlatmateMapper.RoomView> anonymousViews(
            Collection<FlatmateRoom> window, Map<UUID, String> hostNames) {
        Map<UUID, Integer> ledger = committedByFlat(window);
        Map<UUID, String> verdicts = reviewStatuses.forRooms(window);
        return window.stream().collect(Collectors.toMap(
                FlatmateRoom::getId,
                room -> FlatmateMapper.RoomView.anonymous(
                        committedFor(room, ledger), hostNames.get(room.getHostId()),
                        verdicts.get(room.getId())),
                (first, duplicate) -> first));
    }

    /**
     * The <em>host's own</em> view of a window of their rooms, keyed by room id — name and number
     * both present, because it is their number on rows they posted.
     *
     * <p>Here rather than in the calling service so that {@code flatCommitted} keeps having exactly
     * one definition. That is the whole reason this class exists: {@code GET /me/flatmate-rooms}
     * became the fourth producer of a room payload, and a fourth answer to "how many people are in
     * this flat?" is how a host would come to see {@code occupied} on their dashboard and
     * {@code empty} on the public feed for the same room. The ledger is batched for the window, so
     * a host with six rooms across two flats still pays one read.
     *
     * <p>The owner name and number are passed in rather than looked up per row: every room in this
     * window has the same host by construction — the caller — so a per-row lookup would be N reads
     * of one user.
     */
    Map<UUID, FlatmateMapper.RoomView> ownerViews(
            Collection<FlatmateRoom> window, String ownerName, String ownerMobile) {
        Map<UUID, Integer> ledger = committedByFlat(window);
        /* The host's own dashboard carries the Ops verdict too. Withholding it from the one person
           who acted on it would be the wrong way round: a missing badge and a badge that is still
           being decided look identical, and only the host can do anything about either. */
        Map<UUID, String> verdicts = reviewStatuses.forRooms(window);
        return window.stream().collect(Collectors.toMap(
                FlatmateRoom::getId,
                room -> new FlatmateMapper.RoomView(
                        committedFor(room, ledger), ownerName, ownerMobile,
                        verdicts.get(room.getId())),
                (first, duplicate) -> first));
    }

    /**
     * People living across every sibling room of this room's flat.
     *
     * <p>Deliberately the same rule as {@code FlatmateSupplyService.committedInFlat}, which answers
     * the host's own view of the same room: a standalone room is not part of a flat, so its own
     * occupants are the whole ledger. One row must not get two answers depending on who asked.
     */
    private static int committedFor(FlatmateRoom room, Map<UUID, Integer> ledger) {
        if (!room.isSplitRoom()) {
            return room.getOccupants();
        }
        return ledger.getOrDefault(room.getPropertyId(), room.getOccupants());
    }

    private Map<UUID, Integer> committedByFlat(Collection<FlatmateRoom> window) {
        List<UUID> flats = window.stream()
                .map(FlatmateRoom::getPropertyId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        if (flats.isEmpty()) {
            return Map.of();
        }
        Map<UUID, Integer> ledger = new HashMap<>();
        for (Object[] row : rooms.committedByFlat(flats)) {
            ledger.put((UUID) row[0], ((Number) row[1]).intValue());
        }
        return ledger;
    }

    /**
     * Host display names for a window, in one read.
     *
     * <p>A nameless host is dropped rather than mapped to null: an OTP account carries no name until
     * its profile is filled in (D118), and the card renders its own placeholder for an absent owner.
     */
    private Map<UUID, String> hostNames(Collection<FlatmateRoom> window) {
        List<UUID> hostIds = window.stream()
                .map(FlatmateRoom::getHostId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        return users.findAllById(hostIds).stream()
                .filter(user -> user.getName() != null)
                .collect(Collectors.toMap(User::getId, User::getName));
    }
}
