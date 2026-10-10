package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.security.AuthPrincipal;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Kept apart from {@code FlatmateSupplyService}, which {@code ServiceSizeGuardTest} pins to shrink only;
 * the two host-side routes are one use-case, the host's dashboard. */
@Service
public class FlatmateHostRoomService {

    private final FlatmateRoomRepository rooms;
    /** The batched occupancy join — the single definition of {@code flatCommitted}. */
    private final FlatmateRoomCards cards;

    FlatmateHostRoomService(FlatmateRoomRepository rooms, FlatmateRoomCards cards) {
        this.rooms = rooms;
        this.cards = cards;
    }

    /** No approved-only floor on purpose: hosts must see their own rooms in every moderation state. */
    @Transactional(readOnly = true)
    public Page<FlatmateRoomCard> myRooms(AuthPrincipal caller, Pageable pageable) {
        Page<FlatmateRoom> page = rooms.findMine(caller.userId(), pageable);
        List<FlatmateRoomCard> window = cards.ownerCards(page.getContent());
        return new PageImpl<>(window, pageable, page.getTotalElements());
    }

    /** Soft archive keeps the row as evidence for the address fingerprint; a split room is refused (409) so owners
     * cannot bypass the occupant check of {@code DELETE /properties/{id}/split}. */
    @Transactional
    public void withdraw(AuthPrincipal caller, UUID roomId) {
        FlatmateRoom room = rooms.findById(roomId)
                .filter(r -> !r.isArchived())
                .orElseThrow(() -> NotFoundException.of("Room"));
        if (!room.getHostId().equals(caller.userId())) {
            throw new ForbiddenException("You can only withdraw a room you posted.");
        }
        if (room.isSplitRoom()) {
            throw new ConflictException(
                    "This room is part of a flat let room by room, so it cannot be withdrawn on "
                            + "its own — stop letting the whole flat room by room instead. "
                            + "(split_room)");
        }
        room.archive("withdrawn by the host");
        rooms.saveAndFlush(room);
    }
}
