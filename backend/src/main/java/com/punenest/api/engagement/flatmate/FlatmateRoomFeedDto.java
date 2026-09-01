package com.punenest.api.engagement.flatmate;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Contract schema {@code FlatmateRoomFeed} — the card-sized projection of a room (D80).
 *
 * <p><strong>Why a second shape.</strong> {@link FlatmateRoomDto} is 47 fields because it has to
 * serve the host's own view of a room they just created or edited. The three public reads — the
 * room feed, the mixed flatmates feed and {@code GET /properties/&#123;id&#125;/rooms} — render a
 * <em>card</em>, and a card cannot show a field it never reads. Sending the other nine anyway
 * costs bytes on the largest, most-paged payload the app has and, worse, keeps trust-forensics
 * columns on an anonymous wire where no reader can justify them.
 *
 * <p><strong>What is deliberately absent, and why nothing breaks.</strong> Each omission was
 * checked against the actual frontend consumers under {@code frontend/src}, not against the seam
 * mapper — {@code toRoomViewModel} copies almost everything through, so a field only counts as
 * "read" if something downstream of the view model consumes it:
 *
 * <ul>
 *   <li>{@code ownerMobile} — every producer of this shape already passes {@code null} for it
 *       ({@code RoomView.anonymous(..)}). Removing the field turns a convention into a structural
 *       guarantee: an anonymous room read now has nowhere to put a number.</li>
 *   <li>{@code agreementDeclared}, {@code addressFingerprint}, {@code flagForReview} — anti-broker
 *       and moderation forensics. The client only ever <em>writes</em> these (the group and
 *       list-property forms compute them locally); no card, filter, map or helper reads them back
 *       off a room. The Ops review queue keys on its own record, not on a feed row.</li>
 *   <li>{@code societyId}, {@code availableFrom}, {@code photos}, {@code status} — no reader at
 *       all. The card shows {@code society} and {@code moveIn}; its image comes from a local
 *       constant, never from {@code photos}; and nothing anywhere under {@code frontend/src}
 *       reads {@code status} off a room row.</li>
 *   <li>{@code modStatus} — the moderation verdict (D210). It left with the leak it enabled: all
 *       three producers of this shape are now moderation-filtered, so the field could only ever
 *       say "this one passed" — no information to a stranger, and a slot a future unfiltered
 *       producer could leak a verdict through again. Populating it for the host instead was not
 *       available: this shape has no host-facing producer, and the host's own copy
 *       ({@link FlatmateRoomDto}) already carries it. Its one derived use at the seam
 *       ({@code publiclyVisible}) has no consumer downstream, and {@code AdminFlatmates.jsx} reads
 *       {@code modStatus} from the local store rather than from a feed row.</li>
 * </ul>
 *
 * <p><strong>Every producer of this shape is moderation-filtered</strong>, as of D210.
 * {@code /flatmates/rooms} and {@code /flatmates/feed} always were; {@code roomsInFlat} reads
 * {@code findByPropertyIdAndArchivedFalse}, which filters {@code archived} only, and now narrows
 * the returned stream through {@link FlatmateRoom#isVisible()} — the same rule the other two
 * express in JPQL, borrowed rather than restated. The finder itself is deliberately left wide: the
 * occupancy ledger, the {@code already_split} check and {@code unsplit} all have to keep seeing
 * every non-archived row, because a room awaiting moderation still has people in it.
 *
 * <p>Everything a card, a filter or the client-side flat ledger touches stays: {@code maxOccupants},
 * {@code flatNumber} and {@code propertyId} look droppable but are exactly what
 * {@code decorateRooms} re-derives the ledger from.
 *
 * <p><strong>{@code reviewStatus} was added</strong>, and the contrast with {@code modStatus}
 * leaving is the point rather than an inconsistency: that one is our verdict on the <em>post</em>,
 * which every producer here has already filtered on, whereas this is Ops' verdict on the host's
 * <em>claim to the flat</em> — the whole content of the tier badge this card renders. See
 * {@link FlatmateGroupFeedDto} for the argument in full, and {@link FlatmateReviewStatuses} for why
 * the browser could not answer it.
 *
 * <p>{@link #flatCommitted}, {@link #flatMax} and {@link #shareMax} are derived, never stored — see
 * {@link FlatmateRoomDto} for why.
 */
public record FlatmateRoomFeedDto(
        UUID id,
        String type,
        UUID propertyId,
        String roomKind,
        String roomType,
        String attachedBath,
        String priceBasis,
        Long budget,
        Long deposit,
        String occupancy,
        int occupants,
        int maxOccupants,
        int flatCommitted,
        Integer flatMax,
        int shareMax,
        Integer seatsTotal,
        Integer seatsOpen,
        String hostRole,
        String verificationTier,
        boolean verified,
        String reviewStatus,
        String society,
        String flatNumber,
        String locality,
        List<String> localities,
        Double lat,
        Double lng,
        String bhk,
        String flatType,
        String homeTypeLabel,
        boolean gatedCommunity,
        String furnishing,
        String moveIn,
        String gender,
        String food,
        List<String> tags,
        String note,
        String owner,
        Instant createdAt) {
}
