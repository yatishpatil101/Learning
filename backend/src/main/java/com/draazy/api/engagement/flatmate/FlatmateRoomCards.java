package com.draazy.api.engagement.flatmate;

import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

/** Room cards need host names and flat-level occupancy, not just room columns. */
@Component
class FlatmateRoomCards {

    private final FlatmateRoomRepository rooms;
    private final UserRepository users;
    private final FlatmateMapper mapper;

    private final FlatmateReviewStatuses reviewStatuses;

    FlatmateRoomCards(FlatmateRoomRepository rooms, UserRepository users, FlatmateMapper mapper,
            FlatmateReviewStatuses reviewStatuses) {
        this.rooms = rooms;
        this.users = users;
        this.mapper = mapper;
        this.reviewStatuses = reviewStatuses;
    }

    /** A list of rooms as a list of cards, in the order given. */
    List<FlatmateRoomFeedDto> render(List<FlatmateRoom> window) {
        Map<UUID, FlatmateMapper.RoomView> views = anonymousViews(window, hostNames(window));
        return window.stream()
                .map(room -> mapper.toFeedDto(room, views.get(room.getId())))
                .toList();
    }

    /** Mixed feed passes already-batched host names to avoid reading the same users twice. */
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

    /** Host view may include the host's own name and number on rows they posted. */
    Map<UUID, FlatmateMapper.RoomView> ownerViews(
            Collection<FlatmateRoom> window, String ownerName, String ownerMobile) {
        Map<UUID, Integer> ledger = committedByFlat(window);

        /** Host sees review verdicts because only they can act on pending or missing badges. */
        Map<UUID, String> verdicts = reviewStatuses.forRooms(window);
        return window.stream().collect(Collectors.toMap(
                FlatmateRoom::getId,
                room -> new FlatmateMapper.RoomView(
                        committedFor(room, ledger), ownerName, ownerMobile,
                        verdicts.get(room.getId())),
                (first, duplicate) -> first));
    }

    /** The host's own list: no names, no review lookup — the card carries neither. */
    List<FlatmateRoomCard> ownerCards(List<FlatmateRoom> window) {
        Map<UUID, Integer> ledger = committedByFlat(window);
        return window.stream().map(room -> new FlatmateRoomCard(
                room.getId(), room.getTitle(), room.getPropertyId(), room.getSociety(),
                room.getFlatType(), room.getLocality(), room.getLocalities(), room.getBudget(),
                mapper.shareMax(room, committedFor(room, ledger)), room.getOccupants(),
                mapper.coverOf(room), room.getModStatus(), room.getStatus(), room.getCreatedAt()))
                .toList();
    }

    /** Same occupancy rule for public and host views so one room never has two counts. */
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

    /** Drop nameless OTP hosts so the card can render its absent-owner placeholder. */
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
