package com.punenest.api.engagement.flatmate;

import com.punenest.api.common.trust.MobileMask;
import com.punenest.api.common.web.Ids;
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
 * Entity→wire mapper for the flatmates market (api-standards §8.1).
 *
 * <p><strong>Why generated.</strong> {@link FlatmateRoomDto} is 47 fields, 40 of them name-for-name
 * copies, and {@link FlatmateRoomFeedDto} is the 39-field card projection of the same row (D80).
 * The hand-written factory it replaces was a 40-argument positional constructor call, and
 * the risk there is not tedium but silence: {@code society}, {@code flatNumber}, {@code locality},
 * {@code flatType}, {@code homeTypeLabel} and {@code furnishing} are all {@code String} and sit next
 * to each other, so transposing two of them compiles cleanly and ships a card with the flat number
 * in the locality slot. MapStruct matches by <em>name</em>, which removes that entire class of bug.
 *
 * <p><strong>What is deliberately not generated.</strong> Three kinds of field are hand-written:
 *
 * <ul>
 *   <li><strong>Contact.</strong> {@code ownerMobile} / {@code mobile} are supplied by the caller
 *       through a {@code View} rather than read off the entity, so an anonymous surface physically
 *       cannot emit one — a feed handler has no number to pass. {@link #maskMobile} is reachable
 *       only through {@code qualifiedByName} for the reason {@code MobileMask}'s Javadoc gives: a
 *       freely-selectable {@code String → String} method invites MapStruct to adopt it as an
 *       implicit converter and apply it to every string on the payload.</li>
 *   <li><strong>Derived capacity.</strong> {@code occupancy}, {@code flatMax}, {@code shareMax} and
 *       {@code perHead} are arithmetic over the whole flat, not properties of one row. Storing them
 *       would mean every sibling room holding its own copy of one shared truth.</li>
 *   <li><strong>Seats.</strong> {@code seatsOpen} comes from {@link FlatmateGroup#openSeats()}, not
 *       the raw column — a legacy row leaves the column null and falls back to
 *       {@code seatsTotal - members}.</li>
 * </ul>
 *
 * <p>The join-shaped DTOs ({@code FlatmateRequestDto}, {@code FlatmateReviewDto},
 * {@code GroupApplicationDto}) stay hand-written: each takes more joined arguments than entity
 * fields, so there is nothing mechanical to generate — §8.1's "when to hand-write instead".
 */
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface FlatmateMapper {

    // -------------------------------------------------------------------------------------
    // Rooms
    // -------------------------------------------------------------------------------------

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
     * The card-sized projection (D80) — same derivations, nine fewer fields.
     *
     * <p>Note what is <em>not</em> here: {@code ownerMobile}. Every producer of this shape passed
     * {@code null} for it anyway, so the omission changes no payload — it just means an anonymous
     * room read no longer has a slot a future edit could accidentally fill. {@code modStatus} left
     * on the same reasoning (D210). See {@link FlatmateRoomFeedDto} for the evidence behind each of
     * the other seven.
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

    /**
     * "Will I have flatmates from day one?" — derived from the flat's ledger, never trusted from a
     * client. Orthogonal to the trust tier: occupancy answers who is already there, host role
     * answers who is letting it.
     */
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
     * The most people who could still take this room: {@code min(3 - occupants, flatMax -
     * flatCommitted)}, and always 1 when the price is per person — a per-person quote is one
     * person's rent, so "sharing" it is not something the price can express.
     */
    default int shareMax(FlatmateRoom room, int flatCommitted) {
        if ("person".equals(room.getPriceBasis())) {
            return 1;
        }
        int roomHeadroom = 3 - room.getOccupants();
        int flatHeadroom = room.getMaxOccupants() - flatCommitted;
        return Math.max(0, Math.min(roomHeadroom, flatHeadroom));
    }

    // -------------------------------------------------------------------------------------
    // Groups
    // -------------------------------------------------------------------------------------

    @Mapping(target = "seatsOpen", expression = "java(group.openSeats())")
    @Mapping(target = "perHead", expression = "java(perHead(group))")
    @Mapping(target = "ownerConsentMobile", source = "ownerConsentMobile",
            qualifiedByName = "maskMobile")
    @Mapping(target = "ownerName", expression = "java(view.ownerName())")
    @Mapping(target = "ownerMobile", expression = "java(view.ownerMobile())")
    @Mapping(target = "reviewStatus", expression = "java(view.reviewStatus())")
    FlatmateGroupDto toDto(FlatmateGroup group, @Context PartyView view);

    /**
     * The card-sized projection of a group (D211) — D80's room split, applied to the other half of
     * supply. Five fewer fields; see {@link FlatmateGroupFeedDto} for the evidence behind each.
     *
     * <p><strong>The derivations below are written out a second time on purpose, and that is the
     * risk this shape carries.</strong> MapStruct cannot inherit {@code @Mapping} across differing
     * target types, so {@code seatsOpen}, {@code perHead} and {@code ownerName} are wired here as
     * well as on {@link #toDto(FlatmateGroup, PartyView)}. Editing one and not the other compiles,
     * generates and ships two different payloads for the same group.
     * {@code FlatmateGroupShapeTest} is what catches that; nothing structural can.
     *
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

    // -------------------------------------------------------------------------------------
    // Seeker posts
    // -------------------------------------------------------------------------------------

    @Mapping(target = "mobile", expression = "java(view.mobile())")
    FlatmateSeekerPostDto toDto(FlatmateSeekerPost post, @Context SeekerView view);

    // -------------------------------------------------------------------------------------
    // Request → entity
    // -------------------------------------------------------------------------------------

    /**
     * Copy the client-settable half of a room post onto a room the service already constructed.
     *
     * <p><strong>{@code ignoreByDefault = true} is the security property, not a convenience.</strong>
     * It makes this an <em>allowlist</em>: a field the client may set has to be named here, and
     * anything absent is left exactly as the service set it. The fields deliberately missing are the
     * ones that decide trust — {@code verificationTier}, {@code verified}, {@code addressFingerprint},
     * {@code flagForReview}, {@code seatsTotal}/{@code seatsOpen} and {@code modStatus}. With plain
     * setters, "the client cannot set the tier" was true only because nobody had written the line;
     * here it is a declaration, and adding one is a visible diff in review.
     *
     * <p><strong>{@code @MappingTarget} rather than constructing.</strong> {@code hostId},
     * {@code roomType}, {@code locality} and {@code budget} are the room's invariants and its
     * constructor exists to guarantee them. Letting MapStruct build the object would route around
     * that; updating one it already built keeps the guarantee and still removes the copying.
     */
    @BeanMapping(ignoreByDefault = true)
    @Mapping(target = "attachedBath", source = "attachedBath", qualifiedByName = "attachedBathOrShared")
    @Mapping(target = "furnishing", source = "furnishing", qualifiedByName = "furnishingOrNull")
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
     * The same allowlist treatment for a group. Absent, and therefore not client-settable:
     * {@code verificationTier}, {@code ownerConsent}, {@code addressFingerprint},
     * {@code flagForReview}, {@code propertyId} and {@code modStatus}.
     *
     * <p>{@code propertyId} is the sharpest of those. It arrives in the request but is honoured only
     * when {@code deriveTier} independently confirms the caller owns an Ops-approved listing, so it
     * is written by the service after that check rather than copied in here.
     */
    @BeanMapping(ignoreByDefault = true)
    @Mapping(target = "policy", source = "policy", qualifiedByName = "policyOrWomen")
    @Mapping(target = "seatsTotal", source = "seats", qualifiedByName = "seatsOrTwo")
    @Mapping(target = "seatsOpen", source = "seatsOpen", qualifiedByName = "seatsOpenOrOne")
    @Mapping(target = "tags", source = "tags", qualifiedByName = "stringsOrEmpty")
    @Mapping(target = "note", source = "note", qualifiedByName = "trimmedOrNull")
    @Mapping(target = "ownerConsentMobile", source = "consentMobile", qualifiedByName = "mobileNormaliseOrNull")
    void applyTo(FlatmateGroupCreateRequest body, @MappingTarget FlatmateGroup group);

    // -------------------------------------------------------------------------------------
    // Vocabulary qualifiers
    //
    // One line each, all delegating to FlatmateVocabulary so the closed sets stay in one place and
    // a bad value still produces a message naming the field. @Named keeps every one of them out of
    // MapStruct's implicit String → String selection.
    // -------------------------------------------------------------------------------------

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
     * The flat owner's consent number, canonicalised to the stored ten-digit shape (Q1). The field
     * is optional and lenient on input (spacing, a {@code +91} prefix), so it is normalised before
     * it can reach the {@code ^[6-9][0-9]{9}$} column CHECK — without this a {@code +91}-prefixed
     * value would pass {@code @IndianMobile} at the edge and then 500 at commit. {@link MobileMask}
     * {@code #normalise} is null-safe, so an omitted number stays null.
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

    // -------------------------------------------------------------------------------------
    // Trust carve-outs
    // -------------------------------------------------------------------------------------

    /**
     * The flat owner's number, masked even for the host who typed it: it belongs to a third party
     * who consented to being <em>asked</em>, not to being published back into the product. Enough
     * digits survive ({@code 98XXXXX210}) for the host to recognise which number they entered.
     *
     * <p><strong>{@code @Named}, and only reachable through {@code qualifiedByName}.</strong>
     * {@link MobileMask}'s Javadoc warns that a visible {@code String → String} mapper method invites
     * MapStruct to adopt it as an implicit converter and apply it to every string on the payload —
     * which would mask {@code title}, {@code locality} and {@code note} into nonsense. A qualifier
     * excludes it from implicit selection, so it fires exactly where it is named and nowhere else.
     * {@code PropertyMapper} keeps its copy {@code private} instead; that works there because its
     * only caller is a {@code default} method <em>inside</em> the interface, which the generated
     * implementation never has to reach.
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
     * What a room card needs that the room row does not hold.
     *
     * @param flatCommitted people living across every sibling room of this flat
     * @param ownerMobile   {@code null} on any anonymous surface — the caller decides, not the mapper
     */
    record RoomView(int flatCommitted, String ownerName, String ownerMobile, String reviewStatus) {

        /** Back-compat arity for the surfaces that render no trust badge — the host's own reads. */
        RoomView(int flatCommitted, String ownerName, String ownerMobile) {
            this(flatCommitted, ownerName, ownerMobile, null);
        }

        /**
         * The anonymous projection: no contact, and a <em>real</em> flat ledger (D212).
         *
         * <p>This used to take the name alone and pass {@code 0} for the ledger, on the reasoning
         * that an anonymous caller has no business knowing how many people already live there. But
         * {@code flatCommitted} is not only shown — {@link #occupancyOf} and {@link #shareMax} are
         * derived from it, so a fake zero did not withhold the number, it published a wrong
         * <em>label</em>: a full flat reported {@code empty} on all three public reads while the
         * host's own view of the same room said {@code occupied}. One row, one occupancy answer.
         *
         * <p>What an anonymous caller must not see is a phone number, and that is exactly what this
         * factory still withholds — there is no parameter to pass one to.
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
