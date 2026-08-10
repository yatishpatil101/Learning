package com.punenest.api.engagement.flatmate;

import java.time.Instant;
import java.util.UUID;

/**
 * One row of the flatmate moderation queue (D72).
 *
 * <p><strong>One shape for three tables.</strong> A seeker post, a room and a group are stored
 * differently and rendered differently, but a moderator asks all three the same question: who wrote
 * this, where do they say it is, and what did they type into the free-text boxes. Giving each kind
 * its own DTO would produce three near-identical screens and three chances to forget a field.
 *
 * <p><strong>{@link #freeText} is the point of the screen.</strong> Everything else is context.
 * D72 exists because {@code title}, {@code note} and {@code locality} are unbounded strings and a
 * broker who cannot publish a phone number in the contact field will put it there instead. A queue
 * that showed only a headline and a price would let exactly the abuse it was built to stop through.
 *
 * <p><strong>The author's mobile is not here.</strong> A moderator decides whether a post may be
 * published; they do not need to ring the person to do it, and a staff-visible number on every row
 * of a paged screen is a bulk contact list one screenshot away from leaving the building. The
 * existing verification queue carries one because ops there is checking a document <em>against</em>
 * an identity — a different job with a different need.
 *
 * @param kind one of {@code post}, {@code room}, {@code group} — which table this came from
 * @param headline the strongest short label the row has: the seeker's name, the flat, the group title
 * @param freeText everything the author typed that nobody validated
 */
public record FlatmateModerationQueueDto(
        UUID id,
        String kind,
        String modStatus,
        UUID authorId,
        String authorName,
        String headline,
        String locality,
        String freeText,
        Instant createdAt) {

    public static final String KIND_POST = "post";
    public static final String KIND_ROOM = "room";
    public static final String KIND_GROUP = "group";

    static FlatmateModerationQueueDto of(FlatmateSeekerPost post, String authorName) {
        // A seeker shortlists several localities rather than naming one. Joined rather than
        // truncated to the first: "Kothrud" and "Kothrud, Baner, Wakad" are different posts to a
        // moderator judging whether somebody is spraying the whole city.
        String where = post.getLocalities() == null ? null : String.join(", ", post.getLocalities());
        return new FlatmateModerationQueueDto(post.getId(), KIND_POST, post.getModStatus(),
                post.getUserId(), authorName, post.getName(), where, post.getNote(),
                post.getCreatedAt());
    }

    static FlatmateModerationQueueDto of(FlatmateRoom room, String authorName) {
        // Society and flat number are what a moderator recognises a duplicate listing by, so they
        // are the headline even though the consumer card leads with the room type.
        String headline = room.getSociety() == null ? room.getFlatType()
                : room.getSociety() + (room.getFlatNumber() == null ? "" : " " + room.getFlatNumber());
        return new FlatmateModerationQueueDto(room.getId(), KIND_ROOM, room.getModStatus(),
                room.getHostId(), authorName, headline, room.getLocality(), room.getNote(),
                room.getCreatedAt());
    }

    static FlatmateModerationQueueDto of(FlatmateGroup group, String authorName) {
        return new FlatmateModerationQueueDto(group.getId(), KIND_GROUP, group.getModStatus(),
                group.getHostId(), authorName, group.getTitle(), group.getLocality(),
                group.getNote(), group.getCreatedAt());
    }
}
