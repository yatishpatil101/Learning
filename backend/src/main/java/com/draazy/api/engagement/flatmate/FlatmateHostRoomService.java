package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.AuthPrincipal;
import java.util.Map;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * A host's own rooms — reading them back, and taking one down.
 *
 * <p><strong>The mirror of what {@code FlatmateApplicationService.myGroups} and
 * {@code FlatmateSupplyService.deleteGroup} do for groups</strong>, and it follows both of them
 * deliberately: the read is paged and returns the full DTO rather than the feed's card, the delete
 * is a soft archive answering 204, and a stranger gets 403 rather than 404. Where this deviates
 * from the group at all, {@link #withdraw} says why.
 *
 * <p><strong>Why this is not two methods on {@code FlatmateSupplyService}, where their group twins
 * live.</strong> That service is one of the six pinned by {@code ServiceSizeGuardTest}: it sits at
 * 736 lines against a 737-line pin and a 450-line trigger, so it may shrink and never grow.
 * {@code package-structure.md} §4.1 asks for the split to be <em>by use-case</em>, and the use-case
 * here is a real one rather than a place to put the overflow — every other room route is a stranger
 * acting on somebody else's supply (browse it, enquire about it, moderate it), whereas both of
 * these are the host acting on their own. That is also why the pair travels together: they are the
 * two halves of one screen, the host's dashboard, and splitting them across services by HTTP verb
 * would be the layer split §4.1 forbids.
 */
@Service
public class FlatmateHostRoomService {

    private final FlatmateRoomRepository rooms;
    private final UserRepository users;
    private final FlatmateMapper mapper;
    /** The batched host-name and occupancy joins — the single definition of {@code flatCommitted}. */
    private final FlatmateRoomCards cards;

    FlatmateHostRoomService(FlatmateRoomRepository rooms, UserRepository users,
            FlatmateMapper mapper, FlatmateRoomCards cards) {
        this.rooms = rooms;
        this.users = users;
        this.mapper = mapper;
        this.cards = cards;
    }

    /**
     * {@code GET /me/flatmate-rooms} — the rooms this caller posted.
     *
     * <p><strong>Full {@link FlatmateRoomDto}, not the feed's card projection</strong>, on the same
     * reasoning as {@code myGroups}: the caller is the host, so there is nothing on the row they are
     * not entitled to, and the fields the card deliberately drops are precisely the ones a
     * dashboard needs — {@code modStatus} to explain why a room is not showing publicly yet,
     * {@code seatsOpen} and {@code occupants} to drive the two edit controls, {@code ownerMobile}
     * because it is their own number.
     *
     * <p><strong>No approved-only floor.</strong> {@link FlatmateRoomRepository#findMine} omits the
     * {@code modStatus in ('live','approved')} predicate that the public feed applies, and that
     * omission is the entire point of the route rather than an oversight — see the finder for why.
     * Nothing downstream reintroduces it either: the filter this class must not repeat is
     * {@link FlatmateRoom#isVisible()}, which is what {@code roomsInFlat} applies on the returned
     * stream, and it is absent here on purpose.
     */
    @Transactional(readOnly = true)
    public Page<FlatmateRoomDto> myRooms(AuthPrincipal caller, Pageable pageable) {
        // One user read for the whole page: every row in this window has the same host by
        // construction. Tolerant of a nameless account (D118) — an OTP signup carries no name until
        // the profile is filled in, and that is not a reason to fail their own dashboard.
        User me = users.findById(caller.userId()).orElse(null);
        Page<FlatmateRoom> page = rooms.findMine(caller.userId(), pageable);
        Map<UUID, FlatmateMapper.RoomView> views = cards.ownerViews(page.getContent(),
                me == null ? null : me.getName(), me == null ? null : me.getMobile());
        return page.map(room -> mapper.toDto(room, views.get(room.getId())));
    }

    /**
     * {@code DELETE /flatmates/rooms/{id}} — withdraw a room I posted.
     *
     * <p><strong>A soft archive, exactly as {@code deleteGroup} is.</strong> The row survives with
     * {@code archived}, {@code archivedAt} and a reason, because it is still evidence: the
     * anti-broker address fingerprint, the moderation queue entry and the audit trail all point at
     * it, and a hard delete would let a host launder a rejected claim by withdrawing and re-posting
     * it. It is deliberately <em>not</em> a {@code modStatus} transition — that column is Ops's
     * axis, and "the host took this down" must never be recordable as "we removed this".
     *
     * <p><strong>403 for a stranger, not 404.</strong> Same as the group, and the asymmetry against
     * {@code PATCH /me/group-applications/&#123;id&#125;} (which returns 404 for exactly this case)
     * is intended: an application id is only ever known to the two parties, so confirming it exists
     * is an existence oracle over someone else's inbox — whereas a room id is printed on a public
     * feed, so there is nothing left to leak by admitting the room is real.
     *
     * <p><strong>The one deviation from the group: a split room is refused (409).</strong> A group
     * stands alone, so removing it costs nothing else. A split room does not — it is one of several
     * siblings that together <em>are</em> the parent listing's split, its {@code occupants} are the
     * only record that real people live there, and {@code DELETE /properties/&#123;id&#125;/split}
     * exists precisely to take the whole arrangement down atomically while refusing once anyone has
     * moved in. Allowing this route to archive a split room one at a time would be a way around
     * that check: an owner could make their tenants disappear by pressing withdraw three times, and
     * a half-withdrawn flat would then read as un-split to {@code already_split} while three
     * occupants were still in it. The room entity offers no way to express "withdraw my share of a
     * split", so the correct answer is to name the other door.
     */
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
