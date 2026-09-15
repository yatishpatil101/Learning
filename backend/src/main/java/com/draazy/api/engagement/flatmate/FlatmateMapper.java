package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.common.web.Ids;
import java.util.List;
import java.util.UUID;
import org.mapstruct.BeanMapping;
import org.mapstruct.Context;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.MappingTarget;
import org.mapstruct.Named;
import org.mapstruct.ReportingPolicy;

/**
 * Entity→wire mapper for the flatmates market (api-standards §8.1). Hand-written contact, derived
 * capacity and seats stay outside the generator; see docs/flows/consumer/flatmates.md#supply-side-rationale-moved-from-backend-javadoc.
 */
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface FlatmateMapper {

    // Rooms

    /**
     * @param view what the caller joined or decided — never derivable from the room row alone
     */
    @Mapping(target = "type", constant = "flatmate")
    @Mapping(target = "flatCommitted", expression = "java(view.flatCommitted())")
    @Mapping(target = "owner", expression = "java(view.ownerName())")
    @Mapping(target = "ownerMobile", expression = "java(view.ownerMobile())")
    @Mapping(target = "occupancy", expression = "java(occupancyOf(room, view.flatCommitted()))")
    @Mapping(target = "flatMax", expression = "java(flatMax(room))")
    @Mapping(target = "shareMax", expression = "java(shareMax(room, view.flatCommitted()))")
    @Mapping(target = "reviewStatus", expression = "java(view.reviewStatus())")
    FlatmateRoomDto toDto(FlatmateRoom room, @Context RoomView view);

    /**
     * Card-sized room projection; nine fewer fields than {@link FlatmateRoomDto}.
     *
     * @param view what the caller joined or decided — never derivable from the room row alone
     */
    @Mapping(target = "type", constant = "flatmate")
    @Mapping(target = "flatCommitted", expression = "java(view.flatCommitted())")
    @Mapping(target = "owner", expression = "java(view.ownerName())")
    @Mapping(target = "occupancy", expression = "java(occupancyOf(room, view.flatCommitted()))")
    @Mapping(target = "flatMax", expression = "java(flatMax(room))")
    @Mapping(target = "shareMax", expression = "java(shareMax(room, view.flatCommitted()))")
    @Mapping(target = "reviewStatus", expression = "java(view.reviewStatus())")
    FlatmateRoomFeedDto toFeedDto(FlatmateRoom room, @Context RoomView view);

    /** "Will I have flatmates from day one?" — derived from the flat's ledger, orthogonal to tier. */
    default String occupancyOf(FlatmateRoom room, int flatCommitted) {
        if (room.isSeatBased()) {
            // A seat-model room has no flat ledger to read, so its own seats are the whole answer.
            int open = room.getSeatsOpen() == null ? 0 : room.getSeatsOpen();
            if (open >= room.getSeatsTotal()) {
                return "empty";
            }
            return open > 0 ? "filling" : "occupied";
        }
        if (flatCommitted <= 0) {
            return "empty";
        }
        return flatCommitted >= room.getMaxOccupants() ? "occupied" : "filling";
    }

    /** The flat's ceiling, which only a split room has — a standalone room is not part of a flat. */
    default Integer flatMax(FlatmateRoom room) {
        return room.isSplitRoom() ? room.getMaxOccupants() : null;
    }

    /**
     * The most people who could still take this room. Always 1 for per-person prices — a per-head
     * quote cannot express sharing.
     */
    default int shareMax(FlatmateRoom room, int flatCommitted) {
        if ("person".equals(room.getPriceBasis())) {
            return 1;
        }
        int roomHeadroom = 3 - room.getOccupants();
        int flatHeadroom = room.getMaxOccupants() - flatCommitted;
        return Math.max(0, Math.min(roomHeadroom, flatHeadroom));
    }

    // Groups

    @Mapping(target = "seatsOpen", expression = "java(group.openSeats())")
    @Mapping(target = "perHead", expression = "java(perHead(group))")
    @Mapping(target = "ownerConsentMobile", source = "ownerConsentMobile",
            qualifiedByName = "maskMobile")
    @Mapping(target = "ownerName", expression = "java(view.ownerName())")
    @Mapping(target = "ownerMobile", expression = "java(view.ownerMobile())")
    @Mapping(target = "reviewStatus", expression = "java(view.reviewStatus())")
    FlatmateGroupDto toDto(FlatmateGroup group, @Context PartyView view);

    /**
     * Card-sized group projection; {@code seatsOpen}/{@code perHead}/{@code ownerName} re-declared here — {@code FlatmateGroupShapeTest} guards drift.
     * @param view what the caller joined or decided — never derivable from the group row alone
     */
    @Mapping(target = "seatsOpen", expression = "java(group.openSeats())")
    @Mapping(target = "perHead", expression = "java(perHead(group))")
    @Mapping(target = "ownerName", expression = "java(view.ownerName())")
    @Mapping(target = "reviewStatus", expression = "java(view.reviewStatus())")
    FlatmateGroupFeedDto toFeedDto(FlatmateGroup group, @Context PartyView view);

    /** Members map name-for-name; no contact on a member, so nothing to gate. */
    FlatmateGroupDto.Member toMember(FlatmateGroupMember member);

    /** Whole-flat rent divided by the seats, computed on read so it can never drift from the rent. */
    default Long perHead(FlatmateGroup group) {
        return group.getSeatsTotal() > 0 ? group.getRent() / group.getSeatsTotal() : group.getRent();
    }

    // Seeker posts

    @Mapping(target = "mobile", expression = "java(view.mobile())")
    FlatmateSeekerPostDto toDto(FlatmateSeekerPost post, @Context SeekerView view);

    // Request → entity

    /**
     * Copy the client-settable half of a room post onto a room the service already constructed.
     * {@code ignoreByDefault = true} is an allowlist: trust fields absent here can't be client-set.
     */
    @BeanMapping(ignoreByDefault = true)
    @Mapping(target = "attachedBath", source = "attachedBath", qualifiedByName = "attachedBathOrShared")
    @Mapping(target = "furnishing", source = "furnishing", qualifiedByName = "furnishingOrNull")
    @Mapping(target = "facing", source = "facing", qualifiedByName = "trimmedOrNull")
    @Mapping(target = "overlooking", source = "overlooking", qualifiedByName = "trimmedOrNull")
    @Mapping(target = "gender", source = "lookingFor", qualifiedByName = "genderOrAny")
    @Mapping(target = "food", source = "foodPref", qualifiedByName = "foodOrAny")
    @Mapping(target = "bhk", source = "bhk", qualifiedByName = "bhkOrNull")
    @Mapping(target = "deposit", source = "deposit")
    @Mapping(target = "society", source = "society", qualifiedByName = "trimmedOrNull")
    @Mapping(target = "societyId", source = "societyId", qualifiedByName = "uuidOrNull")
    @Mapping(target = "flatNumber", source = "flatNumber", qualifiedByName = "trimmedOrNull")
    @Mapping(target = "availableFrom", source = "availableFrom")
    @Mapping(target = "tags", source = "lifestyle", qualifiedByName = "stringsOrEmpty")
    @Mapping(target = "photos", source = "photos")
    @Mapping(target = "note", source = "note", qualifiedByName = "trimmedOrNull")
    @Mapping(target = "lat", source = "lat")
    @Mapping(target = "lng", source = "lng")
    // The single-locality list the feed filters on, derived from the one the poster typed.
    @Mapping(target = "localities", expression = "java(java.util.List.of(body.locality().strip()))")
    void applyTo(FlatmateRoomCreateRequest body, @MappingTarget FlatmateRoom room);

    /**
     * Same allowlist treatment for a group. {@code propertyId} arrives in the request but is only
     * honoured after {@code deriveTier} confirms owner tier, so the service writes it, not this.
     */
    @BeanMapping(ignoreByDefault = true)
    @Mapping(target = "policy", source = "policy", qualifiedByName = "policyOrWomen")
    @Mapping(target = "seatsTotal", source = "seats", qualifiedByName = "seatsOrTwo")
    @Mapping(target = "seatsOpen", source = "seatsOpen", qualifiedByName = "seatsOpenOrOne")
    @Mapping(target = "tags", source = "tags", qualifiedByName = "stringsOrEmpty")
    @Mapping(target = "note", source = "note", qualifiedByName = "trimmedOrNull")
    @Mapping(target = "ownerConsentMobile", source = "consentMobile", qualifiedByName = "mobileNormaliseOrNull")
    void applyTo(FlatmateGroupCreateRequest body, @MappingTarget FlatmateGroup group);

    // Vocabulary qualifiers: each delegates to FlatmateVocabulary; @Named keeps them out of
    // MapStruct's implicit String → String selection.

    @Named("attachedBathOrShared")
    default String attachedBathOrShared(String value) {
        return FlatmateVocabulary.orDefault(
                value, FlatmateVocabulary.ATTACHED_BATH, "shared", "attached bath");
    }

    @Named("furnishingOrNull")
    default String furnishingOrNull(String value) {
        return FlatmateVocabulary.optional(value, FlatmateVocabulary.FURNISHING, "furnishing");
    }

    @Named("genderOrAny")
    default String genderOrAny(String value) {
        return FlatmateVocabulary.orDefault(
                value, FlatmateVocabulary.GENDER, "any", "looking for");
    }

    @Named("foodOrAny")
    default String foodOrAny(String value) {
        return FlatmateVocabulary.orDefault(
                value, FlatmateVocabulary.FOOD, "any", "food preference");
    }

    @Named("bhkOrNull")
    default String bhkOrNull(String value) {
        return FlatmateVocabulary.optional(value, FlatmateVocabulary.BHK, "bhk");
    }

    @Named("policyOrWomen")
    default String policyOrWomen(String value) {
        return FlatmateVocabulary.orDefault(
                value, FlatmateVocabulary.POLICY, "women", "policy");
    }

    @Named("trimmedOrNull")
    default String trimmedOrNull(String value) {
        return FlatmateVocabulary.blankToNull(value);
    }

    /**
     * Canonicalises the owner-consent number to the ten-digit shape so {@code +91}-prefixed values
     * pass the column CHECK. Null-safe.
     */
    @Named("mobileNormaliseOrNull")
    default String mobileNormaliseOrNull(String value) {
        return MobileMask.normalise(value);
    }

    @Named("uuidOrNull")
    default UUID uuidOrNull(String value) {
        return Ids.parseUuid(value).orElse(null);
    }

    /** A jsonb list column is {@code NOT NULL}, so an omitted array is empty rather than absent. */
    @Named("stringsOrEmpty")
    default List<String> stringsOrEmpty(List<String> values) {
        return values == null ? List.of() : values;
    }

    @Named("seatsOrTwo")
    default int seatsOrTwo(Integer value) {
        return value == null ? 2 : value;
    }

    @Named("seatsOpenOrOne")
    default Integer seatsOpenOrOne(Integer value) {
        return value == null ? 1 : value;
    }

    // Trust carve-outs

    /**
     * Masks the flat owner's number ({@code 98XXXXX210}); belongs to a third party.
     * {@code @Named} keeps MapStruct from mask-ing every String field on the payload.
     */
    @Named("maskMobile")
    default String maskMobile(String mobile) {
        return MobileMask.mask(mobile);
    }

    /** Opaque-id convention (§8.1), for any DTO field that renders an id as a string. */
    default String map(UUID value) {
        return value == null ? null : value.toString();
    }

    /**
     * @param flatCommitted people living across every sibling room of this flat
     * @param ownerMobile   {@code null} on any anonymous surface — the caller decides
     */
    record RoomView(int flatCommitted, String ownerName, String ownerMobile, String reviewStatus) {

        /** Back-compat arity for the surfaces that render no trust badge — the host's own reads. */
        RoomView(int flatCommitted, String ownerName, String ownerMobile) {
            this(flatCommitted, ownerName, ownerMobile, null);
        }

        /**
         * Anonymous projection: no contact, and the real flat ledger — a fake zero would publish
         * a wrong occupancy label ({@code empty}) on public reads while the host saw {@code occupied}.
         */
        static RoomView anonymous(int flatCommitted, String ownerName) {
            return new RoomView(flatCommitted, ownerName, null, null);
        }

        /** As {@link #anonymous(int, String)}, carrying the Ops verdict a card badge reads. */
        static RoomView anonymous(int flatCommitted, String ownerName, String reviewStatus) {
            return new RoomView(flatCommitted, ownerName, null, reviewStatus);
        }
    }

    /** The host's name and, only where the caller says so, their number. */
    record PartyView(String ownerName, String ownerMobile, String reviewStatus) {

        /** Back-compat arity for the surfaces that render no trust badge. */
        PartyView(String ownerName, String ownerMobile) {
            this(ownerName, ownerMobile, null);
        }

        static PartyView anonymous(String ownerName) {
            return new PartyView(ownerName, null, null);
        }

        /** As {@link #anonymous(String)}, carrying the Ops verdict a card badge reads. */
        static PartyView anonymous(String ownerName, String reviewStatus) {
            return new PartyView(ownerName, null, reviewStatus);
        }
    }

    /** A seeker post carries only its author's own number, and only back to that author. */
    record SeekerView(String mobile) {

        static final SeekerView ANONYMOUS = new SeekerView(null);
    }
}
