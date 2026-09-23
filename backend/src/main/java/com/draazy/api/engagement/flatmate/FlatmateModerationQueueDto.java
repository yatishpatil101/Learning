package com.draazy.api.engagement.flatmate;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** One shape for three tables. The author's mobile is deliberately absent — a paged staff screen of
 * numbers is a bulk contact list one screenshot away from leaving the building. */
public record FlatmateModerationQueueDto(
        UUID id,
        String kind,
        String modStatus,
        UUID authorId,
        String authorName,
        String headline,
        String locality,
        String freeText,
        List<String> photos,
        String recheckReason,
        Instant recheckRequestedAt,
        Instant createdAt) {

    public static final String KIND_POST = "post";
    public static final String KIND_ROOM = "room";
    public static final String KIND_GROUP = "group";

    static FlatmateModerationQueueDto of(FlatmateSeekerPost post, String authorName) {
        // Joined rather than truncated to the first: "Kothrud" and "Kothrud, Baner, Wakad" are
        // different posts to a moderator judging whether somebody is spraying the whole city.
        String where = post.getLocalities() == null ? null : String.join(", ", post.getLocalities());
        return new FlatmateModerationQueueDto(post.getId(), KIND_POST, post.getModStatus(),
                post.getUserId(), authorName, post.getName(), where, post.getNote(),
                List.of(), post.getRecheck().getReason(),
                post.getRecheck().getRequestedAt(), post.getCreatedAt());
    }

    static FlatmateModerationQueueDto of(FlatmateRoom room, String authorName) {
        // Society and flat number are what a moderator recognises a duplicate listing by, so they
        // are the headline even though the consumer card leads with the room type.
        String headline = room.getSociety() == null ? room.getFlatType()
                : room.getSociety() + (room.getFlatNumber() == null ? "" : " " + room.getFlatNumber());
        return new FlatmateModerationQueueDto(room.getId(), KIND_ROOM, room.getModStatus(),
                room.getHostId(), authorName, headline, room.getLocality(), room.getNote(),
                room.getPhotos() == null ? List.of() : List.copyOf(room.getPhotos()),
                room.getRecheck().getReason(), room.getRecheck().getRequestedAt(),
                room.getCreatedAt());
    }

    static FlatmateModerationQueueDto of(FlatmateGroup group, String authorName) {
        return new FlatmateModerationQueueDto(group.getId(), KIND_GROUP, group.getModStatus(),
                group.getHostId(), authorName, group.getTitle(), group.getLocality(),
                group.getNote(), List.of(), group.getRecheck().getReason(),
                group.getRecheck().getRequestedAt(), group.getCreatedAt());
    }
}
