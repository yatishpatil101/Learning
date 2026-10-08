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

/** Entity→wire mapper for the flatmates market (api-standards §8.1). Hand-written contact, derived
 * capacity and seats stay outside the generator; see docs/flows/consumer/flatmates.md. */
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface FlatmateMapper {

    @Mapping(target = "type", constant = "flatmate")
    @Mapping(target = "flatCommitted", expression = "java(view.flatCommitted())")
    @Mapping(target = "owner", expression = "java(view.ownerName())")
    @Mapping(target = "ownerMobile", expression = "java(view.ownerMobile())")
    @Mapping(target = "occupancy", expression = "java(occupancyOf(room, view.flatCommitted()))")
    @Mapping(target = "flatMax", expression = "java(flatMax(room))")
    @Mapping(target = "shareMax", expression = "java(shareMax(room, view.flatCommitted()))")
    @Mapping(target = "reviewStatus", expression = "java(view.reviewStatus())")
    @Mapping(target = "verified", expression = "java(hostVerified(room, view.reviewStatus()))")
    @Mapping(target = "cover", expression = "java(coverOf(room))")
    @Mapping(target = "host", expression = "java(view.host())")
    FlatmateRoomDto toDto(FlatmateRoom room, @Context RoomView view);

    @Mapping(target = "type", constant = "flatmate")
    @Mapping(target = "flatCommitted", expression = "java(view.flatCommitted())")
    @Mapping(target = "owner", expression = "java(view.ownerName())")
    @Mapping(target = "occupancy", expression = "java(occupancyOf(room, view.flatCommitted()))")
    @Mapping(target = "flatMax", expression = "java(flatMax(room))")
    @Mapping(target = "shareMax", expression = "java(shareMax(room, view.flatCommitted()))")
    @Mapping(target = "reviewStatus", expression = "java(view.reviewStatus())")
    @Mapping(target = "verified", expression = "java(hostVerified(room, view.reviewStatus()))")
    @Mapping(target = "cover", expression = "java(coverOf(room))")
    FlatmateRoomFeedDto toFeedDto(FlatmateRoom room, @Context RoomView view);

    default String coverOf(FlatmateRoom room) {
        List<String> photos = room.getPhotos();
        return photos == null || photos.isEmpty() ? null : photos.get(0);
    }

    /** Must agree with {@code FlatmateRoomRepository.feed}'s {@code verifiedOnly} clause and
     * {@code FlatmateSearchQueries.roomVerified()}, or a trust-first list sorts an unbadgeable card first. */
    default boolean hostVerified(FlatmateRoom room, String reviewStatus) {
        String tier = room.getVerificationTier();
        return FlatmateVocabulary.TIER_OWNER.equals(tier)
                || (FlatmateVocabulary.TIER_TENANT.equals(tier)
                        && FlatmateVocabulary.STATUS_APPROVED.equals(reviewStatus));
    }

    default String occupancyOf(FlatmateRoom room, int flatCommitted) {
        if (room.isSeatBased()) {

            // A seat-model room's seats say nothing about the flat around it, so the ledger answers
            // the question the seeker asked.
            int open = room.getSeatsOpen() == null ? 0 : room.getSeatsOpen();
            if (open <= 0) {
                return "occupied";
            }
            return flatCommitted > 0 ? "filling" : "empty";
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

    /** The most people who could still take this room. Always 1 for per-person prices — a per-head
     * quote cannot express sharing. */
    default int shareMax(FlatmateRoom room, int flatCommitted) {
        if ("person".equals(room.getPriceBasis())) {
            return 1;
        }
        if (room.isSeatBased()) {
            return room.getSeatsTotal();
        }
        int roomHeadroom = 3 - room.getOccupants();
        int flatHeadroom = room.getMaxOccupants() - flatCommitted;
        return Math.max(0, Math.min(roomHeadroom, flatHeadroom));
    }

    @Mapping(target = "seatsOpen", expression = "java(group.openSeats())")
    @Mapping(target = "perHead", expression = "java(perHead(group))")
    @Mapping(target = "ownerConsentMobile", source = "ownerConsentMobile",
            qualifiedByName = "maskMobile")
    @Mapping(target = "ownerName", expression = "java(view.ownerName())")
    @Mapping(target = "ownerMobile", expression = "java(view.ownerMobile())")
    @Mapping(target = "reviewStatus", expression = "java(view.reviewStatus())")
    FlatmateGroupDto toDto(FlatmateGroup group, @Context PartyView view);

    @Mapping(target = "seatsOpen", expression = "java(group.openSeats())")
    @Mapping(target = "perHead", expression = "java(perHead(group))")
    @Mapping(target = "ownerName", expression = "java(view.ownerName())")
    @Mapping(target = "reviewStatus", expression = "java(view.reviewStatus())")
    FlatmateGroupFeedDto toFeedDto(FlatmateGroup group, @Context PartyView view);

    @Mapping(target = "host", expression = "java(member.getUserId() != null && member.getUserId().equals(member.getGroup().getHostId()))")
    /** Members map name-for-name; no contact on a member, so nothing to gate. */
    FlatmateGroupDto.Member toMember(FlatmateGroupMember member);

    /** Whole-flat rent divided by the seats, computed on read so it can never drift from the rent. */
    default Long perHead(FlatmateGroup group) {
        return group.getSeatsTotal() > 0 ? group.getRent() / group.getSeatsTotal() : group.getRent();
    }

    @Mapping(target = "mobile", expression = "java(view.mobile())")
    FlatmateSeekerPostDto toDto(FlatmateSeekerPost post, @Context SeekerView view);

    @BeanMapping(ignoreByDefault = true)
    @Mapping(target = "attachedBath", source = "attachedBath", qualifiedByName = "attachedBathOrShared")
    @Mapping(target = "furnishing", source = "furnishing", qualifiedByName = "furnishingOrNull")
    @Mapping(target = "facing", source = "facing", qualifiedByName = "trimmedOrNull")
    @Mapping(target = "overlooking", source = "overlooking", qualifiedByName = "trimmedOrNull")
    @Mapping(target = "gender", source = "lookingFor", qualifiedByName = "genderOrAny")
    @Mapping(target = "food", source = "foodPref", qualifiedByName = "foodOrAny")
    @Mapping(target = "bhk", source = "bhk", qualifiedByName = "bhkOrNull")
    @Mapping(target = "homeTypeLabel", source = "homeTypeLabel", qualifiedByName = "homeTypeOrNull")
    @Mapping(target = "deposit", source = "deposit")
    @Mapping(target = "noticePeriodDays", source = "noticePeriodDays")
    @Mapping(target = "lockInMonths", source = "lockInMonths")
    @Mapping(target = "maintenanceBilling", source = "maintenanceBilling", qualifiedByName = "billingOrNull")
    @Mapping(target = "electricityBilling", source = "electricityBilling", qualifiedByName = "billingOrNull")
    @Mapping(target = "societyId", source = "societyId", qualifiedByName = "uuidOrNull")
    @Mapping(target = "flatNumber", source = "flatNumber", qualifiedByName = "trimmedOrNull")
    @Mapping(target = "availableFrom", source = "availableFrom")
    @Mapping(target = "tags", source = "lifestyle", qualifiedByName = "stringsOrEmpty")

    @Mapping(target = "photos", source = "photos", qualifiedByName = "stringsOrEmpty")
    @Mapping(target = "note", source = "note", qualifiedByName = "trimmedOrNull")
    @Mapping(target = "title", source = "title", qualifiedByName = "trimmedOrNull")
    @Mapping(target = "lat", source = "lat")
    @Mapping(target = "lng", source = "lng")
    @Mapping(target = "gatedCommunity", expression = "java(Boolean.TRUE.equals(body.gatedCommunity()))")
    @Mapping(target = "details", source = "details")

    /** {@code ignoreByDefault = true} is an allowlist: trust fields absent here cannot be client-set. */
    @Mapping(target = "ownerConsentMobile", source = "ownerConsentMobile",
            qualifiedByName = "mobileNormaliseOrNull")

    @Mapping(target = "localities", expression = "java(java.util.List.of(body.locality().strip()))")
    void applyTo(FlatmateRoomCreateRequest body, @MappingTarget FlatmateRoom room);

    @BeanMapping(ignoreByDefault = true)
    @Mapping(target = "policy", source = "policy", qualifiedByName = "policyOrWomen")
    @Mapping(target = "deposit", source = "deposit")
    @Mapping(target = "noticePeriodDays", source = "noticePeriodDays")
    @Mapping(target = "lockInMonths", source = "lockInMonths")
    @Mapping(target = "maintenanceBilling", source = "maintenanceBilling", qualifiedByName = "billingOrNull")
    @Mapping(target = "electricityBilling", source = "electricityBilling", qualifiedByName = "billingOrNull")
    @Mapping(target = "seatsTotal", source = "seats", qualifiedByName = "seatsOrTwo")

    /** Same allowlist treatment for a group. {@code propertyId} arrives in the request but is only
     * honoured after {@code deriveTier} confirms owner tier, so the service writes it, not this. */
    @Mapping(target = "seatsOpen", source = "seatsOpen")
    @Mapping(target = "tags", source = "tags", qualifiedByName = "stringsOrEmpty")
    @Mapping(target = "note", source = "note", qualifiedByName = "trimmedOrNull")
    @Mapping(target = "ownerConsentMobile", source = "consentMobile", qualifiedByName = "mobileNormaliseOrNull")
    void applyTo(FlatmateGroupCreateRequest body, @MappingTarget FlatmateGroup group);

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

    @Named("billingOrNull")
    default String billingOrNull(String value) {
        return FlatmateVocabulary.optional(value, FlatmateVocabulary.BILLING, "billing");
    }

    @Named("homeTypeOrNull")
    default String homeTypeOrNull(String value) {
        return FlatmateVocabulary.optional(value, FlatmateVocabulary.HOME_TYPE, "home type");
    }

    @Named("trimmedOrNull")
    default String trimmedOrNull(String value) {
        return FlatmateVocabulary.blankToNull(value);
    }

    /** Canonicalises the owner-consent number to ten digits so {@code +91}-prefixed values pass the
     * column CHECK. Null-safe. */
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

    @Named("maskMobile")
    default String maskMobile(String mobile) {
        return MobileMask.mask(mobile);
    }

    default String map(UUID value) {
        return value == null ? null : value.toString();
    }

    record RoomView(int flatCommitted, String ownerName, String ownerMobile, String reviewStatus,
            FlatmateRoomDto.Host host) {

        RoomView(int flatCommitted, String ownerName, String ownerMobile, String reviewStatus) {
            this(flatCommitted, ownerName, ownerMobile, reviewStatus, null);
        }

        RoomView withHost(FlatmateRoomDto.Host answers) {
            return new RoomView(flatCommitted, ownerName, ownerMobile, reviewStatus, answers);
        }

        static RoomView anonymous(int flatCommitted, String ownerName, String reviewStatus) {
            return new RoomView(flatCommitted, ownerName, null, reviewStatus);
        }
    }

    /** The host's name and, only where the caller says so, their number. */
    record PartyView(String ownerName, String ownerMobile, String reviewStatus) {

        PartyView(String ownerName, String ownerMobile) {
            this(ownerName, ownerMobile, null);
        }

        static PartyView anonymous(String ownerName, String reviewStatus) {
            return new PartyView(ownerName, null, reviewStatus);
        }
    }

    /** A seeker post carries only its author's own number, and only back to that author. */
    record SeekerView(String mobile) {

        static final SeekerView ANONYMOUS = new SeekerView(null);
    }
}
