package com.punenest.api.engagement.flatmate;

import com.punenest.api.catalog.property.DealIntent;
import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.catalog.property.PropertyStatus;
import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.ForbiddenException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.error.ValidationException;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.AuthPrincipal;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Letting a whole-flat rent listing room by room.
 *
 * <p><strong>The whole-flat listing keeps existing.</strong> A split adds per-room supply beside it
 * rather than converting it, so the share market never cannibalises core rental inventory — the
 * owner is offering the same flat two ways and the market decides which sells.
 *
 * <p><strong>The badge is inherited, never asserted.</strong> Rooms from a split start at
 * {@code identity} tier and unbadged while the parent listing is pending; they are promoted to
 * {@code owner} tier when Ops approves the flat. Splitting is an act the owner performs on their own
 * listing — it proves nothing that was not already proven about the parent, so it grants nothing.
 *
 * <p><strong>Occupancy, not seats.</strong> Split rooms track real people against a ceiling that
 * belongs to the whole flat ({@code maxOccupants}), because a society's cap is a fact about the flat
 * rather than about any one room. See {@link FlatmateRoom} for why the two models never mix.
 */
@Service
public class FlatSplitService {

    /** People allowed in one room, anywhere on the platform. Above this it is a dormitory. */
    private static final int MAX_PER_ROOM = 3;

    /**
     * Lettable rooms are bedrooms plus the hall, so a partitioned living room is the budget option.
     * Unbounded when {@code bhk} is {@code "4"}, which means 4+ — there is no ceiling to compute
     * from, so only the flat's occupancy cap binds.
     */
    private static final int HALL = 1;

    private final PropertyRepository properties;
    private final FlatmateRoomRepository rooms;
    private final FlatmateGuardrails guardrails;
    private final FlatmateMapper mapper;
    private final UserRepository users;
    private final AuditService audit;

    public FlatSplitService(PropertyRepository properties, FlatmateRoomRepository rooms,
            FlatmateGuardrails guardrails, FlatmateMapper mapper, UserRepository users,
            AuditService audit) {
        this.properties = properties;
        this.rooms = rooms;
        this.guardrails = guardrails;
        this.mapper = mapper;
        this.users = users;
        this.audit = audit;
    }

    /** {@code POST /properties/{id}/split} — owner-only, rent-only, once-only. */
    @Transactional
    public FlatSplitResult split(AuthPrincipal caller, UUID propertyId, FlatSplitRequest body) {
        Property parent = properties.findById(propertyId)
                .filter(p -> !p.isArchived())
                .orElseThrow(() -> NotFoundException.of("Property"));

        if (parent.getOwner() == null || !parent.getOwner().getId().equals(caller.userId())) {
            throw new ForbiddenException("Only the listing's owner can let it room by room. (not_owner)");
        }
        if (!DealIntent.RENT.equals(parent.getDeal())) {
            throw new ConflictException(
                    "Only a rent listing can be let room by room. (not_splittable)");
        }
        if (!rooms.findByPropertyIdAndArchivedFalse(propertyId).isEmpty()) {
            throw new ConflictException(
                    "This flat is already let room by room. (already_split)");
        }

        List<FlatSplitRequest.RoomSpec> specs = body.rooms();
        validateRoomCount(parent, specs.size());
        validateOccupancy(body.maxOccupants(), specs.size());

        // The same guardrails every other supply-side create runs. An owner splitting their own
        // Ops-approved flat is exempt from the CAP but never from the address dedupe -- two people
        // claiming one flat is exactly what the fingerprint exists to catch.
        boolean approved = PropertyStatus.APPROVED.equals(parent.getStatus());
        String tier = approved ? FlatmateVocabulary.TIER_OWNER : FlatmateVocabulary.TIER_IDENTITY;
        var address = new FlatmateGuardrails.Address(propertyId, null, parent.getLocality(), null);
        var eligibility = guardrails.evaluate(caller.userId(), tier, address);
        if (eligibility.blocked()) {
            throw new FlatmateSupplyService.HostBlockedException(eligibility);
        }

        User owner = users.findById(caller.userId())
                .orElseThrow(() -> NotFoundException.of("User"));

        List<FlatmateRoomDto> created = new ArrayList<>();
        for (FlatSplitRequest.RoomSpec spec : specs) {
            FlatmateRoom room = buildRoom(caller, parent, spec, body.maxOccupants(), tier,
                    approved, eligibility.fingerprint(), eligibility.flagForReview());
            created.add(mapper.toDto(rooms.saveAndFlush(room), new FlatmateMapper.RoomView(
                    0, owner.getName(), owner.getMobile())));
        }

        audit.record(caller, "property.split", "property", propertyId.toString(),
                "rooms", String.valueOf(created.size()));

        return new FlatSplitResult(created.size(), tier, !approved, eligibility.flagForReview(),
                created);
    }

    /**
     * {@code DELETE /properties/{id}/split} — stop letting room by room.
     *
     * <p>Refused once anyone has moved in. Deleting the rooms would erase a live tenancy: the
     * occupancy ledger is the only record that those people are there, and an owner should not be
     * able to make their tenants disappear by pressing undo.
     */
    @Transactional
    public void unsplit(AuthPrincipal caller, UUID propertyId) {
        Property parent = properties.findById(propertyId)
                .filter(p -> !p.isArchived())
                .orElseThrow(() -> NotFoundException.of("Property"));
        if (parent.getOwner() == null || !parent.getOwner().getId().equals(caller.userId())) {
            throw new ForbiddenException("Only the listing's owner can withdraw a split.");
        }

        List<FlatmateRoom> siblings = rooms.findByPropertyIdAndArchivedFalse(propertyId);
        if (siblings.isEmpty()) {
            throw NotFoundException.of("Split");
        }
        if (siblings.stream().anyMatch(r -> r.getOccupants() > 0)) {
            throw new ConflictException(
                    "Someone has already moved in, so this flat cannot stop being let room by "
                            + "room. (occupied)");
        }

        siblings.forEach(room -> {
            room.archive("split withdrawn by the owner");
            rooms.saveAndFlush(room);
        });
        audit.record(caller, "property.unsplit", "property", propertyId.toString(),
                "rooms", String.valueOf(siblings.size()));
    }

    private FlatmateRoom buildRoom(AuthPrincipal caller, Property parent,
            FlatSplitRequest.RoomSpec spec, int maxOccupants, String tier, boolean approved,
            String fingerprint, boolean flagged) {
        String kind = FlatmateVocabulary.require(
                spec.roomKind(), FlatmateVocabulary.ROOM_KIND, "room kind");

        FlatmateRoom room = new FlatmateRoom(
                caller.userId(), "Private room", parent.getLocality(), spec.rent());
        room.setPropertyId(parent.getId());
        room.setRoomKind(kind);
        // A master bedroom's private bathroom is implied, so the owner is never asked the same
        // question twice; every other kind shares.
        room.setAttachedBath("master".equals(kind) ? "attached" : "shared");
        // Per ROOM, not per person: this is the whole room's rent, divided by whoever takes it.
        // The distinction is what stops a shared bed looking pricier than a private room.
        room.setPriceBasis("room");
        room.setDeposit(spec.deposit() == null ? spec.rent() * 2 : spec.deposit());
        room.setMaxOccupants(maxOccupants);
        room.setOccupants(0);
        // Occupancy model: explicitly no seats, which the DB also enforces for split rooms.
        room.setSeatsTotal(null);
        room.setSeatsOpen(null);
        room.setHostRole(FlatmateVocabulary.ROLE_OWNER);
        room.setVerificationTier(tier);
        room.setVerified(approved);
        room.setSocietyId(parent.getSocietyId());
        room.setLocalities(List.of(parent.getLocality()));
        room.setLat(parent.getLat());
        room.setLng(parent.getLng());
        room.setBhk(bhkLabel(parent.getBhk()));
        room.setNote(FlatmateVocabulary.blankToNull(spec.note()));
        room.setAddressFingerprint(fingerprint);
        room.setFlagForReview(flagged);
        return room;
    }

    /**
     * Lettable rooms = bedrooms + hall.
     *
     * <p>A listing's {@code bhk} is a {@link BigDecimal} because half-rooms are real (2.5 BHK); the
     * ceiling floors it, since half a room is not a second lettable room. Unbounded at 4 or more,
     * where the contract's room enum saturates and only the occupancy cap binds.
     */
    private static void validateRoomCount(Property parent, int requested) {
        BigDecimal bhk = parent.getBhk();
        if (bhk == null || bhk.compareTo(BigDecimal.valueOf(4)) >= 0) {
            return;
        }
        int ceiling = bhk.setScale(0, RoundingMode.FLOOR).intValue() + HALL;
        if (requested > ceiling) {
            throw new ValidationException(
                    "A " + bhk.stripTrailingZeros().toPlainString() + " BHK has at most " + ceiling
                            + " lettable rooms (bedrooms plus the hall); you listed "
                            + requested + ".");
        }
    }

    /**
     * The parent's numeric {@code bhk} as the room contract's enum: {@code 1}-{@code 4}, where
     * {@code 4} means 4+. Floored and clamped, because a room card says "in a 3 BHK" rather than
     * quoting a decimal.
     */
    private static String bhkLabel(BigDecimal bhk) {
        if (bhk == null) {
            return null;
        }
        int whole = bhk.setScale(0, RoundingMode.FLOOR).intValue();
        return String.valueOf(Math.clamp(whole, 1, 4));
    }

    /**
     * The flat cap must sit in {@code [roomCount, roomCount x 3]}.
     *
     * <p>Below the room count it would advertise rooms nobody may live in; above three per room it
     * exceeds the platform-wide per-room ceiling however the people are distributed.
     */
    private static void validateOccupancy(int maxOccupants, int roomCount) {
        int floor = roomCount;
        int ceiling = roomCount * MAX_PER_ROOM;
        if (maxOccupants < floor || maxOccupants > ceiling) {
            throw new ValidationException(
                    "With " + roomCount + " rooms the flat cap must be between " + floor
                            + " and " + ceiling + "; you gave " + maxOccupants + ".");
        }
    }
}
