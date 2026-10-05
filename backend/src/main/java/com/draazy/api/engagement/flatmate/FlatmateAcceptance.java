package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
class FlatmateAcceptance {

    private final FlatmateGroupRepository groups;
    private final FlatmateRoomRepository rooms;
    private final UserRepository users;
    private final FlatmateMembershipService membership;

    FlatmateAcceptance(FlatmateGroupRepository groups, FlatmateRoomRepository rooms,
            UserRepository users, FlatmateMembershipService membership) {
        this.groups = groups;
        this.rooms = rooms;
        this.users = users;
        this.membership = membership;
    }

    void apply(FlatmateRequest request) {
        switch (request.getKind()) {
            case "group" -> joinGroup(request);
            case "room" -> takeRoom(request);
            default -> { }
        }
    }

    private void joinGroup(FlatmateRequest request) {
        FlatmateGroup group = groups.lockLive(request.getTargetId())
                .orElseThrow(() -> NotFoundException.of("Group"));

        int open = group.openSeats();
        if (open <= 0) {
            throw FlatmateConflicts.groupFull("This group is full.");
        }
        membership.requireRoomToAccept(request.getRequesterId());
        User joiner = users.findById(request.getRequesterId())
                .orElseThrow(() -> NotFoundException.of("User"));
        group.addMember(new FlatmateGroupMember(
                FlatmateVocabulary.blankToNull(joiner.getName()), joiner.getId(), joiner.isVerified()));
        group.setSeatsOpen(open - 1);
        groups.saveAndFlush(group);
    }

    private void takeRoom(FlatmateRequest request) {
        UUID roomId = request.getTargetId();
        List<FlatmateRoom> flat = rooms.findPropertyId(roomId).map(rooms::lockFlat).orElse(List.of());
        FlatmateRoom room = flat.stream().filter(r -> r.getId().equals(roomId)).findFirst()
                .or(() -> rooms.lockLive(roomId))
                .orElseThrow(() -> NotFoundException.of("Room"));
        if (room.isSplitRoom()) {
            addOccupants(room, flat, "bring".equals(request.getShare()) ? 2 : 1);
        } else if (room.isSeatBased()) {
            int open = room.getSeatsOpen() == null ? 0 : room.getSeatsOpen();
            if (open <= 0) {
                throw FlatmateConflicts.roomFull("This room is already taken.");
            }
            room.setSeatsOpen(open - 1);
        }
        rooms.saveAndFlush(room);
    }

    private void addOccupants(FlatmateRoom room, List<FlatmateRoom> flat, int people) {
        int siblings = flat.stream().mapToInt(FlatmateRoom::getOccupants).sum() - room.getOccupants();
        int ceiling = Math.min(FlatmateSupplyService.MAX_PER_ROOM, room.getMaxOccupants() - siblings);
        if (room.getOccupants() + people > ceiling) {
            throw FlatmateConflicts.roomFull("There is no space left in this room.");
        }
        room.setOccupants(room.getOccupants() + people);
    }
}
