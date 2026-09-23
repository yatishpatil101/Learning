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

    /** @param view what the caller joined or decided — never derivable from the room row alone */
    @Mapping(target = "type", constant = "flatmate")
    @Mapping(target = "flatCommitted", expression = "java(view.flatCommitted())")
    @Mapping(target = "owner", expression = "java(view.ownerName())")
    @Mapping(target = "ownerMobile", expression = "java(view.ownerMobile())")
    @Mapping(target = "occupancy", expression = "java(occupancyOf(room, view.flatCommitted()))")
    @Mapping(target = "flatMax", expression = "java(flatMax(room))")
    @Mapping(target = "shareMax", expression = "java(shareMax(room, view.flatCommitted()))")
    @Mapping(target = "reviewStatus", expression = "java(view.reviewStatus())")
    @Mapping(target = "verified", expression = "java(hostVerified(room, view.reviewStatus()))")
    FlatmateRoomDto toDto(FlatmateRoom room, @Context RoomView view);

    /** Card-sized room projection; nine fewer fields than {@link FlatmateRoomDto}.
     * @param view what the caller joined or decided — never derivable from the room row alone */
    @Mapping(target = "type", constant = "flatmate")
    @Mapping(target = "flatCommitted", expression = "java(view.flatCommitted())")
    @Mapping(target = "owner", expression = "java(view.ownerName())")
    @Mapping(target = "occupancy", expression = "java(occupancyOf(room, view.flatCommitted()))")
    @Mapping(target = "flatMax", expression = "java(flatMax(room))")
    @Mapping(target = "shareMax", expression = "java(shareMax(room, view.flatCommitted()))")
    @Mapping(target = "reviewStatus", expression = "java(view.reviewStatus())")
    @Mapping(target = "verified", expression = "java(hostVerified(room, view.reviewStatus()))")
    FlatmateRoomFeedDto toFeedDto(FlatmateRoom room, @Context RoomView view);

    /** Must agree with {@code FlatmateRoomRepository.feed}'s {@code verifiedOnly} clause and
     * {@code FlatmateSearchQueries.roomVerified()}, or a trust-first list sorts an unbadgeable card first. */
    default boolean hostVerified(FlatmateRoom room, String reviewStatus) {
        String tier = room.getVerificationTier();
        return FlatmateVocabulary.TIER_OWNER.equals(tier)
                || (FlatmateVocabulary.TIER_TENANT.equals(tier)
                        && FlatmateVocabulary.STATUS_APPROVED.equals(reviewStatus));
    }

    /** "Will I have flatmates from day one?" — derived from the flat's ledger, orthogonal to tier. */
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

    /** Card-sized group projection; {@code seatsOpen}/{@code perHead}/{@code ownerName} re-declared
     * here — {@code FlatmateGroupShapeTest} guards drift. */
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

    @Mapping(target = "mobile", expression = "java(view.mobile())")
    FlatmateSeekerPostDto toDto(FlatmateSeekerPost post, @Context SeekerView view);

    /** {@code ignoreByDefault = true} is an allowlist: trust fields absent here cannot be client-set. */
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
    @Mapping(target = "society", source = "society", qualifiedByName = "trimmedOrNull")
    @Mapping(target = "societyId", source = "societyId", qualifiedByName = "uuidOrNull")
    @Mapping(target = "flatNumber", source = "flatNumber", qualifiedByName = "trimmedOrNull")
    @Mapping(target = "availableFrom", source = "availableFrom")
    @Mapping(target = "tags", source = "lifestyle", qualifiedByName = "stringsOrEmpty")
    // Empty, never null: the gallery is optional so a host can photograph the flat later, and
    // `photos` is a NOT NULL column that the publication gate reads before the insert.
    @Mapping(target = "photos", source = "photos", qualifiedByName = "stringsOrEmpty")
    @Mapping(target = "note", source = "note", qualifiedByName = "trimmedOrNull")
    @Mapping(target = "lat", source = "lat")
    @Mapping(target = "lng", source = "lng")
    // Normalised here so the stored value, the OTP and the consent row agree on the same ten digits.
    // The `ownerConsent` boolean beside it is never mapped: only the service may set it.
    @Mapping(target = "ownerConsentMobile", source = "ownerConsentMobile",
            qualifiedByName = "mobileNormaliseOrNull")
    // The single-locality list the feed filters on, derived from the one the poster typed.
    @Mapping(target = "localities", expression = "java(java.util.List.of(body.locality().strip()))")
    void applyTo(FlatmateRoomCreateRequest body, @MappingTarget FlatmateRoom room);

    /** Same allowlist treatment for a group. {@code propertyId} arrives in the request but is only
     * honoured after {@code deriveTier} confirms owner tier, so the service writes it, not this. */
    @BeanMapping(ignoreByDefault = true)
    @Mapping(target = "policy", source = "policy", qualifiedByName = "policyOrWomen")
    @Mapping(target = "deposit", source = "deposit")
    @Mapping(target = "noticePeriodDays", source = "noticePeriodDays")
    @Mapping(target = "lockInMonths", source = "lockInMonths")
    @Mapping(target = "maintenanceBilling", source = "maintenanceBilling", qualifiedByName = "billingOrNull")
    @Mapping(target = "electricityBilling", source = "electricityBilling", qualifiedByName = "billingOrNull")
    @Mapping(target = "seatsTotal", source = "seats", qualifiedByName = "seatsOrTwo")
    // Null stays null so FlatmateGroup.openSeats() derives the count from the seats and the members.
    // Defaulting to 1 got it wrong for a group of four.
    @Mapping(target = "seatsOpen", source = "seatsOpen")
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

    /** Masks the flat owner's number ({@code 98XXXXX210}). {@code @Named} keeps MapStruct from
     * masking every String field on the payload. */
    @Named("maskMobile")
    default String maskMobile(String mobile) {
        return MobileMask.mask(mobile);
    }

    /** Opaque-id convention (§8.1), for any DTO field that renders an id as a string. */
    default String map(UUID value) {
        return value == null ? null : value.toString();
    }

    /** {@code reviewStatus} is the standing Ops verdict — a caller that cannot supply one is telling
     * every tenant-tier room it is unbadged. {@code ownerMobile} is null on anonymous surfaces. */
    record RoomView(int flatCommitted, String ownerName, String ownerMobile, String reviewStatus) {

        /** No contact, and the real flat ledger — a fake zero would publish {@code empty} on public
         * reads while the host saw {@code occupied}. */
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

        /** Anonymous projection: no contact, carrying the Ops verdict a card badge reads. */
        static PartyView anonymous(String ownerName, String reviewStatus) {
            return new PartyView(ownerName, null, reviewStatus);
        }
    }

    /** A seeker post carries only its author's own number, and only back to that author. */
    record SeekerView(String mobile) {

        static final SeekerView ANONYMOUS = new SeekerView(null);
    }
}
